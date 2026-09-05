<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Line } from 'vue-chartjs';
  import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Tooltip,
    Legend,
    type ChartData,
    type ChartOptions,
  } from 'chart.js';
  import type { StatusHistory, StatusHistoryPoint } from '../model/status';
  import { formatStatusPercent, formatStatusRate, formatStatusRateAxis } from '../model/statusFormatting';

  export type StatusMetric = 'cpu' | 'memory' | 'swap' | 'disk' | 'network';
  type DownsampleMode = 'average' | 'max';

  ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
  const props = withDefaults(
    defineProps<{
      history: StatusHistory;
      metric?: StatusMetric;
      rangeMinutes?: number;
      intervalSeconds?: number;
    }>(),
    { metric: 'cpu', rangeMinutes: 5, intervalSeconds: 3 },
  );
  const { t } = useI18n();
  const MAX_CHART_POINTS = 110;

  const expectedSamples = computed(() =>
    Math.max(2, Math.ceil((props.rangeMinutes * 60) / Math.max(1, props.intervalSeconds))),
  );
  const latestSequence = computed(() =>
    Math.max(
      0,
      props.history.cpu.at(-1)?.sequence ?? 0,
      props.history.memory.at(-1)?.sequence ?? 0,
      props.history.swap.at(-1)?.sequence ?? 0,
      props.history.disk.at(-1)?.sequence ?? 0,
      props.history.networkRx.at(-1)?.sequence ?? 0,
      props.history.networkTx.at(-1)?.sequence ?? 0,
    ),
  );
  const firstWindowSequence = computed(() => Math.max(1, latestSequence.value - expectedSamples.value + 1));
  const inRange = (points: StatusHistoryPoint[]) =>
    points.filter((point) => point.sequence >= firstWindowSequence.value && point.sequence <= latestSequence.value);

  /**
   * Buckets are anchored to the monotonic session sample sequence. Completed
   * buckets therefore stay stable as the rolling window advances; only the
   * right-most active bucket changes.
   */
  const stableDownsample = (points: StatusHistoryPoint[], mode: DownsampleMode = 'average'): StatusHistoryPoint[] => {
    const source = inRange(points);
    if (!source.length) return [];
    const bucketSize = Math.max(1, Math.ceil(expectedSamples.value / MAX_CHART_POINTS));
    if (bucketSize === 1) return source;

    const groups = new Map<number, { sum: number; count: number; max: number; time: number; sequence: number }>();
    for (const point of source) {
      const bucket = Math.floor((point.sequence - 1) / bucketSize);
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
      download: value('--status-success-color', chartTheme.value.download),
      upload: value('--status-warning-color', chartTheme.value.upload),
    };
  };
  let themeObserver: MutationObserver | null = null;
  onMounted(() => {
    readTheme();
    themeObserver = new MutationObserver(readTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  });
  onBeforeUnmount(() => themeObserver?.disconnect());

  const formatTime = (time: number) => new Date(time).toLocaleTimeString();
  const data = computed<ChartData<'line'>>(() => {
    if (props.metric === 'network') {
      const txBySequence = new Map(networkTx.value.map((point) => [point.sequence, point]));
      return {
        labels: networkRx.value.map((point) => formatTime(point.time)),
        datasets: [
          {
            label: t('statusMonitor.networkDownload'),
            data: networkRx.value.map((point) => point.value),
            borderColor: chartTheme.value.download,
            backgroundColor: chartTheme.value.download,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 3,
            tension: 0.12,
          },
          {
            label: t('statusMonitor.networkUpload'),
            data: networkRx.value.map((point) => txBySequence.get(point.sequence)?.value ?? 0),
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
      labels: percentageSeries.value.map((point) => formatTime(point.time)),
      datasets: [
        {
          label: singleLabel.value,
          data: percentageSeries.value.map((point) => point.value),
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
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        align: 'start',
        labels: {
          color: chartTheme.value.text,
          boxWidth: 8,
          boxHeight: 8,
          padding: 8,
          font: { size: 10 },
        },
      },
      tooltip: {
        backgroundColor: chartTheme.value.surface,
        borderColor: chartTheme.value.border,
        borderWidth: 1,
        titleColor: chartTheme.value.text,
        bodyColor: chartTheme.value.text,
        callbacks: {
          label: (context) => {
            const value = context.parsed.y ?? 0;
            const label = context.dataset.label ? `${context.dataset.label}: ` : '';
            return `${label}${props.metric === 'network' ? formatStatusRate(value) : (formatStatusPercent(value) ?? '0%')}`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { display: false, color: chartTheme.value.text, maxTicksLimit: 6 },
        grid: { display: false },
        border: { color: chartTheme.value.grid },
      },
      y:
        props.metric === 'network'
          ? {
              beginAtZero: true,
              min: 0,
              max: networkAxisMax.value,
              ticks: {
                color: chartTheme.value.text,
                font: { size: 9 },
                callback: (value) => formatStatusRateAxis(Number(value)),
              },
              grid: { color: chartTheme.value.grid, lineWidth: 0.5 },
              border: { color: chartTheme.value.grid },
            }
          : {
              beginAtZero: true,
              min: 0,
              max: 100,
              ticks: { color: chartTheme.value.text, font: { size: 9 }, callback: (value) => `${Number(value)}%` },
              grid: { color: chartTheme.value.grid, lineWidth: 0.5 },
              border: { color: chartTheme.value.grid },
            },
    },
  }));
</script>

<template>
  <div class="status-history-chart">
    <Line :data="data" :options="options" />
  </div>
</template>

<style scoped>
  .status-history-chart {
    min-width: 0;
    min-height: 5.5rem;
    height: 100%;
    flex: 1 1 auto;
    overflow: hidden;
  }

  @media (max-width: 640px) {
    .status-history-chart {
      min-height: 4.75rem;
    }
  }
</style>
