<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Line } from 'vue-chartjs';
  import {
    Chart as ChartJS,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
    type ChartData,
    type ChartOptions,
  } from 'chart.js';
  import type { StatusHistory, StatusHistoryPoint } from '../model/status';
  import { formatStatusRateAxis } from '../model/statusFormatting';

  export type StatusMetric = 'cpu' | 'memory' | 'swap' | 'disk' | 'network';
  type DownsampleMode = 'average' | 'max';
  type TimedChartPoint = { x: number; y: number };

  ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend);
  const props = withDefaults(
    defineProps<{
      history: StatusHistory;
      metric?: StatusMetric;
      rangeMinutes?: number;
      intervalSeconds?: number;
      scale?: number;
    }>(),
    { metric: 'cpu', rangeMinutes: 5, intervalSeconds: 3, scale: 1 },
  );
  const { t } = useI18n();
  const MAX_CHART_POINTS = 110;
  const Y_AXIS_GUTTER_PX = 2;
  const CHART_RIGHT_PAD_PX = 4;
  const chartElement = ref<HTMLElement | null>(null);
  const legendPosition = shallowRef<{ top: string; right: string; maxWidth: string } | null>(null);
  const syncLegendPosition = () => {
    const rect = chartElement.value?.getBoundingClientRect();
    legendPosition.value =
      rect && rect.width && rect.height
        ? {
            top: `${Math.round(rect.top + 4)}px`,
            right: `${Math.round(window.innerWidth - rect.right + 6)}px`,
            maxWidth: `${Math.max(0, rect.width - 12)}px`,
          }
        : null;
  };
  watch(() => [props.scale, props.metric], syncLegendPosition, { flush: 'post' });
  const rangeMs = computed(() => Math.max(1, props.rangeMinutes) * 60_000);
  const latestSampleTime = computed(() =>
    Math.max(
      0,
      props.history.cpu.at(-1)?.time ?? 0,
      props.history.memory.at(-1)?.time ?? 0,
      props.history.swap.at(-1)?.time ?? 0,
      props.history.disk.at(-1)?.time ?? 0,
      props.history.networkRx.at(-1)?.time ?? 0,
      props.history.networkTx.at(-1)?.time ?? 0,
    ),
  );
  const windowEnd = computed(() => latestSampleTime.value || Date.now());
  const windowStart = computed(() => windowEnd.value - rangeMs.value);
  const inRange = (points: StatusHistoryPoint[]) =>
    points.filter((point) => point.time >= windowStart.value && point.time <= windowEnd.value);

  /**
   * Buckets are anchored to real sample timestamps rather than sequence count.
   * That preserves gaps and prevents a short, newly connected history from
   * being stretched across the whole selected 1/5/10/30 minute window.
   */
  const stableDownsample = (points: StatusHistoryPoint[], mode: DownsampleMode = 'average'): StatusHistoryPoint[] => {
    const source = inRange(points);
    if (!source.length) return [];
    const bucketDurationMs = Math.max(
      Math.max(1, props.intervalSeconds) * 1000,
      Math.ceil(rangeMs.value / MAX_CHART_POINTS),
    );

    const groups = new Map<number, { sum: number; count: number; max: number; time: number; sequence: number }>();
    for (const point of source) {
      const bucket = Math.floor(point.time / bucketDurationMs);
      const current = groups.get(bucket) ?? {
        sum: 0,
        count: 0,
        max: Number.NEGATIVE_INFINITY,
        time: point.time,
        sequence: point.sequence,
      };
      current.sum += point.value;
      current.count += 1;
      current.max = Math.max(current.max, point.value);
      current.time = Math.max(current.time, point.time);
      current.sequence = Math.max(current.sequence, point.sequence);
      groups.set(bucket, current);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, group]) => ({
        time: group.time,
        sequence: group.sequence,
        value: mode === 'max' ? group.max : group.sum / group.count,
      }));
  };

  const percentageSeries = computed(() => {
    if (props.metric === 'cpu') return stableDownsample(props.history.cpu);
    if (props.metric === 'memory') return stableDownsample(props.history.memory);
    if (props.metric === 'swap') return stableDownsample(props.history.swap);
    if (props.metric === 'disk') return stableDownsample(props.history.disk);
    return [];
  });
  const networkRx = computed(() => stableDownsample(props.history.networkRx, 'max'));
  const networkTx = computed(() => stableDownsample(props.history.networkTx, 'max'));
  const visibleStartTime = computed(() => {
    const series = props.metric === 'network' ? networkRx.value : percentageSeries.value;
    return series[0]?.time ?? 0;
  });

  const singleLabel = computed(() => {
    if (props.metric === 'cpu') return t('statusMonitor.cpuUsageLabel');
    if (props.metric === 'memory') return t('statusMonitor.memoryPercentLabel');
    if (props.metric === 'swap') return t('statusMonitor.swapPercentLabel');
    return t('statusMonitor.diskPercentLabel');
  });

  const rawNetworkMax = computed(() =>
    Math.max(
      1,
      ...inRange(props.history.networkRx).map((point) => point.value),
      ...inRange(props.history.networkTx).map((point) => point.value),
    ),
  );
  const niceNetworkAxisMax = (rawBytes: number): number => {
    if (!Number.isFinite(rawBytes) || rawBytes <= 1) return 1;
    const unit = rawBytes >= 1024 ** 2 ? 1024 ** 2 : rawBytes >= 1024 ? 1024 : 1;
    const value = rawBytes / unit;
    const roughStep = Math.max(value / 10, Number.EPSILON);
    const magnitude = 10 ** Math.floor(Math.log10(roughStep));
    const fraction = roughStep / magnitude;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    const step = niceFraction * magnitude;
    return Math.max(unit, Math.ceil(value / step) * step * unit);
  };
  const networkAxisMax = ref(1);
  const syncNetworkAxis = (force = false) => {
    const raw = rawNetworkMax.value;
    if (force || networkAxisMax.value <= 1 || raw > networkAxisMax.value || raw < networkAxisMax.value * 0.55) {
      networkAxisMax.value = niceNetworkAxisMax(raw);
    }
  };
  watch(rawNetworkMax, () => syncNetworkAxis(), { immediate: true });
  watch(
    () => props.rangeMinutes,
    () => syncNetworkAxis(true),
  );

  const chartTheme = ref({
    text: '#666666',
    grid: '#cccccc',
    surface: '#ffffff',
    border: '#cccccc',
    primary: '#a06cd5',
    download: '#28a745',
    upload: '#ffc107',
  });
  const readTheme = () => {
    const style = getComputedStyle(document.documentElement);
    const value = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    chartTheme.value = {
      text: value('--text-color-secondary', chartTheme.value.text),
      grid: value('--border-color', chartTheme.value.grid),
      surface: value('--app-bg-color', chartTheme.value.surface),
      border: value('--border-color', chartTheme.value.border),
      primary: value('--link-active-color', chartTheme.value.primary),
      download: '#10b981',
      upload: '#3b82f6',
    };
  };
  let themeObserver: MutationObserver | null = null;
  let chartObserver: ResizeObserver | null = null;
  const handleViewportChange = syncLegendPosition;
  onMounted(() => {
    readTheme();
    themeObserver = new MutationObserver(readTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    chartObserver = new ResizeObserver(syncLegendPosition);
    if (chartElement.value) chartObserver.observe(chartElement.value);
    syncLegendPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
  });
  onBeforeUnmount(() => {
    themeObserver?.disconnect();
    chartObserver?.disconnect();
    window.removeEventListener('resize', handleViewportChange);
    window.removeEventListener('scroll', handleViewportChange, true);
  });

  const pad2 = (value: number) => String(value).padStart(2, '0');
  const formatAxisTime = (time: number): string => {
    const date = new Date(time);
    const base = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
    return props.rangeMinutes <= 1 ? `${base}:${pad2(date.getSeconds())}` : base;
  };
  const toTimedPoint = (point: StatusHistoryPoint): TimedChartPoint => ({ x: point.time, y: point.value });

  const data = computed<ChartData<'line', TimedChartPoint[]>>(() => {
    if (props.metric === 'network') {
      return {
        datasets: [
          {
            label: t('statusMonitor.networkDownload'),
            data: networkRx.value.map(toTimedPoint),
            borderColor: chartTheme.value.download,
            backgroundColor: chartTheme.value.download,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.12,
          },
          {
            label: t('statusMonitor.networkUpload'),
            data: networkTx.value.map(toTimedPoint),
            borderColor: chartTheme.value.upload,
            backgroundColor: chartTheme.value.upload,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.12,
          },
        ],
      };
    }
    return {
      datasets: [
        {
          label: singleLabel.value,
          data: percentageSeries.value.map(toTimedPoint),
          borderColor: chartTheme.value.primary,
          backgroundColor: chartTheme.value.primary,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 3,
          tension: 0.12,
        },
      ],
    };
  });

  const options = computed<ChartOptions<'line'>>(() => ({
    responsive: true,
    // Include the CSS zoom in the backing resolution so axis text is never upscaled.
    devicePixelRatio: Math.ceil((window.devicePixelRatio || 1) * Math.max(1, props.scale)),
    maintainAspectRatio: false,
    animation: false,
    layout: {
      padding: { left: 0, right: CHART_RIGHT_PAD_PX },
    },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        enabled: false,
      },
    },
    scales: {
      x: {
        alignToPixels: true,
        type: 'linear',
        min: windowStart.value,
        max: windowEnd.value,
        ticks: {
          color: chartTheme.value.text,
          maxTicksLimit: props.rangeMinutes <= 1 ? 3 : 4,
          font: { size: 8 },
          align: 'inner',
          callback: (value) => formatAxisTime(Number(value)),
        },
        grid: { display: false },
        border: { color: chartTheme.value.grid },
      },
      y:
        props.metric === 'network'
          ? {
              alignToPixels: true,
              beginAtZero: true,
              min: 0,
              max: networkAxisMax.value,
              afterFit: (scale) => {
                scale.width = Y_AXIS_GUTTER_PX;
              },
              ticks: {
                color: chartTheme.value.text,
                font: { size: 9 },
                mirror: true,
                padding: 3,
                z: 1,
                callback: (value) => formatStatusRateAxis(Number(value)),
              },
              grid: { color: chartTheme.value.grid, lineWidth: 0.5 },
              border: { color: chartTheme.value.grid },
            }
          : {
              alignToPixels: true,
              beginAtZero: true,
              min: 0,
              max: 100,
              afterFit: (scale) => {
                scale.width = Y_AXIS_GUTTER_PX;
              },
              ticks: {
                color: chartTheme.value.text,
                font: { size: 7 },
                maxTicksLimit: 5,
                mirror: true,
                padding: 3,
                z: 1,
                callback: (value) => `${Number(value)}`,
              },
              grid: { color: chartTheme.value.grid, lineWidth: 0.5 },
              border: { color: chartTheme.value.grid },
            },
    },
  }));
