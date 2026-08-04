<template>
  <div
    class="status-monitor h-full overflow-y-auto bg-background text-foreground"
    :class="{ 'is-collapsed': panelCollapsed, 'bg-header': !activeSessionId }"
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

    <section v-else ref="monitorPanelRef" class="monitor-panel">
      <button
        class="monitor-header"
        type="button"
        :aria-expanded="!panelCollapsed"
        @click="togglePanel"
      >
        <span class="header-main">
          <strong>{{ t('statusMonitor.title') }}</strong>
          <span class="live-state"><i></i>在线</span>
          <span class="collapse-control" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="m6.8 11.6 3.2-3.2 3.2 3.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </span>

        <span class="collapsed-summary" aria-hidden="true">
          <span class="summary-row summary-resources">
            <span class="summary-metric summary-cpu"><b>CPU</b> {{ formatPercentageText(displayCpuPercent) }}</span>
            <i class="summary-separator">·</i>
            <span class="summary-metric summary-memory"><b>内存</b> {{ formatPercentageText(displayMemPercent) }}</span>
            <i class="summary-separator">·</i>
            <span class="summary-metric summary-disk"><b>磁盘</b> {{ formatPercentageText(displayDiskPercent) }}</span>
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
      </button>

      <div ref="monitorContentRef" class="monitor-content">
        <div
          v-if="statusMonitorShowIpBoolean && sessionIpAddress"
          class="ip-row"
        >
          <span class="ip-label">
            <span class="small-icon ip-icon"><MonitorIcon /></span>
            <span class="ip-label-long">IP 地址</span>
            <span class="ip-label-short">IP</span>
          </span>
          <strong :title="sessionIpAddress">{{ sessionIpAddress }}</strong>
          <button class="copy-button" type="button" title="复制 IP" @click="copyIpToClipboard(sessionIpAddress)">
            <CopyIcon />
          </button>
        </div>

        <div class="metric-grid">
          <button
            v-for="metric in metrics"
            :key="metric.key"
            type="button"
            class="metric-card"
            :class="[{ selected: selectedMetric === metric.key }, `metric-${metric.key}`]"
            :style="{ '--metric-accent': metric.color, '--metric-value': `${metric.percent}%` }"
            @click="selectMetric(metric.key)"
          >
            <span v-if="metric.key === 'cpu'" class="cpu-water" aria-hidden="true">
              <span class="cpu-water-fill">
                <svg class="cpu-wave" viewBox="0 0 240 8" preserveAspectRatio="none">
                  <path d="M0 4 C14 3 22 5 36 4 S58 3 72 4 S94 5 108 4 S130 3 144 4 S166 5 180 4 S202 3 216 4 S234 5 240 4 L240 8 L0 8 Z" />
                </svg>
                <i class="cpu-bubble bubble-one"></i>
                <i class="cpu-bubble bubble-two"></i>
                <i class="cpu-bubble bubble-three"></i>
              </span>
            </span>
            <span class="metric-layout">
              <span class="metric-identity">
                <span class="small-icon"><component :is="metric.icon" /></span>
                <span class="metric-name">{{ metric.name }}</span>
              </span>
              <span class="metric-values">
                <strong class="metric-percent">{{ formatPercentageText(metric.percent) }}</strong>
                <span v-if="metric.detail" class="metric-detail metric-detail-full">{{ metric.detail }}</span>
                <span v-if="metric.compactDetail" class="metric-detail metric-detail-compact">{{ metric.compactDetail }}</span>
              </span>
            </span>
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

          <svg class="history-chart" viewBox="0 0 248 126" preserveAspectRatio="none" role="img" :aria-label="`${selectedMetricTitle}图表`">
            <defs>
              <linearGradient id="historyAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="var(--history-accent)" stop-opacity=".34" />
                <stop offset="1" stop-color="var(--history-accent)" stop-opacity="0" />
              </linearGradient>
            </defs>

            <g class="chart-grid">
              <line x1="34" y1="10" x2="240" y2="10" />
              <line x1="34" y1="52" x2="240" y2="52" />
              <line x1="34" y1="94" x2="240" y2="94" />
              <line x1="34" y1="10" x2="34" y2="94" />
              <line x1="137" y1="10" x2="137" y2="94" />
              <line x1="240" y1="10" x2="240" y2="94" />
            </g>

            <g class="axis-labels">
              <text x="28" y="13" text-anchor="end">{{ yAxisLabels[0] }}</text>
              <text x="28" y="55" text-anchor="end">{{ yAxisLabels[1] }}</text>
              <text x="28" y="97" text-anchor="end">{{ yAxisLabels[2] }}</text>
              <text x="34" y="116" text-anchor="middle">-{{ historyRange }}m</text>
              <text x="137" y="116" text-anchor="middle">-{{ historyRange / 2 }}m</text>
              <text x="240" y="116" text-anchor="end">当前</text>
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
          </svg>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, ref, watch, type Component, type PropType } from 'vue';
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

