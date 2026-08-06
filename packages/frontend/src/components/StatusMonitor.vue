<template>
  <div
    class="status-monitor h-full bg-background text-foreground"
    :class="{
      'has-history': Boolean(selectedMetric),
      'bg-header': !activeSessionId,
    }"
  >
    <div v-if="!activeSessionId" class="empty-state">
      <i class="fas fa-plug"></i>
      <span>{{ t('layout.noActiveSession.title') }}</span>
    </div>

    <div v-else-if="currentStatusError" class="empty-state error-state">
      <i class="fas fa-exclamation-triangle"></i>
      <span>{{ t('statusMonitor.errorPrefix') }} {{ currentStatusError }}</span>
    </div>

    <div v-else-if="!currentServerStatus" class="empty-state">
      <i class="fas fa-spinner fa-spin"></i>
      <span>{{ t('statusMonitor.loading') }}</span>
    </div>

    <section v-else class="monitor-panel">
      <header class="monitor-header">
        <span class="header-main">
          <strong>{{ t('statusMonitor.title') }}</strong>
          <span
            v-if="statusMonitorShowIpBoolean && sessionIpAddress"
            class="live-state"
            role="button"
            tabindex="0"
            :title="`${sessionIpAddress} (点击复制)`"
            @click="copyIpToClipboard(sessionIpAddress)"
            @keydown.enter.prevent="copyIpToClipboard(sessionIpAddress)"
          >
            <i></i>{{ sessionIpAddress }}
          </span>
          <span v-else class="live-state"><i></i>在线</span>
        </span>

        <span class="auto-summary" aria-hidden="true">
          <span class="summary-row summary-resources">
            <span class="summary-metric summary-cpu"><b>CPU</b><span class="summary-percent">{{ formatPercentageText(displayCpuPercent) }}</span></span>
            <i class="summary-separator">·</i>
            <span class="summary-metric summary-memory"><b>内存</b><span class="summary-percent">{{ formatPercentageText(displayMemPercent) }}</span></span>
            <i class="summary-separator">·</i>
            <span class="summary-metric summary-disk"><b>磁盘</b><span class="summary-percent">{{ formatPercentageText(displayDiskPercent) }}</span></span>
          </span>
          <span class="summary-row summary-network">
            <span class="rate-up">
              <UploadIcon />
              <span class="rate-value">{{ formatRateParts(currentServerStatus?.netTxRate).value }}</span>
              <span class="rate-unit">{{ formatRateParts(currentServerStatus?.netTxRate).unit }}</span>
            </span>
            <span class="rate-down">
              <DownloadIcon />
              <span class="rate-value">{{ formatRateParts(currentServerStatus?.netRxRate).value }}</span>
              <span class="rate-unit">{{ formatRateParts(currentServerStatus?.netRxRate).unit }}</span>
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
            :aria-label="`${metric.name} ${formatPercentageText(metric.percent)}`"
            @click="selectMetric(metric.key)"
          >
            <span v-if="metric.key === 'cpu'" class="cpu-water" aria-hidden="true">
              <span class="cpu-water-fill">
                <svg class="cpu-wave" viewBox="0 0 240 12" preserveAspectRatio="none">
                  <path d="M0 6 C14 3 24 9 40 6 S66 3 82 6 S108 9 124 6 S150 3 166 6 S192 9 208 6 S234 3 240 6 L240 12 L0 12 Z" />
                </svg>
                <svg class="cpu-wave cpu-wave-two" viewBox="0 0 240 14" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M0 7 C16 11 30 3 48 7 S76 12 92 7 S118 2 136 7 S162 12 180 7 S206 3 224 7 S238 11 240 7 L240 14 L0 14 Z" />
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
              <strong class="metric-percent">{{ formatPercentageText(metric.percent) }}</strong>
            </span>
            <span v-if="metric.detail" class="metric-detail metric-detail-full">{{ metric.detail }}</span>
            <span v-if="metric.compactDetail" class="metric-detail metric-detail-compact">{{ metric.compactDetail }}</span>
            <span v-if="metric.key !== 'cpu'" class="metric-progress" aria-hidden="true">
              <i></i>
            </span>
          </button>
        </div>

        <button
          type="button"
          class="network-card"
          :class="{ selected: selectedMetric === 'network' }"
          @click="selectMetric('network')"
        >
          <span class="network-title">
            <span>网络流量</span>
            <small>{{ currentServerStatus?.netInterface || '网卡' }}</small>
          </span>
          <span class="network-rate rate-down"><DownloadIcon /><b>{{ formatBytesPerSecond(currentServerStatus?.netRxRate) }}</b></span>
          <span class="network-rate rate-up"><UploadIcon /><b>{{ formatBytesPerSecond(currentServerStatus?.netTxRate) }}</b></span>
        </button>

        <section v-if="selectedMetric" class="history-card" :style="{ '--history-accent': selectedMetricColor }">
          <header class="history-header">
            <strong>{{ selectedMetricTitle }}</strong>
            <div class="range-tabs" role="group" aria-label="历史时间范围">
              <button
                v-for="range in ranges"
                :key="range"
                type="button"
                :class="{ active: historyRange === range }"
                @click="historyRange = range"
              >{{ range }}m</button>
            </div>
          </header>

          <div v-if="selectedMetric === 'network'" class="chart-legend">
            <span class="rate-down"><i></i>下载</span>
            <span class="rate-up"><i></i>上传</span>
          </div>

          <div
            class="history-chart-wrap"
            @pointermove="handleHistoryPointerMove"
            @pointerleave="clearHistoryHover"
          >
            <svg class="history-chart" viewBox="0 0 248 126" preserveAspectRatio="none" role="img" :aria-label="`${selectedMetricTitle}图表`">
              <defs>
                <linearGradient id="historyAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="var(--history-accent)" stop-opacity=".34" />
                  <stop offset="1" stop-color="var(--history-accent)" stop-opacity="0" />
                </linearGradient>
              </defs>

              <g class="chart-grid">
                <line x1="12" y1="10" x2="240" y2="10" />
                <line x1="12" y1="52" x2="240" y2="52" />
                <line x1="12" y1="94" x2="240" y2="94" />
                <line x1="12" y1="10" x2="12" y2="94" />
                <line x1="126" y1="10" x2="126" y2="94" />
                <line x1="240" y1="10" x2="240" y2="94" />
              </g>

              <g class="axis-labels">
                <text class="axis-y-label" x="18" y="13" text-anchor="start">{{ yAxisLabels[0] }}</text>
                <text class="axis-y-label" x="18" y="55" text-anchor="start">{{ yAxisLabels[1] }}</text>
                <text class="axis-y-label" x="18" y="97" text-anchor="start">{{ yAxisLabels[2] }}</text>
                <text class="axis-x-label axis-x-start" x="12" y="116" text-anchor="start">-{{ historyRange }}m</text>
                <text class="axis-x-label axis-x-middle" x="126" y="116" text-anchor="middle">-{{ historyRange / 2 }}m</text>
                <text class="axis-x-label axis-x-end" x="240" y="116" text-anchor="end">当前</text>
              </g>

              <path
                v-if="selectedMetric !== 'network'"
                class="history-area"
                :d="singleAreaPath"
              />
              <polyline
                v-if="selectedMetric !== 'network'"
                class="history-line"
                :points="singleLinePoints"
              />
              <polyline
                v-if="selectedMetric === 'network'"
                class="history-line network-download-line"
                :points="networkDownloadPoints"
              />
              <polyline
                v-if="selectedMetric === 'network'"
                class="history-line network-upload-line"
                :points="networkUploadPoints"
              />

              <g v-if="historyHoverData" class="history-hover-marker" aria-hidden="true">
                <line :x1="historyHoverData.x" y1="10" :x2="historyHoverData.x" y2="94" />
                <circle
                  v-if="selectedMetric !== 'network'"
                  :cx="historyHoverData.x"
                  :cy="historyHoverData.primaryY"
                  r="3.2"
                />
                <circle
                  v-if="selectedMetric === 'network'"
                  class="history-hover-download"
                  :cx="historyHoverData.x"
                  :cy="historyHoverData.downloadY"
                  r="3.2"
                />
                <circle
                  v-if="selectedMetric === 'network'"
                  class="history-hover-upload"
                  :cx="historyHoverData.x"
                  :cy="historyHoverData.uploadY"
                  r="3.2"
                />
              </g>
            </svg>

            <div
              v-if="historyHoverData"
              class="history-tooltip"
              :style="{ '--history-hover-left': `${historyHoverData.leftPercent}%` }"
              aria-hidden="true"
            >
              <strong>{{ historyHoverData.timeLabel }}</strong>
              <template v-if="selectedMetric === 'network'">
                <span class="history-tooltip-row rate-down">
                  <i></i><span>下载</span><b>{{ formatBytesPerSecond(historyHoverData.downloadValue) }}</b>
                </span>
                <span class="history-tooltip-row rate-up">
                  <i></i><span>上传</span><b>{{ formatBytesPerSecond(historyHoverData.uploadValue) }}</b>
                </span>
              </template>
              <span v-else class="history-tooltip-row">
                <i></i><span>{{ selectedMetricLabel }}</span><b>{{ formatHistoryPercentage(historyHoverData.primaryValue) }}</b>
              </span>
            </div>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, ref, watch, type Component, type PropType } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useSessionStore } from '../stores/session.store';