</script>

<template>
  <div
    ref="chartElement"
    class="status-history-chart"
    :data-range-minutes="props.rangeMinutes"
    :data-window-start="windowStart"
    :data-window-end="windowEnd"
    :data-visible-start="visibleStartTime"
  >
    <Line :data="data" :options="options" />
  </div>
  <Teleport to="body">
    <div v-if="props.metric === 'network' && legendPosition" class="network-legend" :style="legendPosition">
      <span><i class="legend-download"></i>{{ t('statusMonitor.networkDownload') }}</span>
      <span><i class="legend-upload"></i>{{ t('statusMonitor.networkUpload') }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
  .status-history-chart {
    min-width: 0;
    min-height: 0;
    height: 100%;
    flex: 1 1 auto;
    position: relative;
    overflow: hidden;
  }

  .network-legend {
    position: fixed;
    z-index: 1000;
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 0.65rem;
    padding: 0.2rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--card-bg-color);
    color: var(--text-color);
    font-size: 12px;
    font-weight: 600;
    pointer-events: none;
  }

  .network-legend span {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .network-legend i {
    width: 0.65rem;
    height: 0.2rem;
    border-radius: 999px;
  }

  .legend-download {
    background: #10b981;
  }

  .legend-upload {
    background: #3b82f6;
  }
</style>