const emit = defineEmits<{
  (event: 'panel-resize-request', payload: { collapsed: boolean; preferredHeight: number }): void;
}>();

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
const MonitorIcon = icon([
  h('rect', { x: 4, y: 4.5, width: 16, height: 13, rx: 2.4, ...stroke }),
  h('path', { d: 'M9 20h6M12 17.5V20M8 8h8', ...stroke }),
]);
const CopyIcon = icon([
  h('rect', { x: 8, y: 8, width: 10, height: 11, rx: 2, ...stroke }),
  h('path', { d: 'M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v8A2.5 2.5 0 0 0 6.5 17H8', ...stroke }),
]);
const DownloadIcon = icon([
  h('path', { d: 'M12 4v11M7.5 11.5 12 16l4.5-4.5M5 20h14', ...stroke }),
]);
const UploadIcon = icon([
  h('path', { d: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M5 20h14', ...stroke }),
]);

const panelCollapsed = ref(false);
const monitorPanelRef = ref<HTMLElement | null>(null);
const monitorContentRef = ref<HTMLElement | null>(null);
const selectedMetric = ref<SelectedMetric | null>(null);
const historyRange = ref<5 | 10 | 30>(5);
const ranges = [5, 10, 30] as const;

const currentSessionState = computed(() => props.activeSessionId ? sessions.value.get(props.activeSessionId) : null);
const currentServerStatus = computed<ServerStatus | null>(() => currentSessionState.value?.statusMonitorManager?.serverStatus?.value ?? null);
const currentStatusError = computed<string | null>(() => currentSessionState.value?.statusMonitorManager?.statusError?.value ?? null);

const displayCpuPercent = computed(() => currentServerStatus.value?.cpuPercent ?? 0);
const displayMemPercent = computed(() => currentServerStatus.value?.memPercent ?? 0);
const displaySwapPercent = computed(() => currentServerStatus.value?.swapPercent ?? 0);
const displayDiskPercent = computed(() => currentServerStatus.value?.diskPercent ?? 0);

const formatPercentageText = (percentage: number) => `${Math.round(Math.max(0, Math.min(100, percentage)))}%`;

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

const metrics = computed<Array<{ key: MetricKey; name: string; percent: number; detail: string; compactDetail: string; color: string; icon: Component }>>(() => [
  { key: 'cpu', name: 'CPU', percent: displayCpuPercent.value, detail: '', compactDetail: '', color: '#42a5ff', icon: CpuIcon },
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

const requestPanelResize = async () => {
  await nextTick();
  const panel = monitorPanelRef.value;
  if (!panel) return;

  const headerHeight = panel.querySelector<HTMLElement>('.monitor-header')?.offsetHeight ?? 0;
  const contentHeight = monitorContentRef.value?.scrollHeight ?? 0;
  const expandedHeightCap = selectedMetric.value ? 430 : 340;
  const preferredHeight = panelCollapsed.value
    ? Math.max(118, Math.ceil(headerHeight + 12))
    : Math.min(expandedHeightCap, Math.ceil(headerHeight + contentHeight + 8));

  emit('panel-resize-request', {
    collapsed: panelCollapsed.value,
    preferredHeight,
  });
};

const togglePanel = () => {
  panelCollapsed.value = !panelCollapsed.value;
  void requestPanelResize();
};

const selectMetric = (metric: SelectedMetric) => {
  selectedMetric.value = selectedMetric.value === metric ? null : metric;
  void requestPanelResize();
};

const selectedMetricTitle = computed(() => ({
  cpu: 'CPU 趋势',
  memory: '内存趋势',
  swap: 'Swap 趋势',
  disk: '磁盘趋势',
  network: '网络趋势',
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

const niceNetworkMax = computed(() => {
  const max = Math.max(...networkRxHistory.value, ...networkTxHistory.value, 0);
  if (max <= 0) return 1024;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / magnitude) * magnitude;
});

const pointString = (values: number[], maxValue: number) => {
  const sampled = downsample(values);
  const width = 206;
  const left = 34;
  const top = 10;
  const height = 84;
  if (!sampled.length) return `${left},${top + height}`;
  return sampled.map((value, index) => {
    const x = left + (sampled.length === 1 ? width : index / (sampled.length - 1) * width);
    const y = top + height - Math.min(1, Math.max(0, value / Math.max(1, maxValue))) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
};

const singleLinePoints = computed(() => pointString(percentHistory.value, 100));
const singleAreaPath = computed(() => `M34,94 L${singleLinePoints.value.replaceAll(' ', ' L')} L240,94 Z`);
const networkDownloadPoints = computed(() => pointString(networkRxHistory.value, niceNetworkMax.value));
const networkUploadPoints = computed(() => pointString(networkTxHistory.value, niceNetworkMax.value));

const formatAxisRate = (bytes: number) => {
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)}K`;
  return `${Math.round(bytes)}`;
};
const yAxisLabels = computed(() => selectedMetric.value === 'network'
  ? [formatAxisRate(niceNetworkMax.value), formatAxisRate(niceNetworkMax.value / 2), '0']
  : ['100%', '50%', '0']);

watch(() => props.activeSessionId, () => {
  selectedMetric.value = null;
  panelCollapsed.value = false;
  void requestPanelResize();
});

watch(
  () => Boolean(currentServerStatus.value),
  (ready, wasReady) => {
    if (ready && !wasReady) void requestPanelResize();
  },
  { immediate: true },
);

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
    await navigator.clipboard.writeText(ipAddress);
    uiNotificationsStore.showSuccess(t('common.copied', '已复制!'));
  } catch (error) {
    console.error('Failed to copy IP address:', error);
    uiNotificationsStore.showError(t('statusMonitor.copyIpError', '复制 IP 失败'));
  }
};
</script>

<style scoped>
.status-monitor {
  container-type: size;
  container-name: status-pane;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
  padding: 0.42rem;
  font-size: 0.78rem;
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
.monitor-panel {
  width: 100%;
  max-height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: auto;
  border: 1px solid rgba(148, 163, 184, 0.19);
  border-radius: 0.86rem;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.008));
  box-shadow: 0 14px 36px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.025);
}
.monitor-header {
  width: 100%;
  flex: 0 0 auto;
  display: block;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.header-main {
  min-height: 2.86rem;
  display: grid;
  grid-template-columns: minmax(0,1fr) auto auto;
  align-items: center;
  gap: 0.42rem;
  padding: 0.48rem 0.62rem;
  border-bottom: 1px solid rgba(148, 163, 184, 0.13);
}
.header-main > strong {
  min-width: 0;
  font-size: 0.96rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.live-state { display: inline-flex; align-items: center; gap: .34rem; color: #34df7d; white-space: nowrap; font-size: .76rem; }
.live-state i { width: .48rem; height: .48rem; border-radius: 50%; background: currentColor; box-shadow: 0 0 9px currentColor; }
.collapse-control {
  width: clamp(1.78rem, 9cqh, 2.05rem);
  height: clamp(1.78rem, 9cqh, 2.05rem);
  display: grid;
  place-items: center;
  border: 1px solid rgba(148,163,184,.18);
  border-radius: clamp(.54rem, 3cqh, .65rem);
  background: rgba(148,163,184,.065);
  color: #9da9bb;
  transition: width .2s ease, height .2s ease, border-radius .2s ease, background .2s ease;
}
.collapse-control svg {
  width: clamp(.88rem, 4.7cqh, 1rem);
  height: clamp(.88rem, 4.7cqh, 1rem);
  transition: transform .22s ease;
}
.is-collapsed .collapse-control {
  width: clamp(1.95rem, 11cqh, 2.22rem);
  height: clamp(1.95rem, 11cqh, 2.22rem);
  background: rgba(148,163,184,.08);
}
.is-collapsed .collapse-control svg { transform: rotate(180deg); }
.collapsed-summary { display: none; }
.monitor-content {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: .54rem;
  opacity: 1;
  scrollbar-width: thin;
  transition: opacity .18s ease;
}
.is-collapsed .monitor-content { display: none; }
.is-collapsed .header-main {
  min-height: clamp(3.05rem, 16cqh, 3.48rem);
  padding-block: clamp(.54rem, 3.3cqh, .72rem);
  border-bottom: 0;
}
.is-collapsed .collapsed-summary {
  display: grid;
  grid-template-rows: repeat(2,minmax(1.9rem,1fr));
  gap: clamp(.76rem, 5cqh, 1.06rem);
  height: clamp(5.75rem, 26cqh, 7.15rem);
  align-content: stretch;
  justify-items: stretch;
  padding: clamp(.34rem, 2.2cqh, .52rem) clamp(.7rem, 4.8cqw, .9rem) clamp(.76rem, 4cqh, 1rem);
  color: #a7b3c4;
}
.summary-row {
  min-width: 0;
  width: 100%;
  min-height: 1.9rem;
  align-items: center;
  white-space: nowrap;
  font-size: clamp(.72rem, 5.9cqw, .86rem);
  line-height: 1.35;
}
.summary-row > span {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .22rem;
}
.summary-row b { font-weight: 760; }
.summary-cpu b { color: #42a5ff; }
.summary-memory b { color: #36d982; }
.summary-disk b { color: #ff814a; }
.summary-resources {
  display: grid;
  grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr);
  column-gap: clamp(.28rem, 3.1cqw, .58rem);
  padding-inline: clamp(.08rem, 1.2cqw, .22rem);
}
.summary-separator {
  align-self: center;
  color: rgba(148,163,184,.58);
  font-style: normal;
}
.summary-network {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  column-gap: clamp(.9rem, 8cqw, 1.45rem);
  padding-inline: clamp(.5rem, 5.6cqw, .82rem);
}
.summary-network > span {
  display: inline-flex;
  align-items: center;
  gap: .26rem;
  line-height: 1;
}
.summary-network .rate-up,
.summary-network .rate-down {
  color: #c8d1dd;
}
.summary-network .rate-up { justify-self: start; }
.summary-network .rate-down { justify-self: end; }
.summary-network .rate-value { color: #c8d1dd; }
.summary-network .rate-up svg,
.summary-network .rate-up .rate-unit { color: #ff814a; }
.summary-network .rate-down svg,
.summary-network .rate-down .rate-unit { color: #35db81; }
.summary-network .rate-unit { font-weight: 700; }
.summary-network svg {
  width: .88rem;
  height: .88rem;
  flex: none;
  display: block;
  transform: translateY(.02em);
}
.ip-row {
  display: grid;
  grid-template-columns: auto minmax(0,1fr) auto;
  align-items: center;
  gap: .48rem;
  min-width: 0;
  padding: .55rem .58rem;
  margin-bottom: .62rem;
  border: 1px solid rgba(148,163,184,.14);
  border-radius: .72rem;
  background: rgba(148,163,184,.035);
}
.ip-label { display: inline-flex; align-items: center; gap: .38rem; color: #7cbcff; font-weight: 700; white-space: nowrap; }
.ip-label-short { display: none; }
.ip-row > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #e9f2ff; font-size: .76rem; text-align: right; }
.copy-button {
  width: 2rem;
  height: 2rem;
  display: grid;
  place-items: center;
  border: 1px solid rgba(148,163,184,.18);
  border-radius: .62rem;
  color: #aab6c7;
  background: rgba(148,163,184,.06);
  cursor: pointer;
  transition: color .15s ease, border-color .15s ease, background .15s ease, transform .15s ease;
}
.copy-button:hover { color: #fff; border-color: rgba(66,165,255,.5); background: rgba(66,165,255,.11); transform: translateY(-1px); }
.copy-button svg { width: 1rem; height: 1rem; }
.metric-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: .5rem; }
.metric-card {
  position: relative;
  min-width: 0;
  min-height: 4.05rem;
  display: grid;
  grid-template-rows: minmax(0,1fr) auto;
  align-content: stretch;
  gap: .24rem;
  padding: .42rem;
  overflow: hidden;
  border: 1px solid rgba(148,163,184,.16);
  border-radius: .78rem;
  color: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.008));
  text-align: left;
  cursor: pointer;
  isolation: isolate;
  transition: transform .16s ease, border-color .16s ease, background .16s ease;
}
.metric-card:hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--metric-accent) 48%, transparent); }
.metric-card.selected { border-color: color-mix(in srgb, var(--metric-accent) 72%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--metric-accent) 15%, transparent); }
.metric-layout {
  position: relative;
  z-index: 2;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0,.88fr) minmax(0,1.12fr);
  align-items: stretch;
  gap: .42rem;
}
.metric-identity {
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  gap: .36rem;
}
.metric-values {
  min-width: 0;
  height: 100%;
  display: grid;
  align-content: center;
  justify-items: end;
  gap: .2rem;
  text-align: right;
}
.metric-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e7edf6;
  font-weight: 780;
  font-size: .79rem;
  line-height: 1.1;
}
.metric-percent {
  min-width: 0;
  color: #eef3f9;
  white-space: nowrap;
  font-size: .78rem;
  font-weight: 780;
  line-height: 1.05;
}
.metric-detail {
  position: relative;
  z-index: 2;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #aeb9c9;
  font-size: .69rem;
  font-weight: 560;
  line-height: 1.1;
  text-align: right;
}
.metric-detail-compact { display: none; }
.metric-cpu .metric-values { align-content: center; }
.small-icon {
  width: 1.78rem;
  height: 1.78rem;
  flex: 0 0 1.78rem;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--metric-accent, #42a5ff) 30%, transparent);
  border-radius: .56rem;
  color: var(--metric-accent, #42a5ff);
  background: color-mix(in srgb, var(--metric-accent, #42a5ff) 12%, transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 0 12px color-mix(in srgb, var(--metric-accent, #42a5ff) 11%, transparent);
}
.small-icon svg { width: 1.08rem; height: 1.08rem; }
.ip-icon { --metric-accent: #42a5ff; }
.metric-progress { position: relative; z-index: 2; height: .29rem; overflow: hidden; border-radius: 999px; background: rgba(148,163,184,.14); }
.metric-progress i { display: block; width: var(--metric-value); height: 100%; border-radius: inherit; background: var(--metric-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--metric-accent) 52%, transparent); transition: width .5s ease; }
.cpu-water {
  position: absolute;
  z-index: 0;
  left: 0;
  right: 0;
  top: 2.3rem;
  bottom: 0;
  overflow: hidden;
  border-radius: 0 0 .78rem .78rem;
  pointer-events: none;
}
.cpu-water-fill {
  --cpu-water-color: color-mix(in srgb, var(--metric-accent) 31%, transparent);
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: var(--metric-value);
  min-height: 8px;
  background: transparent;
  transition: height .75s cubic-bezier(.2,.8,.2,1);
}
.cpu-water-fill::after {
  content: "";
  position: absolute;
  z-index: 0;
  inset: 4px 0 0;
  background: var(--cpu-water-color);
  box-shadow: 0 -3px 10px color-mix(in srgb, var(--metric-accent) 12%, transparent);
}
.cpu-wave {
  position: absolute;
  z-index: 2;
  left: -100%;
  top: -4px;
  width: 200%;
  height: 8px;
  color: var(--cpu-water-color);
  filter: drop-shadow(0 -1px 2px color-mix(in srgb, var(--metric-accent) 18%, transparent));
  animation: waterWaveFlow 8s linear infinite;
}
.cpu-wave path {
  fill: currentColor;
  transform-origin: center;
  animation: waterWaveBob 3.8s ease-in-out infinite;
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
@keyframes waterWaveBob {
  0%, 100% { transform: translateY(0) scaleY(1); }
  50% { transform: translateY(1px) scaleY(.82); }
}
@keyframes bubbleRise {
  0% { bottom: 4%; transform: translate3d(0, 1px, 0) scale(.72); opacity: 0; }
  16% { opacity: .52; }
  72% { opacity: .3; }
  100% { bottom: calc(100% - 4px); transform: translate3d(3px, 0, 0) scale(1.05); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .cpu-wave,
  .cpu-wave path,
  .cpu-bubble { animation: none; }
  .cpu-water-fill { transition: none; }
}
.network-card {
  width: 100%;
  min-width: 0;
  margin-top: .52rem;
  display: grid;
  grid-template-columns: minmax(0,1fr) auto auto;
  align-items: center;
  gap: .46rem;
  padding: .64rem;
  border: 1px solid rgba(148,163,184,.16);
  border-radius: .78rem;
  color: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,.025), rgba(255,255,255,.008));
  cursor: pointer;
  text-align: left;
}
.network-card.selected { border-color: rgba(54,217,130,.46); box-shadow: inset 0 0 0 1px rgba(54,217,130,.09); }
.network-title { min-width: 0; display: flex; align-items: center; gap: .36rem; font-weight: 750; white-space: nowrap; }
.network-title small { max-width: 4rem; overflow: hidden; text-overflow: ellipsis; padding: .14rem .34rem; border: 1px solid rgba(148,163,184,.16); border-radius: 999px; color: #95a2b4; font-size: .54rem; font-weight: 600; background: rgba(148,163,184,.06); }
.network-rate { min-width: 0; display: inline-flex; align-items: center; gap: .25rem; white-space: nowrap; font-size: .64rem; }
.network-rate svg { width: .86rem; height: .86rem; flex: none; }
.rate-down { color: #35db81; }
.rate-up { color: #ff814a; }
.history-card {
  margin-top: .62rem;
  padding: .64rem .56rem .38rem;
  border: 1px solid rgba(148,163,184,.16);
  border-radius: .78rem;
  background: linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.006));
}
.history-header { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: .35rem; padding: 0 .18rem .44rem; }
.history-header > strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .73rem; }
.range-tabs { flex: none; display: inline-flex; gap: .12rem; padding: .18rem; border-radius: .58rem; background: rgba(2,6,23,.42); }
.range-tabs button { min-width: 1.86rem; padding: .28rem .36rem; border: 0; border-radius: .43rem; color: #8491a4; background: transparent; font-size: .61rem; line-height: 1; white-space: nowrap; cursor: pointer; }
.range-tabs button.active { color: #fff; background: color-mix(in srgb, var(--history-accent) 26%, #151b2a); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--history-accent) 20%, transparent); }
.chart-legend { display: flex; justify-content: flex-end; gap: .64rem; padding: 0 .2rem .12rem; font-size: .57rem; }
.chart-legend span { display: inline-flex; align-items: center; gap: .22rem; }
.chart-legend i { width: .58rem; height: 2px; border-radius: 999px; background: currentColor; }
.history-chart { width: 100%; height: auto; min-height: 7.3rem; display: block; overflow: visible; }
.chart-grid line { stroke: rgba(148,163,184,.11); stroke-width: 1; vector-effect: non-scaling-stroke; }
.axis-labels text { fill: #7890ae; font-size: 7px; font-family: ui-sans-serif, system-ui, sans-serif; white-space: nowrap; }
.history-area { fill: url(#historyAreaGradient); }
.history-line { fill: none; stroke: var(--history-accent); stroke-width: 2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 4px color-mix(in srgb, var(--history-accent) 55%, transparent)); }
.network-download-line { stroke: #35db81; }
.network-upload-line { stroke: #ff814a; }
@container status-pane (max-width: 210px) {
  .status-monitor { padding: .28rem; }
  .header-main { padding-inline: .5rem; gap: .32rem; }
  .header-main > strong { font-size: .82rem; }
  .live-state { font-size: .66rem; }
  .collapse-control { width: clamp(1.68rem, 9cqh, 1.82rem); height: clamp(1.68rem, 9cqh, 1.82rem); }
  .monitor-content { padding: .38rem; }
  .ip-row { gap: .2rem; padding: .34rem; }
  .ip-label { gap: .18rem; font-size: .58rem; }
  .ip-label .small-icon { width: 1.3rem; height: 1.3rem; flex-basis: 1.3rem; }
  .ip-label .small-icon svg { width: .78rem; height: .78rem; }
  .ip-row > strong { font-size: .61rem; letter-spacing: -.01em; }
  .copy-button { width: 1.56rem; height: 1.56rem; border-radius: .5rem; }
  .copy-button svg { width: .86rem; height: .86rem; }
  .metric-grid { gap: .38rem; }
  .metric-card { min-height: 3.72rem; padding: .34rem; gap: .16rem; }
  .metric-layout { gap: .25rem; }
  .cpu-water { top: 1.9rem; }
  .small-icon { width: 1.5rem; height: 1.5rem; flex-basis: 1.5rem; border-radius: .48rem; }
  .small-icon svg { width: .92rem; height: .92rem; }
  .metric-name { font-size: .7rem; }
  .metric-percent { font-size: .69rem; }
  .metric-detail { color: #aeb9c9; font-size: .59rem; }
  .network-card { grid-template-columns: minmax(0,1fr) 1fr; gap: .32rem; }
  .network-title { grid-column: 1 / -1; }
  .network-rate { font-size: .58rem; }
  .network-rate.rate-up { justify-self: end; }
  .history-card { padding-inline: .42rem; }
  .history-header > strong { font-size: .65rem; }
  .range-tabs button { min-width: 1.55rem; padding-inline: .25rem; font-size: .56rem; }
  .history-chart { min-height: 6.45rem; }
}
@container status-pane (max-width: 190px) {
  .ip-label .small-icon,
  .metric-identity .small-icon { display: none; }
  .ip-label-long { display: none; }
  .ip-label-short { display: inline; }
  .ip-row { grid-template-columns: auto minmax(0,1fr) auto; gap: .26rem; }
  .ip-label { font-size: .64rem; }
  .ip-row > strong { font-size: .65rem; text-align: left; }
  .metric-layout { grid-template-columns: minmax(0,.86fr) minmax(0,1.14fr); gap: .2rem; }
  .metric-identity { gap: 0; }
  .metric-name { font-size: .69rem; }
  .metric-percent { font-size: .67rem; }
  .cpu-water { top: 1.38rem; }
  .metric-detail-full { display: none; }
  .metric-detail-compact { display: block; color: #b2bdcc; font-size: .59rem; letter-spacing: -.015em; }
}
@container status-pane (max-width: 175px) {
  .metric-name { font-size: .65rem; }
  .metric-percent { font-size: .63rem; }
  .metric-detail { font-size: .56rem; }
  .network-title { font-size: .65rem; }
  .history-header { align-items: flex-start; }
  .history-header > strong { max-width: 3.5rem; }
  .range-tabs button { min-width: 1.35rem; font-size: .51rem; }
  .axis-labels text { font-size: 6px; }
}
@container status-pane (max-height: 390px) {
  .status-monitor { padding: .28rem; }
  .header-main { min-height: 2.62rem; padding-block: .4rem; }
  .monitor-content { padding: .32rem; }
  .ip-row { margin-bottom: .36rem; padding: .3rem .36rem; }
  .metric-grid { gap: .3rem; }
  .metric-card { min-height: 3.32rem; padding: .28rem; gap: .1rem; }
  .metric-layout { gap: .22rem; }
  .small-icon { width: 1.36rem; height: 1.36rem; flex-basis: 1.36rem; border-radius: .44rem; }
  .small-icon svg { width: .84rem; height: .84rem; }
  .metric-name { font-size: .68rem; }
  .metric-percent { font-size: .66rem; }
  .metric-detail { color: #adb8c8; font-size: .57rem; }
  .metric-progress { height: .24rem; }
  .cpu-water { top: 1.72rem; }
  .network-card { margin-top: .36rem; gap: .3rem; padding: .42rem .46rem; }
  .history-card { margin-top: .4rem; padding: .46rem .42rem .28rem; }
  .history-chart { min-height: 5.9rem; }
}
@container status-pane (max-height: 390px) and (max-width: 190px) {
  .cpu-water { top: 1.18rem; }
}
@container status-pane (max-height: 320px) {
  .status-monitor { padding: .2rem; }
  .header-main { min-height: 2.38rem; padding: .3rem .48rem; }
  .collapse-control { width: 1.62rem; height: 1.62rem; border-radius: .5rem; }
  .collapse-control svg { width: .82rem; height: .82rem; }
  .monitor-content { padding: .24rem; }
  .ip-row { margin-bottom: .28rem; padding: .24rem .3rem; }
  .metric-grid { gap: .24rem; }
  .metric-card { min-height: 2.72rem; padding: .22rem; gap: .08rem; border-radius: .66rem; }
  .metric-layout { gap: .15rem; }
  .metric-identity .small-icon { display: none; }
  .metric-name { font-size: .64rem; }
  .metric-percent { font-size: .61rem; }
  .metric-detail-full { display: none; }
  .metric-detail-compact { display: block; color: #aeb9c8; font-size: .52rem; }
  .metric-progress { height: .18rem; }
  .cpu-water { top: 1.24rem; }
  .network-card { margin-top: .26rem; padding: .32rem .38rem; border-radius: .66rem; }
  .history-card { margin-top: .3rem; padding: .36rem .34rem .2rem; }
  .history-chart { min-height: 5.2rem; }
  .is-collapsed .collapsed-summary {
    grid-template-rows: repeat(2,minmax(1.68rem,1fr));
    gap: .62rem;
    height: 5.25rem;
    padding-top: .34rem;
    padding-bottom: .76rem;
  }
  .is-collapsed .collapse-control { width: 1.8rem; height: 1.8rem; }
}
@container status-pane (max-height: 260px) {
  .status-monitor { padding: .16rem; }
  .header-main { min-height: 2.12rem; padding: .24rem .42rem; }
  .header-main > strong { font-size: .76rem; }
  .live-state { font-size: .61rem; }
  .monitor-content { padding: .18rem; }
  .ip-row { margin-bottom: .2rem; padding: .2rem .26rem; }
  .ip-label .small-icon { display: none; }
  .ip-label-long { display: none; }
  .ip-label-short { display: inline; }
  .metric-grid { gap: .18rem; }
  .metric-card {
    min-height: 2.5rem;
    grid-template-rows: minmax(0,1fr) auto;
    padding: .2rem .24rem;
    gap: .07rem;
    border-radius: .58rem;
  }
  .metric-layout { grid-template-columns: minmax(0,.84fr) minmax(0,1.16fr); gap: .16rem; }
  .metric-values { display: grid; height: 100%; gap: .08rem; }
  .metric-name { font-size: .61rem; }
  .metric-percent { font-size: .6rem; }
  .metric-detail-full { display: none; }
  .metric-detail-compact { display: block; color: #aeb9c8; font-size: .49rem; }
  .metric-progress { display: block; height: .16rem; }
  .cpu-water { top: 1.08rem; }
  .network-card {
    grid-template-columns: minmax(0,1fr) auto auto;
    margin-top: .2rem;
    gap: .2rem;
    padding: .24rem .3rem;
  }
  .network-title { grid-column: auto; font-size: .59rem; }
  .network-title small { display: none; }
  .network-rate { font-size: .53rem; }
  .network-rate svg { width: .7rem; height: .7rem; }
  .history-card { margin-top: .22rem; padding: .28rem .3rem .16rem; }
  .history-chart { min-height: 4.6rem; }
  .is-collapsed .header-main { min-height: 2.58rem; padding-block: .42rem; }
  .is-collapsed .collapsed-summary {
    grid-template-rows: repeat(2,minmax(1.55rem,1fr));
    gap: .58rem;
    height: 4.9rem;
    padding: .28rem .6rem .68rem;
  }
  .summary-row { min-height: 1.55rem; font-size: clamp(.68rem, 5.55cqw, .78rem); }
  .summary-network svg { width: .86rem; height: .86rem; }
  .is-collapsed .collapse-control { width: 1.7rem; height: 1.7rem; }
}
@container status-pane (max-height: 215px) {
  .header-main { min-height: 1.98rem; padding-block: .2rem; }
  .collapse-control { width: 1.48rem; height: 1.48rem; border-radius: .46rem; }
  .collapse-control svg { width: .74rem; height: .74rem; }
  .ip-row { display: none; }
  .metric-card {
    min-height: 2.42rem;
    grid-template-rows: minmax(0,1fr) auto;
    padding: .18rem .22rem;
    gap: .06rem;
  }
  .metric-layout { grid-template-columns: minmax(0,.82fr) minmax(0,1.18fr); }
  .metric-values { display: grid; height: 100%; gap: .06rem; }
  .metric-detail-full { display: none; }
  .metric-detail-compact { display: block; font-size: .47rem; }
  .metric-progress { display: block; height: .14rem; }
  .cpu-water { top: 1.02rem; }
  .network-card { padding-block: .2rem; }
  .is-collapsed .header-main { min-height: 2.42rem; }
  .is-collapsed .collapsed-summary {
    grid-template-rows: repeat(2,minmax(1.42rem,1fr));
    gap: .48rem;
    height: 4.45rem;
    padding: .24rem .54rem .58rem;
  }
  .summary-row { min-height: 1.42rem; font-size: clamp(.65rem, 5.35cqw, .74rem); }
  .is-collapsed .collapse-control { width: 1.62rem; height: 1.62rem; }
}
@container status-pane (max-height: 320px) and (max-width: 190px) {
  .cpu-water { top: 1.02rem; }
}
</style>
