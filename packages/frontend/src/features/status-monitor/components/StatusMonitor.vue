<script setup lang="ts">
  import { computed, defineAsyncComponent, defineComponent, h, ref, watch, type Component } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseSpinner } from '@/foundation/ui';
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
    loadingComponent: BaseSpinner,
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
                <span
                  v-if="monitor.current.value.netInterface"
                  class="metric-detail network-iface"
                >{{ monitor.current.value.netInterface }}</span>
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

<style scoped>
  .status-monitor {
    container-type: size;
    container-name: status-pane;
    min-width: 0;
    overflow: hidden;
    overscroll-behavior: contain;
  }

  .status-surface {
    --status-text: var(--text-color);
    --status-muted: var(--text-color-secondary);
    --status-border: color-mix(in srgb, var(--border-color) 60%, transparent);
    --status-surface: color-mix(in srgb, var(--header-bg-color) 40%, var(--card-bg-color));
    --status-surface-soft: color-mix(in srgb, var(--header-bg-color) 20%, var(--card-bg-color));
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: stretch;
    overflow: hidden;
    padding: 0.35rem;
    color: var(--text-color);
    background: var(--app-bg-color);
    font-size: 0.84rem;
  }

  .empty-state {
    height: 100%;
    min-height: 8rem;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.6rem;
    color: var(--text-color-secondary);
    text-align: center;
  }
  .empty-state i {
    font-size: 1.35rem;
  }
  .error-state {
    color: #ef4444;
  }

  .monitor-panel {
    width: 100%;
    height: 100%;
    max-height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin: 0;
    border: 1px solid var(--status-border);
    border-radius: 0.75rem;
    overflow: hidden;
    background: var(--card-bg-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  }

  .monitor-header {
    width: 100%;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.45rem 0.65rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 40%, transparent);
    background: color-mix(in srgb, var(--header-bg-color) 40%, var(--card-bg-color));
  }
  .header-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .header-main > strong {
    min-width: 0;
    overflow: hidden;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-color);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .live-state {
    min-width: 0;
    max-width: min(10rem, 52cqw);
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.42rem;
    border: 1px solid rgba(16, 185, 129, 0.22);
    border-radius: 999px;
    color: #10b981;
    background: rgba(16, 185, 129, 0.08);
    font-size: 0.66rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
  button.live-state {
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  button.live-state:hover {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.14);
  }
  .live-state i {
    width: 0.32rem;
    height: 0.32rem;
    flex: none;
    border-radius: 50%;
    background: #10b981;
  }

  .monitor-content {
    flex: 1 1 0;
    min-height: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.38rem;
    gap: 0.35rem;
  }

  /* When no history chart is open, metric-list flexibly fills the entire height */
  .monitor-content:not(.has-history) .metric-list {
    flex: 1 1 0;
    min-height: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: clamp(0.32rem, 1.2cqh, 0.58rem);
  }

  .monitor-content:not(.has-history) .metric-card {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: clamp(0.12rem, 0.6cqh, 0.35rem);
    padding: clamp(0.22rem, 0.8cqh, 0.55rem) clamp(0.32rem, 1.5cqw, 0.55rem);
  }

  .metric-card {
    position: relative;
    min-width: 0;
    border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
    border-radius: 0.55rem;
    color: inherit;
    background: color-mix(in srgb, var(--header-bg-color) 20%, var(--card-bg-color));
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease;
  }
  .metric-card:hover {
    border-color: color-mix(in srgb, var(--border-color) 85%, transparent);
    background: color-mix(in srgb, var(--header-bg-color) 45%, var(--card-bg-color));
  }
  .metric-card.selected {
    border-color: var(--link-active-color);
    background: color-mix(in srgb, var(--link-active-color) 8%, var(--card-bg-color));
    box-shadow: inset 0 0 0 1px var(--link-active-color);
  }

  /* Metric Card Row 1: Top Identity & Capacity/Detail */
  .metric-top {
    position: relative;
    z-index: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .metric-identity {
    min-width: 0;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
  .small-icon {
    width: 1.25rem;
    height: 1.25rem;
    flex: 0 0 1.25rem;
    display: grid;
    place-items: center;
    border-radius: 0.3rem;
    color: var(--metric-accent);
    background: color-mix(in srgb, var(--metric-accent) 12%, transparent);
  }
  .small-icon svg {
    width: 0.78rem;
    height: 0.78rem;
  }
  .metric-name {
    flex-shrink: 0;
    color: var(--status-text);
    font-size: 0.78rem;
    font-weight: 600;
    white-space: nowrap;
  }
  .metric-detail {
    min-width: 0;
    overflow: hidden;
    color: var(--status-muted);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Metric Card Row 2: Bottom Progress Bar & Percentage */
  .metric-bottom {
    position: relative;
    z-index: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .metric-progress {
    flex: 1 1 auto;
    min-width: 0;
    height: 0.38rem;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in srgb, var(--text-color) 8%, transparent);
  }
  .metric-progress i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--metric-accent);
    transition: width 0.35s ease;
  }
  .metric-percent {
    flex: 0 0 3.4rem;
    text-align: right;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--status-text);
    line-height: 1;
    white-space: nowrap;
  }

  /* Network Card specific styling */
  .network-icon {
    color: #10b981;
    background: rgba(16, 185, 129, 0.12);
  }
  .network-iface {
    overflow: hidden;
    color: var(--status-muted);
    font-size: 0.68rem;
    font-family: var(--font-mono);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .network-history-rates {
    display: none;
    align-items: center;
    gap: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.64rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .has-history .network-history-rates {
    display: inline-flex;
    white-space: nowrap;
  }
  .has-history .network-history-rates span {
    white-space: nowrap;
  }
  .has-history .network-card .metric-top {
    justify-content: space-between;
  }
  .monitor-content:not(.has-history) .network-card {
    flex: 1.14 1 0;
    padding: clamp(0.24rem, 0.8cqh, 0.38rem) clamp(0.48rem, 2cqw, 0.65rem);
    gap: clamp(0.14rem, 0.5cqh, 0.24rem);
  }
  .monitor-content:not(.has-history) .network-card .small-icon {
    width: 1.18rem;
    height: 1.18rem;
    flex: 0 0 1.18rem;
  }
  .network-bottom {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.34rem;
    width: 100%;
  }
  .rate-compact {
    display: none;
  }
  .network-pill {
    min-width: 0;
    height: 1.05rem;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.18rem;
    padding: 0 0.28rem;
    border-radius: 0.28rem;
    font-family: var(--font-mono);
    font-size: 0.64rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
  }
  .network-pill svg {
    width: 0.64rem;
    height: 0.64rem;
    flex: none;
  }
  .rate-down {
    color: #10b981;
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.18);
  }
  .rate-up {
    color: #3b82f6;
    background: rgba(59, 130, 246, 0.08);
    border: 1px solid rgba(59, 130, 246, 0.18);
  }
  .rate-val {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* History trend mode styling */
  .has-history .metric-list {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.22rem;
  }
  .has-history .metric-card {
    min-height: 1.7rem;
    height: 1.7rem;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.35rem;
    padding: 0.15rem 0.45rem;
    border-radius: 0.45rem;
  }
  .has-history .metric-top {
    min-width: 0;
    flex: 1 1 auto;
    width: auto;
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.28rem;
  }
  .has-history .metric-identity {
    gap: 0.28rem;
  }
  .has-history .small-icon {
    width: 1.15rem;
    height: 1.15rem;
    flex: 0 0 1.15rem;
    border-radius: 0.25rem;
  }
  .has-history .small-icon svg {
    width: 0.7rem;
    height: 0.7rem;
  }
  .has-history .metric-name {
    font-size: 0.72rem;
  }
  .has-history .metric-detail,
  .has-history .metric-progress {
    display: none;
  }
  .has-history .metric-bottom {
    flex: 0 0 auto;
    width: auto;
    display: flex;
    align-items: center;
    gap: 0;
  }
  .has-history .metric-percent {
    flex: 0 0 auto;
    font-size: 0.72rem;
    text-align: right;
  }
  .has-history .network-card {
    grid-column: span 2;
  }
  .has-history .network-top {
    width: 100%;
  }
  .has-history .network-bottom {
    display: none;
  }

  .history-card {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0.45rem;
    border: 1px solid color-mix(in srgb, var(--border-color) 45%, transparent);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--header-bg-color) 20%, var(--card-bg-color));
  }
  .history-header {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0 0.1rem 0.35rem;
  }
  .history-header > strong {
    min-width: 0;
    overflow: hidden;
    font-size: 0.78rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .range-tabs {
    flex: none;
    display: inline-flex;
    gap: 0.1rem;
    padding: 0.12rem;
    border-radius: 0.4rem;
    background: color-mix(in srgb, var(--border-color) 18%, transparent);
  }
  .range-tabs button {
    min-width: 0;
    padding: 0.18rem 0.28rem;
    border: 0;
    border-radius: 0.3rem;
    color: var(--status-muted);
    background: transparent;
    font-size: 0.64rem;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }
  .range-tabs button.active {
    color: var(--status-text);
    background: color-mix(in srgb, var(--history-accent) 18%, var(--app-bg-color));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--history-accent) 28%, transparent);
  }

  @container status-pane (min-width: 301px) and (min-height: 460px) {
    .status-surface {
      padding: 0.45rem;
    }
    .monitor-header {
      padding: 0.5rem 0.65rem;
    }
    .monitor-content {
      padding: 0.45rem;
      gap: 0.4rem;
    }
    .monitor-content:not(.has-history) .metric-card {
      padding: 0.48rem 0.65rem;
    }
    .metric-percent {
      font-size: 0.88rem;
      flex-basis: 3.6rem;
    }
    .small-icon {
      width: 1.4rem;
      height: 1.4rem;
      flex-basis: 1.4rem;
    }
    .small-icon svg {
      width: 0.85rem;
      height: 0.85rem;
    }
    .metric-name {
      font-size: 0.82rem;
    }
    .history-card {
      padding: 0.5rem 0.5rem 0.35rem;
    }
  }

  @container status-pane (max-width: 220px) {
    .rate-full {
      display: none;
    }
    .rate-compact {
      display: inline;
    }
    .metric-percent {
      flex-basis: 2.9rem;
      font-size: 0.76rem;
    }
    .metric-detail {
      display: none;
    }
    .monitor-content:not(.has-history) .network-card {
      padding: 0.26rem 0.52rem 0.35rem;
      gap: 0.2rem;
    }
    .network-bottom {
      gap: 0.28rem;
    }
    .network-pill {
      font-size: 0.62rem;
      height: 1.05rem;
      padding: 0 0.24rem;
      gap: 0.16rem;
    }
    .network-pill svg {
      width: 0.6rem;
      height: 0.6rem;
    }
  }

  @container status-pane (max-width: 190px) {
    .monitor-header {
      padding: 0.32rem 0.42rem;
      gap: 0.25rem;
    }
    .header-main {
      gap: 0.25rem;
    }
    .header-main > strong {
      font-size: 0.76rem;
    }
    .live-state {
      padding: 0.06rem 0.26rem;
      font-size: 0.6rem;
      gap: 0.2rem;
    }
    .network-iface {
      display: none;
    }
    .metric-percent {
      flex-basis: 2.6rem;
      font-size: 0.72rem;
    }
    .small-icon {
      width: 1.15rem;
      height: 1.15rem;
      flex-basis: 1.15rem;
    }
    .small-icon svg {
      width: 0.7rem;
      height: 0.7rem;
    }
    .monitor-content:not(.has-history) .network-card {
      padding: 0.26rem 0.5rem 0.35rem;
      gap: 0.18rem;
    }
    .network-bottom {
      gap: 0.25rem;
    }
    .network-pill {
      font-size: 0.6rem;
      height: 1.02rem;
      padding: 0 0.22rem;
      gap: 0.14rem;
    }
    .network-pill svg {
      width: 0.56rem;
      height: 0.56rem;
    }
  }
  @container status-pane (max-height: 300px) {
    .history-header .range-tabs {
      display: none;
    }
  }

  @container status-pane (max-height: 250px) {
    .status-surface {
      padding: 0.18rem 0.24rem;
    }
    .monitor-header {
      flex: 0 0 auto;
      padding: 0.1rem 0.35rem;
      min-height: 0;
    }
    .header-main > strong {
      font-size: 0.76rem;
    }
    .live-state {
      padding: 0.04rem 0.24rem;
      font-size: 0.58rem;
    }
    .monitor-content {
      padding: 0.06rem 0.16rem;
      gap: 0;
      overflow-y: hidden;
    }
    .monitor-content:not(.has-history) .metric-list {
      flex: 1 1 0;
      min-height: 0;
      gap: clamp(0.06rem, 0.6cqh, 0.22rem);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .monitor-content:not(.has-history) .metric-card {
      flex: 1 1 0;
      min-height: 0;
      max-height: 2.2rem;
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      padding: clamp(0.04rem, 0.3cqh, 0.16rem) clamp(0.24rem, 1.2cqw, 0.42rem);
      gap: 0.35rem;
      border-radius: 0.38rem;
    }
    .monitor-content:not(.has-history) .metric-top {
      flex: 0 0 3.6rem;
      width: 3.6rem;
      gap: 0.25rem;
    }
    .monitor-content:not(.has-history) .metric-identity {
      gap: 0.25rem;
    }
    .monitor-content:not(.has-history) .small-icon {
      width: 1.05rem;
      height: 1.05rem;
      flex: 0 0 1.05rem;
      border-radius: 0.25rem;
    }
    .monitor-content:not(.has-history) .small-icon svg {
      width: 0.65rem;
      height: 0.65rem;
    }
    .monitor-content:not(.has-history) .metric-name {
      font-size: 0.72rem;
    }
    .monitor-content:not(.has-history) .metric-detail {
      display: none;
    }
    .monitor-content:not(.has-history) .metric-bottom:not(.network-bottom) {
      flex: 1 1 auto;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    .monitor-content:not(.has-history) .metric-progress {
      flex: 1 1 auto;
      min-width: 1.5rem;
      height: 0.26rem;
    }
    .monitor-content:not(.has-history) .metric-percent {
      flex: 0 0 2.7rem;
      font-size: 0.74rem;
    }
    .monitor-content:not(.has-history) .network-card .metric-top {
      flex: 0 0 3.6rem;
      width: 3.6rem;
    }
    .monitor-content:not(.has-history) .network-bottom {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 0.25rem;
      width: auto;
    }
    .monitor-content:not(.has-history) .network-pill {
      font-size: 0.62rem;
      padding: 0.05rem 0.24rem;
      gap: 0.18rem;
    }
    .monitor-content:not(.has-history) .network-iface {
      display: none;
    }
    .has-history .metric-card {
      min-height: 1.45rem;
      height: 1.45rem;
      padding: 0.1rem 0.35rem;
    }
  }

  @container status-pane (max-height: 155px) {
    .status-surface {
      padding: 0.12rem 0.16rem;
    }
    .monitor-header {
      padding: 0.06rem 0.28rem;
    }
    .header-main > strong {
      font-size: 0.7rem;
    }
    .live-state {
      padding: 0.02rem 0.2rem;
      font-size: 0.56rem;
    }
    .monitor-content {
      padding: 0.04rem 0.1rem;
    }
    .monitor-content:not(.has-history) .metric-list {
      gap: 0.06rem;
    }
    .monitor-content:not(.has-history) .metric-card {
      padding: 0.02rem 0.22rem;
      border-radius: 0.28rem;
    }
    .monitor-content:not(.has-history) .metric-top,
    .monitor-content:not(.has-history) .network-card .metric-top {
      flex: 0 0 3.3rem;
      width: 3.3rem;
    }
    .monitor-content:not(.has-history) .small-icon {
      width: 0.92rem;
      height: 0.92rem;
      flex: 0 0 0.92rem;
    }
    .monitor-content:not(.has-history) .small-icon svg {
      width: 0.55rem;
      height: 0.55rem;
    }
    .monitor-content:not(.has-history) .metric-name {
      font-size: 0.66rem;
    }
    .monitor-content:not(.has-history) .metric-progress {
      height: 0.2rem;
    }
    .monitor-content:not(.has-history) .metric-percent {
      flex: 0 0 2.4rem;
      font-size: 0.68rem;
    }
    .monitor-content:not(.has-history) .network-pill {
      font-size: 0.56rem;
      padding: 0.02rem 0.16rem;
      gap: 0.12rem;
    }
  }

  @container status-pane (max-height: 120px) {
    .status-surface {
      padding: 0.08rem 0.12rem;
    }
    .monitor-header {
      padding: 0.03rem 0.22rem;
    }
    .header-main > strong {
      font-size: 0.66rem;
    }
    .live-state {
      font-size: 0.52rem;
      padding: 0.01rem 0.16rem;
    }
    .monitor-content {
      overflow-y: auto;
    }
    .monitor-content:not(.has-history) .metric-list {
      gap: 0.04rem;
    }
    .monitor-content:not(.has-history) .metric-card {
      padding: 0.01rem 0.18rem;
    }
    .monitor-content:not(.has-history) .metric-top,
    .monitor-content:not(.has-history) .network-card .metric-top {
      flex: 0 0 3rem;
      width: 3rem;
    }
    .monitor-content:not(.has-history) .small-icon {
      width: 0.8rem;
      height: 0.8rem;
      flex: 0 0 0.8rem;
    }
    .monitor-content:not(.has-history) .small-icon svg {
      width: 0.48rem;
      height: 0.48rem;
    }
    .monitor-content:not(.has-history) .metric-name {
      font-size: 0.62rem;
    }
    .monitor-content:not(.has-history) .metric-progress {
      height: 0.16rem;
    }
    .monitor-content:not(.has-history) .metric-percent {
      flex: 0 0 2.2rem;
      font-size: 0.62rem;
    }
    .monitor-content:not(.has-history) .network-pill {
      font-size: 0.5rem;
      padding: 0.01rem 0.12rem;
    }
  }

  @container status-pane (min-width: 500px) and (max-height: 220px) {
    .status-surface {
      padding: 0.22rem 0.35rem;
    }
    .monitor-header {
      padding: 0.12rem 0.35rem;
    }
    .monitor-content {
      overflow-y: hidden;
    }
    .monitor-content:not(.has-history) .metric-list {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 0.32rem;
      height: 100%;
    }
    .monitor-content:not(.has-history) .metric-card {
      flex-direction: column;
      justify-content: center;
      padding: 0.24rem 0.42rem;
      gap: 0.22rem;
      height: 100%;
      max-height: none;
    }
    .monitor-content:not(.has-history) .metric-top {
      width: 100%;
      flex: 0 0 auto;
      justify-content: space-between;
    }
    .monitor-content:not(.has-history) .metric-detail {
      display: inline;
    }
    .monitor-content:not(.has-history) .metric-bottom:not(.network-bottom) {
      width: 100%;
      flex: 0 0 auto;
      gap: 0.35rem;
    }
    .monitor-content:not(.has-history) .network-card .metric-top {
      width: 100%;
      flex: 0 0 auto;
    }
    .monitor-content:not(.has-history) .network-bottom {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.2rem;
    }
    .monitor-content:not(.has-history) .network-pill {
      font-size: 0.6rem;
      padding: 0.04rem 0.14rem;
    }
  }

  @container status-pane (max-width: 220px) and (max-height: 250px) {
    .monitor-content:not(.has-history) .metric-top,
    .monitor-content:not(.has-history) .network-card .metric-top {
      flex: 0 0 3.2rem;
      width: 3.2rem;
    }
    .monitor-content:not(.has-history) .metric-percent {
      flex: 0 0 2.4rem;
      font-size: 0.7rem;
    }
  }

  @container status-pane (max-width: 190px) and (max-height: 250px) {
    .monitor-content:not(.has-history) .metric-top,
    .monitor-content:not(.has-history) .network-card .metric-top {
      flex: 0 0 2.9rem;
      width: 2.9rem;
    }
    .monitor-content:not(.has-history) .metric-percent {
      flex: 0 0 2.2rem;
      font-size: 0.66rem;
    }
    .monitor-content:not(.has-history) .small-icon {
      width: 0.95rem;
      height: 0.95rem;
      flex: 0 0 0.95rem;
    }
    .monitor-content:not(.has-history) .small-icon svg {
      width: 0.58rem;
      height: 0.58rem;
    }
  }
  @media (pointer: coarse) {
    .status-touch-target {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