import { useSettingsStore } from '../stores/settings.store';
import { useConnectionsStore } from '../stores/connections.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';

interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number;
  memTotal?: number;
  swapPercent?: number;
  swapUsed?: number;
  swapTotal?: number;
  diskPercent?: number;
  diskUsed?: number;
  diskTotal?: number;
  cpuModel?: string;
  netRxRate?: number;
  netTxRate?: number;
  netInterface?: string;
  osName?: string;
}

type MetricKey = 'cpu' | 'memory' | 'swap' | 'disk';
type SelectedMetric = MetricKey | 'network';

const props = defineProps({
  activeSessionId: {
    type: String as PropType<string | null>,
    default: null,
  },
});

const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore();
const connectionsStore = useConnectionsStore();
const uiNotificationsStore = useUiNotificationsStore();
const { sessions } = storeToRefs(sessionStore);
const { statusMonitorShowIpBoolean, statusMonitorIntervalSecondsNumber } = storeToRefs(settingsStore);

const icon = (paths: ReturnType<typeof h>[]) => defineComponent({
  setup: () => () => h('svg', { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' }, paths),
});
const stroke = { stroke: 'currentColor', 'stroke-width': 1.65, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

const CpuIcon = icon([
  h('rect', { x: 6, y: 6, width: 12, height: 12, rx: 2.4, ...stroke }),
  h('rect', { x: 9, y: 9, width: 6, height: 6, rx: 1.1, fill: 'currentColor', 'fill-opacity': .18, ...stroke }),
  h('path', { d: 'M9 3v2M12 3v2M15 3v2M9 19v2M12 19v2M15 19v2M3 9h2M3 12h2M3 15h2M19 9h2M19 12h2M19 15h2', ...stroke }),
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
const DownloadIcon = icon([
  h('path', { d: 'M12 4v11M7.5 11.5 12 16l4.5-4.5M5 20h14', ...stroke }),
]);
const UploadIcon = icon([
  h('path', { d: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14', ...stroke }),
]);

const selectedMetric = ref<SelectedMetric | null>(null);
const historyRange = ref<1 | 5 | 10 | 30>(5);
const ranges = [1, 5, 10, 30] as const;

const currentSessionState = computed(() => props.activeSessionId ? sessions.value.get(props.activeSessionId) : null);
const currentServerStatus = computed<ServerStatus | null>(() => currentSessionState.value?.statusMonitorManager?.serverStatus?.value ?? null);
const currentStatusError = computed<string | null>(() => currentSessionState.value?.statusMonitorManager?.statusError?.value ?? null);

const displayCpuPercent = computed(() => currentServerStatus.value?.cpuPercent ?? 0);
const displayMemPercent = computed(() => currentServerStatus.value?.memPercent ?? 0);
const displaySwapPercent = computed(() => currentServerStatus.value?.swapPercent ?? 0);
const displayDiskPercent = computed(() => currentServerStatus.value?.diskPercent ?? 0);

const normalizePercentage = (percentage: number) => Math.round(Math.max(0, Math.min(100, percentage)));
const formatPercentageText = (percentage: number) => `${normalizePercentage(percentage)}%`;

const formatBytesPerSecond = (bytes?: number): string => {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '0 B/s';
  if (bytes < 1024) return `${Math.round(bytes)} B/s`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB/s`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB/s`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB/s`;
};

const formatRateParts = (bytes?: number): { value: string; unit: string } => {
  const formatted = formatBytesPerSecond(bytes);
  const separatorIndex = formatted.indexOf(' ');
  if (separatorIndex < 0) return { value: formatted, unit: '' };
  return {
    value: formatted.slice(0, separatorIndex),
    unit: formatted.slice(separatorIndex + 1),
  };
};

const formatMemorySize = (mb?: number): string => {
  if (mb === undefined || mb === null || Number.isNaN(mb)) return '—';
  if (mb < 1024) return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
};

const formatKbToGb = (kb?: number): string => {
  if (kb === undefined || kb === null || Number.isNaN(kb)) return '—';
  return `${(kb / 1024 / 1024).toFixed(1)} GB`;
};

const formatMemoryPair = (used: number, total: number) => {
  if (total >= 1024) return `${(used / 1024).toFixed(1)} / ${(total / 1024).toFixed(1)} GB`;
  return `${Math.round(used)} / ${Math.round(total)} MB`;
};

const formatMemoryPairCompact = (used: number, total: number) => {
  if (total >= 1024) return `${(used / 1024).toFixed(1)}/${(total / 1024).toFixed(1)}G`;
  return `${Math.round(used)}/${Math.round(total)}M`;
};

const memDisplay = computed(() => {
  const data = currentServerStatus.value;
  return data?.memUsed === undefined || data.memTotal === undefined ? '—' : formatMemoryPair(data.memUsed, data.memTotal);
});
const memDisplayCompact = computed(() => {
  const data = currentServerStatus.value;
  return data?.memUsed === undefined || data.memTotal === undefined ? '—' : formatMemoryPairCompact(data.memUsed, data.memTotal);
});
const swapDisplay = computed(() => {
  const data = currentServerStatus.value;
  return !data?.swapTotal ? '0 / 0 GB' : formatMemoryPair(data.swapUsed ?? 0, data.swapTotal);
});
const swapDisplayCompact = computed(() => {
  const data = currentServerStatus.value;
  return !data?.swapTotal ? '0/0G' : formatMemoryPairCompact(data.swapUsed ?? 0, data.swapTotal);
});
const diskDisplay = computed(() => {
  const data = currentServerStatus.value;
  return data?.diskUsed === undefined || data.diskTotal === undefined ? '—' : `${(data.diskUsed / 1024 / 1024).toFixed(1)} / ${(data.diskTotal / 1024 / 1024).toFixed(1)} GB`;
});
const diskDisplayCompact = computed(() => {
  const data = currentServerStatus.value;
  return data?.diskUsed === undefined || data.diskTotal === undefined ? '—' : `${(data.diskUsed / 1024 / 1024).toFixed(1)}/${(data.diskTotal / 1024 / 1024).toFixed(1)}G`;
});
const cpuModelDisplay = computed(() => {
  const model = currentServerStatus.value?.cpuModel;
  return model && model.trim() ? model.trim() : '—';
});

const metrics = computed<Array<{ key: MetricKey; name: string; percent: number; detail: string; compactDetail: string; color: string; icon: Component }>>(() => [
  { key: 'cpu', name: 'CPU', percent: displayCpuPercent.value, detail: '', compactDetail: cpuModelDisplay.value, color: '#42a5ff', icon: CpuIcon },
  { key: 'memory', name: '内存', percent: displayMemPercent.value, detail: memDisplay.value, compactDetail: memDisplayCompact.value, color: '#36d982', icon: MemoryIcon },
  { key: 'swap', name: 'Swap', percent: displaySwapPercent.value, detail: swapDisplay.value, compactDetail: swapDisplayCompact.value, color: '#a66cff', icon: SwapIcon },
  { key: 'disk', name: '磁盘', percent: displayDiskPercent.value, detail: diskDisplay.value, compactDetail: diskDisplayCompact.value, color: '#ff814a', icon: DiskIcon },
]);

const sessionIpAddress = computed(() => {
  const connectionId = currentSessionState.value?.connectionId;
  if (!connectionId) return null;
  const id = Number.parseInt(connectionId, 10);
  if (Number.isNaN(id)) return null;
  return connectionsStore.connections.find(connection => connection.id === id)?.host || null;
});

const selectMetric = (metric: SelectedMetric) => {
  selectedMetric.value = selectedMetric.value === metric ? null : metric;
};

const selectedMetricTitle = computed(() => ({
  cpu: 'CPU 趋势',
  memory: '内存趋势',
  swap: 'Swap 趋势',
  disk: '磁盘趋势',
  network: '网络趋势',
}[selectedMetric.value || 'cpu']));
const selectedMetricLabel = computed(() => ({
  cpu: 'CPU',
  memory: '内存',
  swap: 'Swap',
  disk: '磁盘',
  network: '网络',
}[selectedMetric.value || 'cpu']));
const selectedMetricColor = computed(() => ({
  cpu: '#42a5ff', memory: '#36d982', swap: '#a66cff', disk: '#ff814a', network: '#36d982',
}[selectedMetric.value || 'cpu']));

const manager = computed(() => currentSessionState.value?.statusMonitorManager);
const historySampleCount = computed(() => {
  const interval = Math.max(1, statusMonitorIntervalSecondsNumber.value || 3);
  return Math.max(2, Math.ceil((historyRange.value * 60) / interval));
});

const sliceHistory = (values: readonly (number | null)[] | undefined) => {
  const source = values ?? [];
  return source.slice(-historySampleCount.value).map(value => Number.isFinite(value) ? Number(value) : 0);
};

const percentHistory = computed(() => {
  if (!selectedMetric.value || selectedMetric.value === 'network') return [];
  if (selectedMetric.value === 'cpu') return sliceHistory(manager.value?.cpuHistory?.value);
  if (selectedMetric.value === 'swap') return sliceHistory(manager.value?.swapPercentHistory?.value);
  if (selectedMetric.value === 'disk') return sliceHistory(manager.value?.diskPercentHistory?.value);
  const used = sliceHistory(manager.value?.memUsedHistory?.value);
  const total = currentServerStatus.value?.memTotal || 0;
  return total ? used.map(value => Math.min(100, Math.max(0, value / total * 100))) : used.map(() => 0);
});
const networkRxHistory = computed(() => sliceHistory(manager.value?.netRxHistory?.value));
const networkTxHistory = computed(() => sliceHistory(manager.value?.netTxHistory?.value));

const downsample = (values: number[], maxPoints = 110) => {
  if (values.length <= maxPoints) return values;
  const bucket = values.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, index) => {
    const start = Math.floor(index * bucket);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucket));
    const group = values.slice(start, end);
    return group.reduce((sum, value) => sum + value, 0) / group.length;
  });
};

const HISTORY_VIEWBOX_WIDTH = 248;
const HISTORY_PLOT_LEFT = 12;
const HISTORY_PLOT_RIGHT = 240;
const HISTORY_PLOT_TOP = 10;
const HISTORY_PLOT_BOTTOM = 94;
const HISTORY_PLOT_WIDTH = HISTORY_PLOT_RIGHT - HISTORY_PLOT_LEFT;
const HISTORY_PLOT_HEIGHT = HISTORY_PLOT_BOTTOM - HISTORY_PLOT_TOP;

const sampledPercentHistory = computed(() => downsample(percentHistory.value));
const sampledNetworkRxHistory = computed(() => downsample(networkRxHistory.value));
const sampledNetworkTxHistory = computed(() => downsample(networkTxHistory.value));
const historyHoverRatio = ref<number | null>(null);

const networkHistoryMax = computed(() => Math.max(
  ...networkRxHistory.value,
  ...networkTxHistory.value,
  currentServerStatus.value?.netRxRate ?? 0,
  currentServerStatus.value?.netTxRate ?? 0,
  1,
));

const pointString = (values: number[], maxValue: number) => {
  if (!values.length) return `${HISTORY_PLOT_LEFT},${HISTORY_PLOT_BOTTOM}`;
  return values.map((value, index) => {
    const x = HISTORY_PLOT_LEFT + (values.length === 1 ? HISTORY_PLOT_WIDTH : index / (values.length - 1) * HISTORY_PLOT_WIDTH);
    const y = HISTORY_PLOT_BOTTOM - Math.min(1, Math.max(0, value / Math.max(1, maxValue))) * HISTORY_PLOT_HEIGHT;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
};

const singleLinePoints = computed(() => pointString(sampledPercentHistory.value, 100));
const singleAreaPath = computed(() => `M${HISTORY_PLOT_LEFT},${HISTORY_PLOT_BOTTOM} L${singleLinePoints.value.replaceAll(' ', ' L')} L${HISTORY_PLOT_RIGHT},${HISTORY_PLOT_BOTTOM} Z`);
const networkDownloadPoints = computed(() => pointString(sampledNetworkRxHistory.value, networkHistoryMax.value));
const networkUploadPoints = computed(() => pointString(sampledNetworkTxHistory.value, networkHistoryMax.value));

const valueAtRatio = (values: number[], ratio: number) => {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  return values[Math.round(Math.max(0, Math.min(1, ratio)) * (values.length - 1))] ?? 0;
};

const historyValueY = (value: number, maxValue: number) => (
  HISTORY_PLOT_BOTTOM
  - Math.min(1, Math.max(0, value / Math.max(1, maxValue))) * HISTORY_PLOT_HEIGHT
);

const formatHistoryPercentage = (value: number) => {
  const normalized = Math.max(0, Math.min(100, value));
  return `${Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(1)}%`;
};

const formatHistoryTimeAgo = (secondsAgo: number) => {
  const roundedSeconds = Math.max(0, Math.round(secondsAgo));
  if (roundedSeconds <= Math.max(1, Math.round((statusMonitorIntervalSecondsNumber.value || 3) / 2))) return '当前';
  if (roundedSeconds < 60) return `${roundedSeconds} 秒前`;
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return seconds >= 10 ? `${minutes} 分 ${seconds} 秒前` : `${minutes} 分前`;
};

const historyHoverData = computed(() => {
  const ratio = historyHoverRatio.value;
  if (ratio === null || !selectedMetric.value) return null;

  const primaryValues = sampledPercentHistory.value;
  const downloadValues = sampledNetworkRxHistory.value;
  const uploadValues = sampledNetworkTxHistory.value;
  const sourceLength = selectedMetric.value === 'network'
    ? Math.max(networkRxHistory.value.length, networkTxHistory.value.length)
    : percentHistory.value.length;
  if (!sourceLength) return null;

  const primaryValue = valueAtRatio(primaryValues, ratio);
  const downloadValue = valueAtRatio(downloadValues, ratio);
  const uploadValue = valueAtRatio(uploadValues, ratio);
  const x = HISTORY_PLOT_LEFT + ratio * HISTORY_PLOT_WIDTH;
  const secondsPerSample = Math.max(1, statusMonitorIntervalSecondsNumber.value || 3);
  const secondsAgo = (1 - ratio) * Math.max(0, sourceLength - 1) * secondsPerSample;

  return {
    x,
    leftPercent: x / HISTORY_VIEWBOX_WIDTH * 100,
    timeLabel: formatHistoryTimeAgo(secondsAgo),
    primaryValue,
    primaryY: historyValueY(primaryValue, 100),
    downloadValue,
    downloadY: historyValueY(downloadValue, networkHistoryMax.value),
    uploadValue,
    uploadY: historyValueY(uploadValue, networkHistoryMax.value),
  };
});

const handleHistoryPointerMove = (event: PointerEvent) => {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const sourceLength = selectedMetric.value === 'network'
    ? Math.max(sampledNetworkRxHistory.value.length, sampledNetworkTxHistory.value.length)
    : sampledPercentHistory.value.length;
  if (!sourceLength) {
    historyHoverRatio.value = null;
    return;
  }
  const rect = target.getBoundingClientRect();
  if (!rect.width) return;
  const svgX = (event.clientX - rect.left) / rect.width * HISTORY_VIEWBOX_WIDTH;
  const rawRatio = Math.max(0, Math.min(1, (svgX - HISTORY_PLOT_LEFT) / HISTORY_PLOT_WIDTH));
  const nearestIndex = Math.round(rawRatio * Math.max(0, sourceLength - 1));
  historyHoverRatio.value = sourceLength === 1 ? 1 : nearestIndex / (sourceLength - 1);
};

const clearHistoryHover = () => {
  historyHoverRatio.value = null;
};

const formatAxisRate = (bytes: number) => {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)}K`;
  return `${Math.round(bytes)}`;
};
const yAxisLabels = computed(() => selectedMetric.value === 'network'
  ? [formatAxisRate(networkHistoryMax.value), formatAxisRate(networkHistoryMax.value / 2), '0']
  : ['100%', '50%', '0']);

watch(() => props.activeSessionId, () => {
  selectedMetric.value = null;
});
watch([selectedMetric, historyRange], clearHistoryHover);

let attachedStatusManager: { activate: () => void; deactivate: () => void; refreshInterval?: () => void } | null = null;
let componentActive = false;
const syncStatusSubscription = () => {
  const nextManager = currentSessionState.value?.statusMonitorManager ?? null;
  if (attachedStatusManager === nextManager) return;
  if (componentActive) attachedStatusManager?.deactivate();
  attachedStatusManager = nextManager;
  if (componentActive) attachedStatusManager?.activate();
};
watch(currentSessionState, syncStatusSubscription);
watch(statusMonitorIntervalSecondsNumber, (nextInterval, previousInterval) => {
  if (nextInterval === previousInterval || !componentActive) return;
  attachedStatusManager?.refreshInterval?.();
});

import { onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
const activateStatusComponent = () => {
  if (componentActive) return;
  componentActive = true;
  attachedStatusManager = currentSessionState.value?.statusMonitorManager ?? null;
  attachedStatusManager?.activate();
};
const deactivateStatusComponent = () => {
  if (!componentActive) return;
  componentActive = false;
  attachedStatusManager?.deactivate();
};
onMounted(activateStatusComponent);
onActivated(activateStatusComponent);
onDeactivated(deactivateStatusComponent);
onBeforeUnmount(deactivateStatusComponent);

const copyIpToClipboard = async (ipAddress: string | null) => {
  if (!ipAddress) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(ipAddress);
    } else {
      // http / 非安全上下文: 用临时 textarea + execCommand 兜底
      const textarea = document.createElement('textarea');
      textarea.value = ipAddress;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    uiNotificationsStore.showSuccess(t('common.copied', '已复制!'));
  } catch (error) {
    console.error('Failed to copy IP address:', error);
    uiNotificationsStore.showError(t('statusMonitor.copyIpError', '复制 IP 失败'));
  }
};
</script>


<style scoped>
/* ============================================================
   StatusMonitor v2 - 极简深色玻璃拟态
   设计原则:
   - 层级: 标题 > 大数字 > 明细 > 辅助信息, 视觉焦点清晰
   - 配色: 语义色 (CPU蓝/内存绿/Swap紫/磁盘橙) 降饱和,
     与主题变量联动, 暗色下自然, 亮色下也不刺眼
   - 克制: 移除水波/环形等重装饰, 只保留细进度条+光晕
   - 自适应: container query 三档 (窄/中/宽) + 矮屏摘要模式
   ============================================================ */
.status-monitor {
  container-type: size;
  container-name: status-pane;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: stretch;
  overflow: hidden;
  padding: 0.42rem;
  font-size: 0.84rem;
}
.empty-state {
  height: 100%;
  min-height: 8rem;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 0.6rem;
  color: var(--text-secondary-color);
  text-align: center;
}
.empty-state i { font-size: 1.35rem; }
.error-state { color: #ef4444; }

/* ---------- 面板外壳 ---------- */
.monitor-panel {
  width: 100%;
  height: 100%;
  max-height: none;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin: 0;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 0.86rem;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(255,255,255,.022), rgba(255,255,255,.006));
  box-shadow: 0 14px 36px rgba(0,0,0,.16), inset 0 1px 0 rgba(255,255,255,.025);
}

/* ---------- 头部 ---------- */
.monitor-header {
  width: 100%;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.52rem 0.7rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
}
.header-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.header-main > strong {
  min-width: 0;
  font-size: 1rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.live-state {
  min-width: 0;
  max-width: min(10rem, 52cqw);
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  padding: 0.14rem 0.5rem;
  border-radius: 999px;
  color: #34df7d;
  background: rgba(52, 223, 125, 0.08);
  border: 1px solid rgba(52, 223, 125, 0.22);
  font-size: 0.74rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.live-state i {
  width: 0.34rem;
  height: 0.34rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
}
.live-state[role="button"] {
  cursor: pointer;
  transition: border-color .15s ease, background .15s ease, transform .15s ease;
}
.live-state[role="button"]:hover {
  border-color: rgba(52, 223, 125, 0.45);
  background: rgba(52, 223, 125, 0.14);
}
.live-state[role="button"]:active { transform: scale(0.97); }
.auto-summary { display: none; }
.summary-row b { font-weight: 760; }
.summary-cpu b { color: #42a5ff; }
.summary-memory b { color: #36d982; }
.summary-disk b { color: #ff814a; }

/* ---------- 内容区 ---------- */
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

/* ---------- 指标网格 ---------- */
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
  border: 1px solid rgba(148,163,184,.13);
  border-radius: 0.68rem;
  color: inherit;
  background: rgba(148,163,184,.028);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: transform .15s ease, border-color .15s ease, background .15s ease;
}
.metric-card:hover {
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--metric-accent) 48%, transparent);
  background: rgba(148,163,184,.05);
}
.metric-card.selected {
  border-color: color-mix(in srgb, var(--metric-accent) 62%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--metric-accent) 12%, transparent);
}
.metric-top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  min-width: 0;
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
  border: 1px solid color-mix(in srgb, var(--metric-accent, #42a5ff) 26%, transparent);
  border-radius: 0.5rem;
  color: var(--metric-accent, #42a5ff);
  background: color-mix(in srgb, var(--metric-accent, #42a5ff) 10%, transparent);
}
.small-icon svg { width: 0.92rem; height: 0.92rem; }
.metric-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e7edf6;
  font-weight: 700;
  font-size: 0.84rem;
}
.metric-percent {
  flex: none;
  margin-left: auto;
  color: #ffffff;
  font-size: 1.12rem;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.metric-detail {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #b9c6d8;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: right;
  line-height: 1.2;
}
.metric-detail-compact { display: none; }
.metric-progress {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  height: 0.24rem;
  border-radius: 999px;
  background: rgba(148,163,184,.14);
  overflow: hidden;
}
.metric-progress i {
  display: block;
  width: var(--metric-value);
  height: 100%;
  border-radius: inherit;
  background: var(--metric-accent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--metric-accent) 52%, transparent);
  transition: width .5s ease;
}
.metric-cpu .metric-percent { color: #7fc0ff; }
.metric-memory .metric-percent { color: #6fe8a5; }
.metric-swap .metric-percent { color: #c39aff; }
.metric-disk .metric-percent { color: #ffab7d; }

/* ---------- CPU 水波动效 ---------- */
.cpu-water {
  position: absolute;
  z-index: 0;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  pointer-events: none;
}
.cpu-water-fill {
  --cpu-water-color: color-mix(in srgb, var(--metric-accent) 40%, transparent);
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: clamp(0%, var(--metric-value), 100%);
  max-height: 100%;
  min-height: 0;
  background: var(--cpu-water-color);
  transition: height .75s cubic-bezier(.2,.8,.2,1);
  will-change: height;
}
.cpu-wave {
  position: absolute;
  z-index: 2;
  left: -100%;
  top: -6px;
  width: 200%;
  height: 12px;
  color: var(--cpu-water-color);
  filter: drop-shadow(0 -1px 2px color-mix(in srgb, var(--metric-accent) 16%, transparent));
  animation: waterWaveFlow 6s linear infinite;
}
.cpu-wave path {
  fill: currentColor;
  transform-origin: center;
  animation: waterWaveBob 3.8s ease-in-out infinite;
}
/* 第二层波浪: 不同速度/相位/起伏节奏, 叠加后波峰错开更自然 */
.cpu-wave-two {
  left: -100%;
  top: -5px;
  height: 14px;
  opacity: .55;
  animation: waterWaveFlowReverse 9.5s linear infinite;
  animation-delay: -3.1s;
}
.cpu-wave-two path {
  animation: waterWaveBobAlt 6.4s ease-in-out infinite;
}
.cpu-bubble {
  position: absolute;
  z-index: 3;
  bottom: 5%;
  width: 3px;
  height: 3px;
  border: 1px solid color-mix(in srgb, var(--metric-accent) 55%, white 10%);
  border-radius: 50%;
  background: color-mix(in srgb, var(--metric-accent) 13%, transparent);
  box-shadow: inset 0 0 2px rgba(255,255,255,.18), 0 0 3px color-mix(in srgb, var(--metric-accent) 18%, transparent);
  opacity: 0;
  animation: bubbleRise 5.2s ease-in infinite;
}
.bubble-one { left: 22%; animation-delay: -.8s; }
.bubble-two { left: 58%; width: 4px; height: 4px; animation-delay: -2.5s; animation-duration: 6.1s; }
.bubble-three { left: 78%; width: 2px; height: 2px; animation-delay: -3.4s; animation-duration: 4.6s; }
@keyframes waterWaveFlow {
  to { transform: translateX(50%); }
}
@keyframes waterWaveFlowReverse {
  from { transform: translateX(50%); }
  to { transform: translateX(0); }
}
@keyframes waterWaveBob {
  0%, 100% { transform: translateY(0) scaleY(1); }
  18% { transform: translateY(2px) scaleY(.85); }
  38% { transform: translateY(-2px) scaleY(1.08); }
  62% { transform: translateY(1px) scaleY(.9); }
  82% { transform: translateY(-1px) scaleY(1.04); }
}
@keyframes waterWaveBobAlt {
  0%, 100% { transform: translateY(1px) scaleY(.94); }
  26% { transform: translateY(-2px) scaleY(1.1); }
  51% { transform: translateY(2px) scaleY(.84); }
  74% { transform: translateY(-1px) scaleY(1.06); }
}
@keyframes bubbleRise {
  0% { bottom: 4%; transform: translate3d(0, 1px, 0) scale(.72); opacity: 0; }
  16% { opacity: .52; }
  72% { opacity: .3; }
  100% { bottom: calc(100% - 4px); transform: translate3d(3px, 0, 0) scale(1.05); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  /* CPU 水波是用户明确要求保留的招牌动效, 不随系统减弱动效关闭 */
  .cpu-wave { animation: waterWaveFlow 8s linear infinite; }
  .cpu-wave path { animation: waterWaveBob 3.8s ease-in-out infinite; }
  .cpu-wave-two { animation: waterWaveFlowReverse 9.5s linear infinite; animation-delay: -3.1s; }
  .cpu-wave-two path { animation: waterWaveBobAlt 6.4s ease-in-out infinite; }
  .cpu-bubble { animation: bubbleRise 5.2s ease-in infinite; }
  .cpu-water-fill { transition: height .75s cubic-bezier(.2,.8,.2,1); }
}

/* ---------- 网络卡 ---------- */
.network-card {
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: minmax(0,1fr) auto auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.52rem 0.6rem;
  border: 1px solid rgba(148,163,184,.13);
  border-radius: 0.68rem;
  color: inherit;
  background: rgba(148,163,184,.028);
  cursor: pointer;
  text-align: left;
  transition: border-color .15s ease;
}
.network-card:hover { border-color: rgba(54,217,130,.42); }
.network-card.selected {
  border-color: rgba(54,217,130,.55);
  box-shadow: inset 0 0 0 1px rgba(54,217,130,.09);
}
.network-title {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.34rem;
  font-weight: 700;
  font-size: 0.82rem;
  white-space: nowrap;
}
.network-title small {
  max-width: 4.4rem;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0.12rem 0.4rem;
  border: 1px solid rgba(148,163,184,.14);
  border-radius: 999px;
  color: #95a2b4;
  font-size: 0.62rem;
  font-weight: 600;
  background: rgba(148,163,184,.05);
}
.network-rate {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.24rem;
  white-space: nowrap;
  font-size: 0.72rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.network-rate svg { width: 0.8rem; height: 0.8rem; flex: none; }
.rate-down { color: #35db81; }
.rate-up { color: #ff814a; }

/* ---------- 趋势卡 ---------- */
.history-card {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 0.54rem 0.52rem 0.36rem;
  border: 1px solid rgba(148,163,184,.13);
  border-radius: 0.68rem;
  background: rgba(148,163,184,.022);
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
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8rem;
}
.range-tabs {
  flex: none;
  display: inline-flex;
  gap: 0.1rem;
  padding: 0.14rem;
  border-radius: 0.5rem;
  background: rgba(2,6,23,.4);
}
.range-tabs button {
  min-width: 0;
  padding: 0.22rem 0.3rem;
  border: 0;
  border-radius: 0.38rem;
  color: #8491a4;
  background: transparent;
  font-size: 0.66rem;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: color .15s ease, background .15s ease;
}
.range-tabs button.active {
  color: #fff;
  background: color-mix(in srgb, var(--history-accent) 24%, #151b2a);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--history-accent) 18%, transparent);
}
.chart-legend {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
  padding: 0 0.1rem 0.1rem;
  font-size: 0.62rem;
}
.chart-legend span { display: inline-flex; align-items: center; gap: 0.2rem; }
.chart-legend i { width: 0.6rem; height: 2px; border-radius: 999px; background: currentColor; }
.history-chart-wrap {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  cursor: crosshair;
  touch-action: pan-y;
}
.history-chart {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: block;
  overflow: visible;
}
.chart-grid line { stroke: rgba(148,163,184,.1); stroke-width: 1; vector-effect: non-scaling-stroke; }
.axis-labels text {
  fill: #9aadc6;
  stroke: rgba(8, 13, 22, .78);
  stroke-width: .75px;
  paint-order: stroke fill;
  font-size: 9.5px;
  font-weight: 650;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-rendering: geometricPrecision;
}
.axis-x-label { fill: #879bb6; font-size: 8.8px; }
.history-area { fill: url(#historyAreaGradient); }
.history-line {
  fill: none;
  stroke: var(--history-accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--history-accent) 50%, transparent));
}
.network-download-line { stroke: #35db81; }
.network-upload-line { stroke: #ff814a; }
.history-hover-marker { pointer-events: none; }
.history-hover-marker line {
  stroke: rgba(226,232,240,.52);
  stroke-width: 1;
  stroke-dasharray: 3 3;
  vector-effect: non-scaling-stroke;
}
.history-hover-marker circle {
  fill: #101827;
  stroke: var(--history-accent);
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 3px color-mix(in srgb, var(--history-accent) 55%, transparent));
}
.history-hover-marker .history-hover-download { stroke: #35db81; }
.history-hover-marker .history-hover-upload { stroke: #ff814a; }
.history-tooltip {
  --history-hover-left: 50%;
  position: absolute;
  z-index: 4;
  top: 0.35rem;
  left: clamp(4.5rem, var(--history-hover-left), calc(100% - 4.5rem));
  min-width: 7.8rem;
  max-width: calc(100% - 0.5rem);
  display: grid;
  gap: 0.24rem;
  padding: 0.42rem 0.5rem;
  border: 1px solid rgba(148,163,184,.24);
  border-radius: 0.5rem;
  color: #dce6f3;
  background: rgba(8,13,22,.92);
  box-shadow: 0 8px 24px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.04);
  backdrop-filter: blur(8px);
  transform: translateX(-50%);
  pointer-events: none;
  font-size: 0.68rem;
  line-height: 1.15;
  white-space: nowrap;
}
.history-tooltip > strong {
  color: #9fb0c5;
  font-size: 0.62rem;
  font-weight: 650;
}
.history-tooltip-row {
  min-width: 0;
  display: grid;
  grid-template-columns: 0.45rem minmax(0,1fr) auto;
  align-items: center;
  gap: 0.3rem;
}
.history-tooltip-row i {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 5px currentColor;
}
.history-tooltip-row:not(.rate-down):not(.rate-up) { color: var(--history-accent); }
.history-tooltip-row span { color: #b9c6d8; }
.history-tooltip-row b {
  color: #f2f6fb;
  font-weight: 760;
  font-variant-numeric: tabular-nums;
}

/* ---------- 有历史时紧凑模式 ---------- */
.status-monitor:not(.has-history) .metric-grid {
  flex: 1 1 auto;
  min-height: 0;
  grid-auto-rows: minmax(0, 1fr);
  align-content: stretch;
}
.status-monitor:not(.has-history) .metric-card {
  min-height: 0;
  height: 100%;
}
.has-history .metric-grid {
  flex: 0 0 auto;
  grid-template-columns: repeat(2, minmax(0,1fr));
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
.has-history .metric-top { flex: 1; }
.has-history .metric-identity { gap: 0.3rem; }
.has-history .metric-identity .small-icon { display: none; }
.has-history .metric-detail,
.has-history .metric-progress,
.has-history .cpu-water { display: none; }
.has-history .metric-name,
.has-history .metric-percent { font-size: 0.68rem; }
.has-history .network-card {
  margin-top: 0;
  padding: 0.28rem 0.4rem;
  gap: 0.3rem;
}
.has-history .network-title small { display: none; }
.has-history .history-card {
  flex: 1 1 0;
  min-height: 0;
  margin-top: 0;
}

/* ============================================================
   自适应容器查询
   ============================================================ */
/* 中等宽度 (>= 301px) - 默认已是舒服尺寸 (高度足够才启用, 否则紧凑) */
@container status-pane (min-width: 301px) and (min-height: 460px) {
  .status-monitor { padding: 0.5rem; }
  .monitor-header { padding: 0.58rem 0.74rem; }
  .monitor-content { padding: 0.6rem; gap: 0.56rem; }
  .metric-card { padding: 0.58rem 0.62rem; gap: 0.36rem; }
  .metric-percent { font-size: 1.26rem; }
  .small-icon { width: 1.8rem; height: 1.8rem; flex-basis: 1.8rem; }
  .small-icon svg { width: 1.02rem; height: 1.02rem; }
  .metric-name { font-size: 0.9rem; }
  .metric-progress { height: 0.3rem; }
  .network-card { padding: 0.6rem 0.68rem; }
  .history-card { padding: 0.6rem 0.58rem 0.4rem; }
}

/* 窄容器 (<= 300px) - 紧凑样式, 保持 2 列 */
@container status-pane (max-width: 300px) {
  .status-monitor { padding: 0.28rem; }
  .monitor-header { padding: 0.4rem 0.5rem; }
  .header-main > strong { font-size: 0.86rem; }
  .live-state { font-size: 0.66rem; padding: 0.1rem 0.36rem; }
  .monitor-content { padding: 0.36rem; gap: 0.34rem; }
  .metric-grid { gap: 0.34rem; }
  .metric-card { padding: 0.4rem 0.44rem; gap: 0.22rem; }
  .small-icon { width: 1.42rem; height: 1.42rem; flex-basis: 1.42rem; border-radius: 0.44rem; }
  .small-icon svg { width: 0.82rem; height: 0.82rem; }
  .metric-name { font-size: 0.74rem; }
  .metric-percent { font-size: 0.94rem; }
  .metric-detail-full { display: none; }
  .metric-detail-compact { display: block; font-size: 0.62rem; }
  .network-card { grid-template-columns: minmax(0,1fr) 1fr; gap: 0.26rem; padding: 0.44rem 0.48rem; }
  .network-title { grid-column: 1 / -1; }
  .network-rate { font-size: 0.64rem; }
  .network-rate.rate-up { justify-self: end; }
  .history-header { display: grid; grid-template-columns: 1fr; align-items: center; }
  .range-tabs { width: 100%; display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); }
  .range-tabs button { min-width: 0; }
  .history-card .axis-y-label { font-size: 11px; }
  .history-card .axis-x-label { font-size: 9.8px; }
}

/* 极窄 (<= 250px) - 单列, 避免指标和网速内容挤压 */
@container status-pane (max-width: 250px) {
  .status-monitor:not(.has-history) .metric-grid { grid-template-columns: 1fr; }
  .has-history .metric-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .network-card {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.18rem;
    padding-block: 0.38rem;
  }
  .network-title { grid-column: 1; }
  .network-rate,
  .network-rate.rate-up { justify-self: start; }
}

/* 窄网速卡 (<= 300px 内容宽度) - 两组速率保持同一行 */
@container status-pane (max-width: 300px) {
  .network-card {
    grid-template-columns: minmax(0, 1fr) minmax(0, auto);
    column-gap: 0.24rem;
    row-gap: 0.06rem;
    padding-block: 0.24rem;
  }
  .network-title { grid-column: 1 / -1; }
  .network-rate {
    min-width: 0;
    font-size: 0.62rem;
  }
  .network-rate.rate-up { justify-self: end; }
}

/* 更窄时才切换为上下两行 */
@container status-pane (max-width: 175px) {
  .network-card {
    grid-template-columns: minmax(0, 1fr);
    column-gap: 0;
    row-gap: 0;
    padding-block: 0.16rem;
  }
  .network-title {
    grid-column: 1;
    justify-content: center;
    text-align: center;
  }
  .network-rate,
  .network-rate.rate-up {
    justify-self: center;
    line-height: 1;
  }
}

/* 高而窄：保持 1×4，但卡片内部仍横向排布，避免标题与数值被拉得过远 */
@container status-pane (max-width: 250px) and (min-height: 640px) {
  .status-monitor:not(.has-history) .metric-grid { gap: 0.5rem; }
  .status-monitor:not(.has-history) .metric-card {
    justify-content: center;
    gap: 0.5rem;
    padding: 0.72rem 0.66rem;
  }
  .status-monitor:not(.has-history) .metric-top {
    width: 100%;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .status-monitor:not(.has-history) .metric-identity { gap: 0.46rem; }
  .status-monitor:not(.has-history) .metric-name { font-size: 0.9rem; }
  .status-monitor:not(.has-history) .metric-percent { font-size: 1.2rem; }
  .status-monitor:not(.has-history) .metric-detail-full,
  .status-monitor:not(.has-history) .metric-detail-compact { text-align: right; }
}

/* 真正超窄：标题靠左、百分比靠右；中等窄度仍保留明细与进度条 */
@container status-pane (max-width: 145px) {
  .status-monitor:not(.has-history) .metric-card {
    min-height: 0;
    justify-content: center;
    padding: 0.3rem 0.42rem;
  }
  .status-monitor:not(.has-history) .metric-top {
    width: min(100%, 6.6rem);
    margin-inline: auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 2.7rem;
    align-items: center;
    gap: 0.45rem;
  }
  .status-monitor:not(.has-history) .metric-identity .small-icon,
  .status-monitor:not(.has-history) .metric-detail-full,
  .status-monitor:not(.has-history) .metric-detail-compact,
  .status-monitor:not(.has-history) .metric-progress { display: none; }
  .status-monitor:not(.has-history) .metric-name {
    color: var(--metric-accent);
    font-size: 0.76rem;
  }
  .status-monitor:not(.has-history) .metric-percent {
    display: block;
    width: 2.7rem;
    margin-left: 0;
    justify-self: end;
    text-align: right;
    color: #d7dee9;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
  }
  .network-card { grid-template-columns: 1fr; gap: 0.14rem; }
  .network-title { grid-column: 1 / -1; }
  .network-title small { display: none; }
  .network-rate { font-size: 0.62rem; justify-self: start; }
  .network-rate.rate-up { justify-self: start; }
  .has-history .metric-card { padding-inline: 0.2rem; gap: 0.18rem; }
  .has-history .metric-name,
  .has-history .metric-percent { font-size: 0.62rem; }
  .chart-legend { display: none; }
  .history-card .axis-labels { display: block; }
  .history-card .chart-grid { display: block; }
  .history-card .axis-y-label { font-size: 12px; }
  .history-card .axis-x-label { font-size: 10.5px; }
  .history-card .axis-x-middle { display: none; }
  .history-card .chart-grid line { stroke-opacity: .8; }
  .history-chart { min-height: 2.2rem; }
}

/* 真正超窄且矮：空间不足时省略辅助明细 */
@container status-pane (max-width: 145px) and (max-height: 380px) {
  .status-monitor .metric-detail-full,
  .status-monitor .metric-detail-compact { display: none; }
}

/* 超矮 (<= 300px) 紧凑 - 图表降级, 省略辅助明细给进度条留空间 */
@container status-pane (max-height: 300px) {
  .history-header .range-tabs { display: none; }
  .history-chart { min-height: 1.6rem; }
  .status-monitor .metric-detail-full,
  .status-monitor .metric-detail-compact { display: none; }
}

/* 中等矮容器：压缩布局，但保留紧凑明细和进度条 */
@container status-pane (min-width: 146px) and (max-height: 380px) and (min-height: 301px) {
  .status-monitor:not(.has-history) .metric-card {
    min-height: 0;
    justify-content: center;
    padding: 0.18rem 0.4rem;
    gap: 0.08rem;
  }
  .status-monitor:not(.has-history) .metric-top {
    width: 100%;
    margin-inline: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3rem;
    align-items: center;
    gap: clamp(0.5rem, 3cqw, 1rem);
  }
  .status-monitor:not(.has-history) .metric-identity .small-icon,
  .status-monitor:not(.has-history) .metric-detail-full { display: none; }
  .status-monitor:not(.has-history) .metric-detail-compact {
    display: block;
    font-size: 0.57rem;
    line-height: 1.05;
    text-align: right;
  }
  .status-monitor:not(.has-history) .metric-progress {
    display: block;
    height: 0.18rem;
  }
  .status-monitor:not(.has-history) .metric-name {
    color: var(--metric-accent);
    font-size: clamp(0.74rem, 4.4cqh, 0.86rem);
  }
  .status-monitor:not(.has-history) .metric-percent {
    display: block;
    width: 3rem;
    margin-left: 0;
    justify-self: end;
    text-align: right;
    color: #d7dee9;
    font-size: clamp(0.78rem, 4.7cqh, 0.94rem);
    font-variant-numeric: tabular-nums;
  }
  .network-card { min-height: 0; padding-block: 0.32rem; }
  .network-title small { display: none; }
}

/* 极矮 (<= 235px) - 顶部摘要模式 */
@container status-pane (max-height: 235px) {
  .monitor-header {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
    gap: 0.24rem;
  }
  .header-main { flex: 0 0 auto; }
  .auto-summary {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-rows: repeat(2, minmax(0,1fr));
    align-content: stretch;
    gap: 0.2rem;
    padding: 0.26rem 0.5rem 0.4rem;
    color: #a7b3c4;
  }
  .monitor-content { display: none; }
  .summary-row {
    min-width: 0;
    width: 100%;
    min-height: 1.9rem;
    align-items: center;
    white-space: nowrap;
    font-size: clamp(.78rem, 6.2cqw, .94rem);
    line-height: 1.35;
  }
  .summary-row > span {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: .22rem;
  }
  .summary-metric {
    justify-content: center !important;
    gap: clamp(.22rem, 2cqw, .42rem) !important;
  }
  .summary-percent {
    display: inline;
    color: #c8d1dd;
    font-variant-numeric: tabular-nums;
  }
  .summary-row b { font-weight: 760; }
  .summary-cpu b { color: #42a5ff; }
  .summary-memory b { color: #36d982; }
  .summary-disk b { color: #ff814a; }
  .summary-resources {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: clamp(.18rem, 2cqw, .36rem);
    padding-inline: clamp(.08rem, 1.2cqw, .22rem);
  }
  .summary-separator {
    align-self: center;
    color: rgba(148,163,184,.58);
    font-style: normal;
  }
  .summary-network {
    width: min(100%, 15rem);
    justify-self: center;
    display: grid;
    grid-template-columns: auto auto;
    justify-content: center;
    column-gap: clamp(.2rem, 1.2cqw, .32rem);
    padding-inline: 0;
  }
  .summary-network > span {
    width: auto;
    min-width: 0;
    display: grid;
    grid-template-columns: .88rem auto auto;
    align-items: center;
    justify-self: stretch;
    justify-content: center;
    column-gap: .12rem;
    line-height: 1;
  }
  .summary-network .rate-up,
  .summary-network .rate-down {
    justify-self: stretch;
    color: #c8d1dd;
  }
  .summary-network .rate-value {
    min-width: 0;
    justify-self: start;
    text-align: left;
    color: #c8d1dd;
    font-variant-numeric: tabular-nums;
  }
  .summary-network .rate-unit { justify-self: start; }
  .summary-network .rate-up svg,
  .summary-network .rate-up .rate-unit { color: #ff814a; }
  .summary-network .rate-down svg,
  .summary-network .rate-down .rate-unit { color: #35db81; }
  .summary-network .rate-unit { font-weight: 700; }
  .summary-network svg { width: .88rem; height: .88rem; flex: none; display: block; transform: translateY(.02em); }
}
@container status-pane (max-width: 132px) {
  .monitor-header {
    flex: 1 1 auto;
    min-height: 0;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-start;
  }
  .header-main { flex: 0 0 auto; }
  .header-main > strong { font-size: .68rem; }
  .live-state {
    max-width: none;
    padding: .13rem .28rem;
    font-size: 0;
  }
  .live-state i { width: .34rem; height: .34rem; }
  .auto-summary {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-rows: auto auto;
    align-content: center;
    gap: clamp(.42rem, 4cqh, .72rem);
    padding: .38rem .24rem .48rem;
    color: #a7b3c4;
  }
  .monitor-content { display: none; }
  .summary-row { min-height: 0; font-size: clamp(.59rem, 6.4cqw, .68rem); }
  .summary-resources {
    width: min(100%, 5.2rem);
    justify-self: center;
    grid-template-columns: 1fr;
    grid-template-rows: repeat(3, auto);
    row-gap: clamp(.24rem, 2.8cqh, .4rem);
    padding-inline: 0;
  }
  .summary-separator { display: none; }
  .summary-metric {
    width: 100%;
    display: grid !important;
    grid-template-columns: minmax(0, 1fr) 2.35rem;
    align-items: center;
    gap: .28rem !important;
  }
  .summary-metric b { justify-self: start; }
  .summary-metric .summary-percent {
    width: 2.35rem;
    justify-self: end;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .summary-network {
    width: min(100%, 5.2rem);
    justify-self: center;
    grid-template-columns: 1fr;
    grid-template-rows: repeat(2, auto);
    row-gap: clamp(.22rem, 2.5cqh, .36rem);
    padding-inline: 0;
  }
  .summary-network > span {
    width: auto;
    justify-self: center !important;
    display: grid;
    grid-template-columns: .82rem minmax(4.4ch, max-content);
    align-items: center;
    justify-content: center;
    column-gap: .22rem;
  }
  .summary-network svg {
    width: .72rem;
    height: .72rem;
    justify-self: center;
  }
  .summary-network .rate-value {
    min-width: 0;
    width: auto;
    justify-self: end;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .summary-network .rate-unit { display: none; }
}
@container status-pane (max-height: 130px) {
  .status-monitor { padding: .16rem; }
  .header-main { min-height: 1.9rem; padding: .2rem .38rem; }
  .header-main > strong { font-size: .76rem; }
  .live-state { font-size: .62rem; gap: .22rem; }
  .live-state i { width: .36rem; height: .36rem; }
  .auto-summary { gap: .06rem; padding: .12rem .34rem .2rem; }
  .summary-row { font-size: clamp(.6rem, 5.5cqw, .72rem); line-height: 1.1; }
  .summary-resources { column-gap: .18rem; }
  .summary-separator { display: none; }
  .summary-row > span { gap: .12rem; overflow: hidden; }
  .summary-row b,
  .summary-percent,
  .rate-value,
  .rate-unit { overflow: hidden; text-overflow: ellipsis; }
  .summary-network { column-gap: .28rem; padding-inline: 0; }
  .summary-network > span { gap: 0; column-gap: .18rem; }
  .summary-network svg { width: .72rem; height: .72rem; }
}
@container status-pane (max-width: 132px) and (max-height: 130px) {
  .auto-summary { padding-inline: .2rem; }
  .summary-network {
    width: min(100%, 5.2rem);
    column-gap: 0;
    row-gap: .18rem;
    padding-inline: 0;
  }
  .summary-network > span {
    grid-template-columns: .82rem minmax(4.4ch, max-content);
    gap: 0;
    column-gap: .18rem;
  }
  .summary-network .rate-value {
    width: auto;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
