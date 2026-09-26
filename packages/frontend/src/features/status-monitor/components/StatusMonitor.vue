<script setup lang="ts">
  import { computed, defineAsyncComponent, defineComponent, h, ref, watch, type Component } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { UiSpinner } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  import { useFeedback } from '@/shared/feedback/public';
  import { useStatusMonitor, type StatusMonitorSessionController } from '../composables/useStatusMonitor';
  import {
    formatStatusDiskPair,
    formatStatusMemoryPair,
    formatStatusPercent,
    formatStatusRate,
    formatStatusSwapPair,
  } from '../model/statusFormatting';

  const StatusCharts = defineAsyncComponent({
    loader: () => import('./StatusCharts.vue'),
    loadingComponent: UiSpinner,
    delay: 120,
  });

  type ResourceMetric = 'cpu' | 'memory' | 'swap' | 'disk';
  type StatusMetric = ResourceMetric | 'network';

  const props = withDefaults(
    defineProps<{
      session: StatusMonitorSessionController;
      intervalSeconds?: number;
      showIp?: boolean;
      host?: string;
      scale?: number;
    }>(),
    { intervalSeconds: 3, showIp: true, scale: 1 },
  );
  const emit = defineEmits<{ 'update:scale': [scale: number] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const monitor = useStatusMonitor(props.session, () => props.intervalSeconds);
  const localScale = ref(props.scale);
  const selectedMetric = ref<StatusMetric | null>(null);
  const historyRange = ref<1 | 5 | 10 | 30>(5);
  const ranges = [1, 5, 10, 30] as const;
  const hasVisibleData = computed(() => Boolean(monitor.current.value && !monitor.error.value));
  const resolveScale = createWheelScaleResolver({ min: 0.65, max: 1.6, step: 0.1, precision: 2, thresholdPx: 72 });
  const scaleStyle = computed(() => {
    const scale = localScale.value;
    const inverse = 100 / scale;
    return {
      width: `${inverse}%`,
      height: `${inverse}%`,
      flex: '0 0 auto',
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
    };
  });

  watch(
    () => props.scale,
    (value) => {
      localScale.value = Math.min(1.6, Math.max(0.65, value));
    },
  );

  const handleWheel = (event: WheelEvent) => {
    const change = resolveScale(event, localScale.value);
    if (!change) return;
    localScale.value = change.next;
    emit('update:scale', change.next);
  };

  const copyHost = async () => {
    if (!props.host) return;
    try {
      await writeClipboardText(props.host);
      feedback.notifySuccess(t('common.copied'));
    } catch {
      feedback.notifyError(t('statusMonitor.copyIpError'));
    }
  };

  const icon = (paths: ReturnType<typeof h>[]) =>
    defineComponent({
      setup: () => () => h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, paths),
    });
  const stroke = {
    stroke: 'currentColor',
    'stroke-width': 1.65,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  };
  const CpuIcon = icon([
    h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.4, ...stroke }),
    h('rect', { x: 9, y: 9, width: 6, height: 6, rx: 1.1, fill: 'currentColor', 'fill-opacity': 0.18, ...stroke }),
    h('path', {
      d: 'M9 3v2M12 3v2M15 3v2M9 19v2M12 19v2M15 19v2M3 9h2M3 12h2M3 15h2M19 9h2M19 12h2M19 15h2',
      ...stroke,
    }),
  ]);
  const MemoryIcon = icon([
    h('rect', { x: 3.5, y: 7, width: 17, height: 10, rx: 2, ...stroke }),
    h('path', { d: 'M7 10v4M10.5 10v4M14 10v4M17.5 10v4M6 17v2M9 17v2M12 17v2M15 17v2M18 17v2', ...stroke }),
  ]);
  const SwapIcon = icon([
    h('rect', { x: 4, y: 4.5, width: 16, height: 6, rx: 1.8, ...stroke }),
    h('rect', { x: 4, y: 13.5, width: 16, height: 6, rx: 1.8, ...stroke }),
    h('path', { d: 'M8 8h7l-2-2M16 16H9l2 2', ...stroke }),
  ]);
  const DiskIcon = icon([
    h('rect', { x: 4, y: 3.5, width: 16, height: 17, rx: 3, ...stroke }),
    h('circle', { cx: 12, cy: 10, r: 4, ...stroke }),
    h('circle', { cx: 12, cy: 10, r: 1.1, fill: 'currentColor' }),
    h('path', { d: 'M12 10l3-2M7 17h6M16.5 17h.1', ...stroke }),
  ]);
  const DownloadIcon = icon([h('path', { d: 'M12 4v11M7.5 11.5 12 16l4.5-4.5M5 20h14', ...stroke })]);
  const UploadIcon = icon([h('path', { d: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14', ...stroke })]);

  const normalizedPercent = (value?: number) => Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
  const percent = (value?: number) => formatStatusPercent(value) ?? t('statusMonitor.notAvailable');
  const metricName = (key: ResourceMetric) => {
    const label =
      key === 'cpu'
        ? t('statusMonitor.cpuLabel')
        : key === 'memory'
          ? t('statusMonitor.memoryLabel')
          : key === 'swap'
            ? t('statusMonitor.swapLabel')
            : t('statusMonitor.diskLabel');
    return label.replace(/[:：]\s*$/, '');
  };
  const memory = (used?: number, total?: number) =>
    formatStatusMemoryPair(used, total) ?? t('statusMonitor.notAvailable');
  const swap = (used?: number, total?: number) => formatStatusSwapPair(used, total) ?? t('statusMonitor.notAvailable');
  const disk = (used?: number, total?: number) => formatStatusDiskPair(used, total) ?? t('statusMonitor.notAvailable');
  const compactRate = (bytesPerSecond?: number): string => {
    if (bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return '0B';
    const value = Math.max(0, bytesPerSecond);
    if (value < 1024) return `${Math.round(value)}B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)}K`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)}M`;
    return `${(value / 1024 ** 3).toFixed(1)}G`;
  };

  const metrics = computed<
    Array<{
      key: ResourceMetric;
      name: string;
      percent: number;
      displayPercent: string;
      detail: string;
      tooltip: string;
      color: string;
      icon: Component;
    }>
  >(() => {
    const status = monitor.current.value;
    const cpuLoad = status?.loadAvg?.length ? `${t('statusMonitor.load')} ${status.loadAvg[0].toFixed(2)}` : '';
    const cpuDetail =
      cpuLoad ||
      (status?.cpuModel
        ? status.cpuModel.length > 20
          ? `${status.cpuModel.slice(0, 18)}...`
          : status.cpuModel.trim()
        : '');
    const cpuTooltip = [
      status?.cpuModel?.trim(),
      status?.loadAvg?.length
        ? `${t('statusMonitor.load')}: ${status.loadAvg.map((l) => l.toFixed(2)).join(', ')}`
        : '',
    ]
      .filter(Boolean)
      .join(' | ');

    return [
      {
        key: 'cpu',
        name: metricName('cpu'),
        percent: normalizedPercent(status?.cpuPercent),
        displayPercent: percent(status?.cpuPercent),
        detail: cpuDetail,
        tooltip: cpuTooltip || `${metricName('cpu')} ${percent(status?.cpuPercent)}`,
        color: '#3b82f6',
        icon: CpuIcon,
      },
      {
        key: 'memory',
        name: metricName('memory'),
        percent: normalizedPercent(status?.memPercent),
        displayPercent: percent(status?.memPercent),
        detail: memory(status?.memUsed, status?.memTotal),
        tooltip: `${metricName('memory')} ${memory(status?.memUsed, status?.memTotal)} (${percent(status?.memPercent)})`,
        color: '#10b981',
        icon: MemoryIcon,
      },
      {
        key: 'swap',
        name: metricName('swap'),
        percent: normalizedPercent(status?.swapPercent),
        displayPercent: percent(status?.swapPercent),
        detail: swap(status?.swapUsed, status?.swapTotal),
        tooltip: `${metricName('swap')} ${swap(status?.swapUsed, status?.swapTotal)} (${percent(status?.swapPercent)})`,
        color: '#8b5cf6',
        icon: SwapIcon,
      },
      {
        key: 'disk',
        name: metricName('disk'),
        percent: normalizedPercent(status?.diskPercent),
        displayPercent: percent(status?.diskPercent),
        detail: disk(status?.diskUsed, status?.diskTotal),
        tooltip: `${metricName('disk')} ${disk(status?.diskUsed, status?.diskTotal)} (${percent(status?.diskPercent)})`,
        color: '#f59e0b',
        icon: DiskIcon,
      },
    ];
  });

  const selectedMetricColor = computed(
    () =>
      ({ cpu: '#3b82f6', memory: '#10b981', swap: '#8b5cf6', disk: '#f59e0b', network: '#10b981' })[
        selectedMetric.value ?? 'cpu'
      ],
  );
  const selectedMetricTitle = computed(() => t(`statusMonitor.trend.${selectedMetric.value ?? 'cpu'}`));
  const selectMetric = (metric: StatusMetric) => {
    selectedMetric.value = selectedMetric.value === metric ? null : metric;
  };
</script>

<template>
  <section
    data-testid="status-monitor"
    :data-status-scale="localScale.toFixed(2)"
    class="status-monitor h-full min-h-0"
    @wheel="handleWheel"
  >
    <div
      :style="scaleStyle"
      :data-status-scale="localScale.toFixed(2)"
      class="status-surface"
      :class="{ 'has-history': Boolean(selectedMetric), 'status-has-data': hasVisibleData }"
    >
      <div v-if="monitor.error.value" class="empty-state error-state">
        <i class="fas fa-exclamation-triangle"></i>
        <span>{{ t('statusMonitor.errorPrefix') }} {{ monitor.error.value }}</span>
      </div>
      <div v-else-if="!monitor.current.value" class="empty-state">
        <i class="fas fa-spinner fa-spin"></i>
        <span>{{ t('statusMonitor.loading') }}</span>
      </div>
      <section v-else class="monitor-panel">
        <header class="monitor-header">
          <span class="header-main">
            <strong>{{ t('statusMonitor.title') }}</strong>
            <button
              v-if="showIp && host"
              type="button"
              class="live-state status-touch-target"
              :title="host"
              @click="copyHost"
            >
              <i></i>{{ host }}
            </button>
            <span v-else class="live-state"><i></i>{{ t('statusMonitor.online') }}</span>
          </span>
        </header>

        <div class="monitor-content" :class="{ 'has-history': Boolean(selectedMetric) }">
          <div class="metric-list">
            <button
              v-for="metric in metrics"
              :key="metric.key"
              type="button"
              class="metric-card group"
              :class="[{ selected: selectedMetric === metric.key }, `metric-${metric.key}`]"
              :style="{ '--metric-accent': metric.color, '--metric-value': `${metric.percent}%` }"
              :aria-label="`${metric.name} ${metric.displayPercent}`"
              :title="metric.tooltip"
              @click="selectMetric(metric.key)"
            >
              <div class="metric-top">
                <div class="metric-identity">
                  <span class="small-icon"><component :is="metric.icon" /></span>
                  <span class="metric-name">{{ metric.name }}</span>
                </div>
                <span v-if="metric.detail" class="metric-detail" :title="metric.tooltip">{{ metric.detail }}</span>
              </div>
              <div class="metric-bottom">
                <div class="metric-progress" aria-hidden="true">
                  <i :style="{ width: `${metric.percent}%` }"></i>
                </div>
                <strong class="metric-percent">{{ metric.displayPercent }}</strong>
              </div>
            </button>

            <button
              type="button"
              class="metric-card network-card group"
              :class="{ selected: selectedMetric === 'network' }"
              :style="{ '--metric-accent': '#10b981' }"
              :aria-label="`${t('statusMonitor.networkLabel')} ↓ ${formatStatusRate(monitor.current.value.netRxRate)} ↑ ${formatStatusRate(monitor.current.value.netTxRate)}`"
              :title="`${t('statusMonitor.networkLabel')}${monitor.current.value.netInterface ? ` (${monitor.current.value.netInterface})` : ''}: ↓ ${formatStatusRate(monitor.current.value.netRxRate)} ↑ ${formatStatusRate(monitor.current.value.netTxRate)}`"
              @click="selectMetric('network')"
            >
              <div class="metric-top">
                <div class="metric-identity">
                  <span class="small-icon network-icon"><i class="fas fa-network-wired text-[10px]"></i></span>
                  <span class="metric-name">{{ t('statusMonitor.networkLabel') }}</span>
                </div>
                <span v-if="monitor.current.value.netInterface" class="metric-detail network-iface">{{
                  monitor.current.value.netInterface
                }}</span>
                <div class="network-history-rates">
                  <span class="rate-down"
                    >↓ <span class="rate-full">{{ formatStatusRate(monitor.current.value.netRxRate) }}</span
                    ><span class="rate-compact">{{ compactRate(monitor.current.value.netRxRate) }}</span></span
                  >
                  <span class="rate-up"
                    >↑ <span class="rate-full">{{ formatStatusRate(monitor.current.value.netTxRate) }}</span
                    ><span class="rate-compact">{{ compactRate(monitor.current.value.netTxRate) }}</span></span
                  >
                </div>
              </div>
              <div class="metric-bottom network-bottom">
                <div
                  class="network-pill rate-down"
                  :title="`${t('statusMonitor.networkDownload')}: ${formatStatusRate(monitor.current.value.netRxRate)}`"
                >
                  <DownloadIcon />
                  <span class="rate-val rate-full">{{ formatStatusRate(monitor.current.value.netRxRate) }}</span>
                  <span class="rate-val rate-compact">{{ compactRate(monitor.current.value.netRxRate) }}</span>
                </div>
                <div
                  class="network-pill rate-up"
                  :title="`${t('statusMonitor.networkUpload')}: ${formatStatusRate(monitor.current.value.netTxRate)}`"
                >
                  <UploadIcon />
                  <span class="rate-val rate-full">{{ formatStatusRate(monitor.current.value.netTxRate) }}</span>
                  <span class="rate-val rate-compact">{{ compactRate(monitor.current.value.netTxRate) }}</span>
                </div>
              </div>
            </button>
          </div>

          <section v-if="selectedMetric" class="history-card" :style="{ '--history-accent': selectedMetricColor }">
            <header class="history-header">
              <strong>{{ selectedMetricTitle }}</strong>
              <div class="range-tabs" role="group" :aria-label="t('statusMonitor.historyRange')">
                <button
                  v-for="range in ranges"
                  :key="range"
                  type="button"
                  :class="{ active: historyRange === range }"
                  @click="historyRange = range"
                >
                  {{ t('statusMonitor.minutes', { count: range }) }}
                </button>
              </div>
            </header>
            <StatusCharts
              :history="monitor.history.value"
              :metric="selectedMetric"
              :range-minutes="historyRange"
              :interval-seconds="intervalSeconds"
            />
          </section>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped src="./StatusMonitor.css"></style>
