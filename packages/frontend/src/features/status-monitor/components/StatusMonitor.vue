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
      // Clipboard permissions are browser-controlled.
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
  const rateParts = (value?: number) => {
    const formatted = formatStatusRate(value);
    const index = formatted.indexOf(' ');
    return index < 0
      ? { value: formatted, unit: '' }
      : { value: formatted.slice(0, index), unit: formatted.slice(index + 1) };
  };

  const metrics = computed<
    Array<{
      key: ResourceMetric;
      name: string;
      percent: number;
      displayPercent: string;
      detail: string;
      compactDetail: string;
      color: string;
      icon: Component;
    }>
  >(() => {
    const status = monitor.current.value;
    return [
      {
        key: 'cpu',
        name: metricName('cpu'),
        percent: normalizedPercent(status?.cpuPercent),
        displayPercent: percent(status?.cpuPercent),
        detail: '',
        compactDetail: status?.cpuModel?.trim() || t('statusMonitor.notAvailable'),
        color: '#42a5ff',
        icon: CpuIcon,
      },
      {
        key: 'memory',
        name: metricName('memory'),
        percent: normalizedPercent(status?.memPercent),
        displayPercent: percent(status?.memPercent),
        detail: memory(status?.memUsed, status?.memTotal),
        compactDetail: memory(status?.memUsed, status?.memTotal),
        color: '#36d982',
        icon: MemoryIcon,
      },
      {
        key: 'swap',
        name: metricName('swap'),
        percent: normalizedPercent(status?.swapPercent),
        displayPercent: percent(status?.swapPercent),
        detail: swap(status?.swapUsed, status?.swapTotal),
        compactDetail: swap(status?.swapUsed, status?.swapTotal),
        color: '#a66cff',
        icon: SwapIcon,
      },
      {
        key: 'disk',
        name: metricName('disk'),
        percent: normalizedPercent(status?.diskPercent),
        displayPercent: percent(status?.diskPercent),
        detail: disk(status?.diskUsed, status?.diskTotal),
        compactDetail: disk(status?.diskUsed, status?.diskTotal),
        color: '#ff814a',
        icon: DiskIcon,
      },
    ];
  });

  const selectedMetricColor = computed(
    () =>
      ({ cpu: '#42a5ff', memory: '#36d982', swap: '#a66cff', disk: '#ff814a', network: '#36d982' })[
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

          <span class="auto-summary" aria-hidden="true">
            <span class="summary-row summary-resources">
              <span class="summary-metric summary-cpu"
                ><b>{{ metricName('cpu') }}</b
                ><span class="summary-percent">{{ percent(monitor.current.value.cpuPercent) }}</span></span
              >
              <i class="summary-separator">·</i>
              <span class="summary-metric summary-memory"
                ><b>{{ metricName('memory') }}</b
                ><span class="summary-percent">{{ percent(monitor.current.value.memPercent) }}</span></span
              >
              <i class="summary-separator">·</i>
              <span class="summary-metric summary-disk"
                ><b>{{ metricName('disk') }}</b
                ><span class="summary-percent">{{ percent(monitor.current.value.diskPercent) }}</span></span
              >
            </span>
            <span class="summary-row summary-network">
              <span class="rate-up">
                <UploadIcon />
                <span class="rate-value">{{ rateParts(monitor.current.value.netTxRate).value }}</span>
                <span class="rate-unit">{{ rateParts(monitor.current.value.netTxRate).unit }}</span>
              </span>
              <span class="rate-down">
                <DownloadIcon />
                <span class="rate-value">{{ rateParts(monitor.current.value.netRxRate).value }}</span>
                <span class="rate-unit">{{ rateParts(monitor.current.value.netRxRate).unit }}</span>
              </span>
            </span>
          </span>
        </header>

        <div class="monitor-content">
          <div class="metric-grid">
            <button
              v-for="metric in metrics"
              :key="metric.key"
              type="button"
              class="metric-card"
              :class="[{ selected: selectedMetric === metric.key }, `metric-${metric.key}`]"
              :style="{ '--metric-accent': metric.color, '--metric-value': `${metric.percent}%` }"
              :aria-label="`${metric.name} ${metric.displayPercent}`"
              @click="selectMetric(metric.key)"
            >
              <span v-if="metric.key === 'cpu'" class="cpu-water" aria-hidden="true">
                <span class="cpu-water-fill">
                  <svg class="cpu-wave" viewBox="0 0 240 12" preserveAspectRatio="none">
                    <path
                      d="M0 6 C14 3 24 9 40 6 S66 3 82 6 S108 9 124 6 S150 3 166 6 S192 9 208 6 S234 3 240 6 L240 12 L0 12 Z"
                    />
                  </svg>
                  <svg class="cpu-wave cpu-wave-two" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true">
                    <path
                      d="M0 7 C16 11 30 3 48 7 S76 12 92 7 S118 2 136 7 S162 12 180 7 S206 3 224 7 S238 11 240 7 L240 14 L0 14 Z"
                    />
                  </svg>
                  <i class="cpu-bubble bubble-one"></i>
                  <i class="cpu-bubble bubble-two"></i>
                  <i class="cpu-bubble bubble-three"></i>
                </span>
              </span>
              <span class="metric-top">
                <span class="metric-identity">
                  <span class="small-icon"><component :is="metric.icon" /></span>
                  <span class="metric-name">{{ metric.name }}</span>
                </span>
                <strong class="metric-percent">{{ metric.displayPercent }}</strong>
              </span>
              <span v-if="metric.detail" class="metric-detail metric-detail-full">{{ metric.detail }}</span>
              <span v-if="metric.compactDetail" class="metric-detail metric-detail-compact">{{
                metric.compactDetail
              }}</span>
              <span v-if="metric.key !== 'cpu'" class="metric-progress" aria-hidden="true"><i></i></span>
            </button>
          </div>

          <button
            type="button"
            class="network-card"
            :class="{ selected: selectedMetric === 'network' }"
            @click="selectMetric('network')"
          >
            <span class="network-title">
              <span>{{ t('statusMonitor.networkLabel') }}</span>
              <small>{{ monitor.current.value.netInterface || t('statusMonitor.networkInterfaceFallback') }}</small>
            </span>
            <span class="network-rate rate-down"
              ><DownloadIcon /><b>{{ formatStatusRate(monitor.current.value.netRxRate) }}</b></span
            >
            <span class="network-rate rate-up"
              ><UploadIcon /><b>{{ formatStatusRate(monitor.current.value.netTxRate) }}</b></span
            >
          </button>

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
    --status-border: color-mix(in srgb, var(--border-color) 72%, transparent);
    --status-surface: color-mix(in srgb, var(--header-bg-color) 62%, var(--app-bg-color));
    --status-surface-soft: color-mix(in srgb, var(--header-bg-color) 34%, var(--app-bg-color));
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: stretch;
    overflow: hidden;
    padding: 0.42rem;
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
    max-height: none;
    min-height: 0;
    display: flex;
    flex-direction: column;
    margin: 0;
    border: 1px solid var(--status-border);
    border-radius: 0.86rem;
    overflow: hidden;
    background: linear-gradient(
      180deg,
      var(--status-surface-soft),
      color-mix(in srgb, var(--app-bg-color) 96%, transparent)
    );
    box-shadow:
      0 14px 36px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 color-mix(in srgb, var(--text-color) 5%, transparent);
  }

  .monitor-header {
    width: 100%;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.52rem 0.7rem;
    border-bottom: 1px solid color-mix(in srgb, var(--border-color) 52%, transparent);
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
    font-size: 1rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .live-state {
    min-width: 0;
    max-width: min(10rem, 52cqw);
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    padding: 0.14rem 0.5rem;
    border: 1px solid rgba(52, 223, 125, 0.22);
    border-radius: 999px;
    color: #34df7d;
    background: rgba(52, 223, 125, 0.08);
    font-size: 0.74rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
  button.live-state {
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease,
      transform 0.15s ease;
  }
  button.live-state:hover {
    border-color: rgba(52, 223, 125, 0.45);
    background: rgba(52, 223, 125, 0.14);
  }
  button.live-state:active {
    transform: scale(0.97);
  }
  .live-state i {
    width: 0.34rem;
    height: 0.34rem;
    flex: none;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 6px currentColor;
  }
  .auto-summary {
    display: none;
  }
  .summary-row b {
    font-weight: 760;
  }
  .summary-cpu b {
    color: #42a5ff;
  }
  .summary-memory b {
    color: #36d982;
  }
  .summary-disk b {
    color: #ff814a;
  }

  .monitor-content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow: hidden;
    overscroll-behavior: contain;
    padding: 0.54rem;
  }

  .metric-grid {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  .metric-card {
    position: relative;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.3rem;
    padding: 0.5rem 0.55rem;
    border: 1px solid var(--status-border);
    border-radius: 0.68rem;
    color: inherit;
    background: var(--status-surface-soft);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    transition:
      transform 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .metric-card:hover {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--metric-accent) 48%, transparent);
    background: var(--status-surface);
  }
  .metric-card.selected {
    border-color: color-mix(in srgb, var(--metric-accent) 62%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--metric-accent) 12%, transparent);
  }
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
    display: flex;
    align-items: center;
    gap: 0.38rem;
  }
  .small-icon {
    width: 1.6rem;
    height: 1.6rem;
    flex: 0 0 1.6rem;
    display: grid;
    place-items: center;
    border: 1px solid color-mix(in srgb, var(--metric-accent) 26%, transparent);
    border-radius: 0.5rem;
    color: var(--metric-accent);
    background: color-mix(in srgb, var(--metric-accent) 10%, transparent);
  }
  .small-icon svg {
    width: 0.92rem;
    height: 0.92rem;
  }
  .metric-name {
    min-width: 0;
    overflow: hidden;
    color: var(--status-text);
    font-size: 0.84rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .metric-percent {
    flex: none;
    margin-left: auto;
    color: var(--metric-accent);
    font-size: 1.12rem;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    white-space: nowrap;
  }
  .metric-detail {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    width: 100%;
    min-width: 0;
    overflow: hidden;
    color: var(--status-muted);
    font-size: 0.78rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .metric-detail-compact {
    display: none;
  }
  .metric-progress {
    position: relative;
    z-index: 1;
    flex-shrink: 0;
    height: 0.24rem;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.14);
  }
  .metric-progress i {
    display: block;
    width: var(--metric-value);
    height: 100%;
    border-radius: inherit;
    background: var(--metric-accent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--metric-accent) 52%, transparent);
    transition: width 0.5s ease;
  }

  .cpu-water {
    position: absolute;
    z-index: 0;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    pointer-events: none;
  }
  .cpu-water-fill {
    --cpu-water-color: color-mix(in srgb, var(--metric-accent) 30%, var(--app-bg-color) 70%);
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: clamp(0%, var(--metric-value), 100%);
    max-height: 100%;
    min-height: 0;
    background: var(--cpu-water-color);
    transition: height 1.4s ease-in-out;
    will-change: height;
  }
  .cpu-wave {
    position: absolute;
    z-index: 2;
    top: -6px;
    left: -100%;
    width: 200%;
    height: 12px;
    color: var(--cpu-water-color);
    animation: waterWaveFlow 6s linear infinite;
  }
  .cpu-wave path {
    fill: currentColor;
    transform-origin: center;
    animation: waterWaveBob 3.8s linear infinite;
  }
  .cpu-wave-two {
    display: none;
  }
  .cpu-bubble {
    position: absolute;
    z-index: 3;
    bottom: 5%;
    width: 3px;
    height: 3px;
    border: 1px solid color-mix(in srgb, var(--metric-accent) 55%, var(--text-color) 10%);
    border-radius: 50%;
    background: color-mix(in srgb, var(--metric-accent) 13%, transparent);
    box-shadow:
      inset 0 0 2px rgba(255, 255, 255, 0.18),
      0 0 3px color-mix(in srgb, var(--metric-accent) 18%, transparent);
    opacity: 0;
    animation: bubbleRise 5.2s ease-in infinite;
  }
  .bubble-one {
    left: 22%;
    animation-delay: -0.8s;
  }
  .bubble-two {
    left: 58%;
    width: 4px;
    height: 4px;
    animation-delay: -2.5s;
    animation-duration: 6.1s;
  }
  .bubble-three {
    left: 78%;
    width: 2px;
    height: 2px;
    animation-delay: -3.4s;
    animation-duration: 4.6s;
  }
  @keyframes waterWaveFlow {
    to {
      transform: translateX(50%);
    }
  }
  @keyframes waterWaveBob {
    0%,
    100% {
      transform: translateY(0) scaleY(1);
    }
    38% {
      transform: translateY(-2px) scaleY(1.08);
    }
    62% {
      transform: translateY(1px) scaleY(0.9);
    }
  }
  @keyframes bubbleRise {
    0% {
      bottom: 4%;
      transform: translate3d(0, 1px, 0) scale(0.72);
      opacity: 0;
    }
    16% {
      opacity: 0.52;
    }
    72% {
      opacity: 0.3;
    }
    100% {
      bottom: calc(100% - 4px);
      transform: translate3d(3px, 0, 0) scale(1.05);
      opacity: 0;
    }
  }

  .network-card {
    width: 100%;
    min-width: 0;
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.52rem 0.6rem;
    border: 1px solid var(--status-border);
    border-radius: 0.68rem;
    color: inherit;
    background: var(--status-surface-soft);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }
  .network-card:hover {
    border-color: rgba(54, 217, 130, 0.42);
  }
  .network-card.selected {
    border-color: rgba(54, 217, 130, 0.55);
    box-shadow: inset 0 0 0 1px rgba(54, 217, 130, 0.09);
  }
  .network-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 0.34rem;
    font-size: 0.82rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .network-title small {
    max-width: 4.4rem;
    overflow: hidden;
    padding: 0.12rem 0.4rem;
    border: 1px solid var(--status-border);
    border-radius: 999px;
    color: var(--status-muted);
    background: var(--status-surface);
    font-size: 0.62rem;
    font-weight: 600;
    text-overflow: ellipsis;
  }
  .network-rate {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 0.24rem;
    font-size: 0.72rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .network-rate svg {
    width: 0.8rem;
    height: 0.8rem;
    flex: none;
  }
  .rate-down {
    color: #35db81;
  }
  .rate-up {
    color: #ff814a;
  }

  .history-card {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0.54rem 0.52rem 0.36rem;
    border: 1px solid var(--status-border);
    border-radius: 0.68rem;
    background: var(--status-surface-soft);
  }
  .history-header {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0 0.1rem 0.4rem;
  }
  .history-header > strong {
    min-width: 0;
    overflow: hidden;
    font-size: 0.8rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .range-tabs {
    flex: none;
    display: inline-flex;
    gap: 0.1rem;
    padding: 0.14rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--border-color) 18%, transparent);
  }
  .range-tabs button {
    min-width: 0;
    padding: 0.22rem 0.3rem;
    border: 0;
    border-radius: 0.38rem;
    color: var(--status-muted);
    background: transparent;
    font-size: 0.66rem;
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

  .status-surface:not(.has-history) .metric-grid {
    flex: 1 1 auto;
    min-height: 0;
    grid-auto-rows: minmax(0, 1fr);
    align-content: stretch;
  }
  .status-surface:not(.has-history) .metric-card {
    min-height: 0;
    height: 100%;
  }
  .has-history .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-auto-rows: auto;
    gap: 0.24rem;
  }
  .has-history .metric-card {
    min-height: 1.7rem;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    padding: 0.16rem 0.3rem;
    border-radius: 0.5rem;
  }
  .has-history .metric-top {
    flex: 1;
  }
  .has-history .metric-identity {
    gap: 0.3rem;
  }
  .has-history .small-icon,
  .has-history .metric-detail,
  .has-history .metric-progress,
  .has-history .cpu-water {
    display: none;
  }
  .has-history .metric-name,
  .has-history .metric-percent {
    font-size: 0.68rem;
  }
  .has-history .network-card {
    padding: 0.28rem 0.4rem;
    gap: 0.3rem;
  }
  .has-history .network-title small {
    display: none;
  }
  .has-history .history-card {
    flex: 1 1 0;
    min-height: 0;
  }

  @container status-pane (min-width: 301px) and (min-height: 460px) {
    .status-surface {
      padding: 0.5rem;
    }
    .monitor-header {
      padding: 0.58rem 0.74rem;
    }
    .monitor-content {
      padding: 0.6rem;
      gap: 0.56rem;
    }
    .metric-card {
      padding: 0.58rem 0.62rem;
      gap: 0.36rem;
    }
    .metric-percent {
      font-size: 1.26rem;
    }
    .small-icon {
      width: 1.8rem;
      height: 1.8rem;
      flex-basis: 1.8rem;
    }
    .small-icon svg {
      width: 1.02rem;
      height: 1.02rem;
    }
    .metric-name {
      font-size: 0.9rem;
    }
    .metric-progress {
      height: 0.3rem;
    }
    .network-card {
      padding: 0.6rem 0.68rem;
    }
    .history-card {
      padding: 0.6rem 0.58rem 0.4rem;
    }
  }

  @container status-pane (max-width: 300px) {
    .status-surface {
      padding: 0.28rem;
    }
    .monitor-header {
      padding: 0.4rem 0.5rem;
    }
    .header-main > strong {
      font-size: 0.86rem;
    }
    .live-state {
      padding: 0.1rem 0.36rem;
      font-size: 0.66rem;
    }
    .monitor-content {
      padding: 0.36rem;
      gap: 0.34rem;
    }
    .metric-grid {
      gap: 0.34rem;
    }
    .metric-card {
      padding: 0.4rem 0.44rem;
      gap: 0.22rem;
    }
    .small-icon {
      width: 1.42rem;
      height: 1.42rem;
      flex-basis: 1.42rem;
      border-radius: 0.44rem;
    }
    .small-icon svg {
      width: 0.82rem;
      height: 0.82rem;
    }
    .metric-name {
      font-size: 0.74rem;
    }
    .metric-percent {
      font-size: 0.94rem;
    }
    .metric-detail-full {
      display: none;
    }
    .metric-detail-compact {
      display: block;
      font-size: 0.62rem;
    }
    .network-card {
      grid-template-columns: minmax(0, 1fr) minmax(0, auto);
      column-gap: 0.24rem;
      row-gap: 0.06rem;
      padding: 0.24rem 0.48rem;
    }
    .network-title {
      grid-column: 1 / -1;
    }
    .network-rate {
      font-size: 0.62rem;
    }
    .network-rate.rate-up {
      justify-self: end;
    }
    .history-header {
      display: grid;
      grid-template-columns: 1fr;
    }
    .range-tabs {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @container status-pane (max-width: 175px) {
    .status-surface:not(.has-history) .metric-grid {
      grid-template-columns: 1fr;
    }
    .network-card {
      grid-template-columns: minmax(0, 1fr);
      row-gap: 0.08rem;
      padding-block: 0.2rem;
    }
    .network-title,
    .network-rate,
    .network-rate.rate-up {
      grid-column: 1;
      justify-self: center;
    }
    .network-title small {
      display: none;
    }
  }

  @container status-pane (max-height: 300px) {
    .history-header .range-tabs {
      display: none;
    }
    .status-surface .metric-detail-full,
    .status-surface .metric-detail-compact {
      display: none;
    }
  }

  @container status-pane (max-height: 235px) {
    .monitor-header {
      flex: 1 1 auto;
      min-height: 0;
      flex-direction: column;
      align-items: stretch;
      justify-content: flex-start;
      gap: 0.24rem;
    }
    .header-main {
      flex: 0 0 auto;
    }
    .auto-summary {
      flex: 1 1 auto;
      min-height: 0;
      display: grid;
      grid-template-rows: repeat(2, minmax(0, 1fr));
      align-content: stretch;
      gap: 0.2rem;
      padding: 0.26rem 0.5rem 0.4rem;
      color: var(--status-muted);
    }
    .monitor-content {
      display: none;
    }
    .summary-row {
      min-width: 0;
      width: 100%;
      min-height: 1.9rem;
      align-items: center;
      white-space: nowrap;
      font-size: clamp(0.78rem, 6.2cqw, 0.94rem);
      line-height: 1.35;
    }
    .summary-resources {
      display: flex;
      justify-content: center;
      gap: clamp(0.18rem, 2cqw, 0.36rem);
    }
    .summary-metric {
      min-width: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: clamp(0.22rem, 2cqw, 0.42rem);
    }
    .summary-percent {
      color: var(--status-text);
      font-variant-numeric: tabular-nums;
    }
    .summary-separator {
      align-self: center;
      color: rgba(148, 163, 184, 0.58);
      font-style: normal;
    }
    .summary-network {
      width: min(100%, 15rem);
      justify-self: center;
      display: grid;
      grid-template-columns: auto auto;
      justify-content: center;
      column-gap: 0.32rem;
    }
    .summary-network > span {
      display: grid;
      grid-template-columns: 0.88rem auto auto;
      align-items: center;
      column-gap: 0.12rem;
    }
    .summary-network svg {
      width: 0.88rem;
      height: 0.88rem;
    }
    .summary-network .rate-value {
      color: var(--status-text);
      font-variant-numeric: tabular-nums;
    }
    .summary-network .rate-unit {
      font-weight: 700;
    }
  }

  @container status-pane (max-width: 180px) and (max-height: 235px) {
    .auto-summary {
      display: flex;
      flex-direction: column;
      justify-content: space-evenly;
      padding-inline: 0.24rem;
    }
    .summary-resources,
    .summary-network {
      width: min(100%, 5.2rem);
      align-self: center;
      display: grid;
      grid-template-columns: 1fr;
      row-gap: 0.2rem;
    }
    .summary-separator {
      display: none;
    }
    .summary-metric {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 2.35rem;
      gap: 0.28rem;
    }
    .summary-metric b {
      justify-self: start;
    }
    .summary-percent {
      justify-self: end;
      text-align: right;
    }
    .summary-network > span {
      grid-template-columns: 0.82rem minmax(0, 1fr) max-content;
    }
  }

  @container status-pane (max-height: 130px) {
    .status-surface {
      padding: 0.16rem;
    }
    .monitor-header {
      padding: 0.2rem 0.38rem;
    }
    .header-main > strong {
      font-size: 0.76rem;
    }
    .live-state {
      gap: 0.22rem;
      font-size: 0.62rem;
    }
    .auto-summary {
      gap: 0.06rem;
      padding: 0.12rem 0.34rem 0.2rem;
    }
    .summary-row {
      font-size: clamp(0.6rem, 5.5cqw, 0.72rem);
      line-height: 1.1;
    }
  }

  @media (pointer: coarse) {
    .status-touch-target {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
