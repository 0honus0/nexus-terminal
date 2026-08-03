<template>
  <!-- 根元素，包含内边距、背景、边框和文本样式 -->
  <div class="status-monitor p-4 bg-background text-foreground h-full overflow-y-auto text-sm" :class="{ 'bg-header': !activeSessionId }">
  <h4 v-if="activeSessionId" class="status-monitor-title mt-0 mb-4 border-b border-border pb-2 text-base font-medium">
    {{ t('statusMonitor.title') }}
  </h4>

  <!-- 无活动会话状态 -->
  <div v-if="!activeSessionId" class="no-session-status flex flex-col items-center justify-center text-center text-text-secondary mt-4 h-full">
     <i class="fas fa-plug text-4xl mb-3 text-text-secondary"></i>
     <span class="text-lg font-medium mb-2">{{ t('layout.noActiveSession.title') }}</span>
  </div>

    <!-- 错误状态 -->
    <div v-else-if="currentStatusError" class="status-error flex flex-col items-center justify-center text-center text-red-500 mt-4 h-full">
       <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
       <span>{{ t('statusMonitor.errorPrefix') }} {{ currentStatusError }}</span>
    </div>

    <!-- 加载状态 -->
    <div v-else-if="!currentServerStatus" class="loading-status flex flex-col items-center justify-center text-center text-text-secondary mt-4 h-full">
      <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
      <span>{{ t('statusMonitor.loading') }}</span>
    </div>

    <!-- 状态网格 -->
    <div v-else class="status-grid grid gap-3">
      <!-- IP 地址 (如果启用) -->
      <div v-if="statusMonitorShowIpBoolean && activeSessionId && sessionIpAddress" class="status-item ip-status-item grid grid-cols-[auto_1fr] items-center gap-3">
        <label class="font-semibold text-text-secondary text-left whitespace-nowrap">IP:</label>
        <div class="flex min-w-0 items-center justify-end">
          <span
            class="ip-address-value truncate text-right cursor-pointer hover:text-primary transition-colors"
            :title="sessionIpAddress"
            @click="copyIpToClipboard(sessionIpAddress)">
            {{ sessionIpAddress }}
          </span>
        </div>
      </div>

      <!-- 资源使用率分组 -->
      <div class="resource-monitor-group grid gap-3 mb-3">
        <!-- CPU 使用率 -->
        <!-- 设置第一列固定宽度为 80px -->
        <div class="status-item resource-status-item cpu-status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.cpuLabel') }}</label>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-track flex-grow">
              <el-progress
                :percentage="displayCpuPercent"
                :stroke-width="16"
                color="#3b82f6"
                :show-text="false"
                class="themed-progress" :class="{ 'no-transition': isSwitchingSession }"
              />
              <span class="progress-percentage" :style="progressPercentageStyle(displayCpuPercent)">{{ formatPercentageText(displayCpuPercent) }}</span>
            </div>
            <!-- 移除 w-12 和 text-right 以实现左对齐 -->
          </div>
        </div>

        <!-- 内存使用率 -->
        <!-- 设置第一列固定宽度为 80px -->
        <div class="status-item resource-status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.memoryLabel') }}</label>
          <span class="resource-compact-summary font-mono" :title="memDisplay">
            {{ memDisplay }}
          </span>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-track flex-grow">
              <el-progress
                :percentage="displayMemPercent"
                :stroke-width="16"
                color="#22c55e"
                :show-text="false"
                class="themed-progress" :class="{ 'no-transition': isSwitchingSession }"
              />
              <span class="progress-percentage" :style="progressPercentageStyle(displayMemPercent)">{{ formatPercentageText(displayMemPercent) }}</span>
            </div>
            <span class="mem-disk-details resource-inline-details font-mono text-xs whitespace-nowrap text-left">{{ memDisplay }}</span>
          </div>
        </div>

         <!-- swap -->
         <!-- 设置第一列固定宽度为 80px -->
         <div class="status-item resource-status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.swapLabel') }}</label>
          <span class="resource-compact-summary font-mono" :title="swapDisplay">
            {{ swapDisplay }}
          </span>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-track flex-grow">
              <el-progress
                :percentage="displaySwapPercent"
                :stroke-width="16"
                :color="(currentServerStatus?.swapPercent ?? 0) > 0 ? '#eab308' : '#6b7280'"
                :show-text="false"
                class="themed-progress" :class="{ 'no-transition': isSwitchingSession }"
              />
              <span class="progress-percentage" :style="progressPercentageStyle(displaySwapPercent)">{{ formatPercentageText(displaySwapPercent) }}</span>
            </div>
            <span class="mem-disk-details resource-inline-details font-mono text-xs whitespace-nowrap text-left">{{ swapDisplay }}</span>
          </div>
        </div>

        <!-- 磁盘使用率 -->
        <!-- 设置第一列固定宽度为 80px -->
        <div class="status-item resource-status-item grid grid-cols-[40px_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.diskLabel') }}</label>
          <span class="resource-compact-summary font-mono" :title="diskDisplay">
            {{ diskDisplay }}
          </span>
          <div class="value-wrapper flex items-center gap-2">
            <div class="progress-track flex-grow">
              <el-progress
                :percentage="displayDiskPercent"
                :stroke-width="16"
                color="#a855f7"
                :show-text="false"
                class="themed-progress" :class="{ 'no-transition': isSwitchingSession }"
              />
              <span class="progress-percentage" :style="progressPercentageStyle(displayDiskPercent)">{{ formatPercentageText(displayDiskPercent) }}</span>
            </div>
            <span class="mem-disk-details resource-inline-details font-mono text-xs whitespace-nowrap text-left">{{ diskDisplay }}</span>
          </div>
        </div>
      </div>

    </div>

     <!-- 网络速率，仅在有活动会话且有数据时显示 -->
     <div v-if="activeSessionId && currentServerStatus" class="status-item network-status-item grid grid-cols-[auto_1fr] items-center gap-3 mt-2">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.networkLabel') }} ({{ currentServerStatus?.netInterface || '...' }}):</label>
          <div class="network-values flex items-center justify-start gap-4"> <!-- 减小间距 -->
            <span class="rate down inline-flex items-center gap-1 text-green-500 text-xs whitespace-nowrap">
              <i class="fas fa-arrow-down w-3 text-center"></i> <!-- Font Awesome 图标 -->
              <span class="font-mono">{{ formatBytesPerSecond(currentServerStatus?.netRxRate) }}</span>
            </span>
            <span class="rate up inline-flex items-center gap-1 text-orange-500 text-xs whitespace-nowrap">
               <i class="fas fa-arrow-up w-3 text-center"></i> <!-- Font Awesome 图标 -->
               <span class="font-mono">{{ formatBytesPerSecond(currentServerStatus?.netTxRate) }}</span>

            </span>
          </div>

      </div>
<!-- 图表组件 -->
      <!-- 仅当有活动会话且有数据时渲染图表 -->
      <StatusCharts v-if="activeSessionId && currentServerStatus" :server-status="currentServerStatus" :active-session-id="activeSessionId" />

      <div v-if="activeSessionId && currentServerStatus" class="system-info-group grid gap-3 mt-4 pt-3 border-t border-border">
        <!-- CPU 型号 -->
        <div class="status-item grid grid-cols-[auto_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.cpuModelLabel') }}</label>
          <span class="cpu-model-value truncate text-left" :title="displayCpuModel">{{ displayCpuModel }}</span>
        </div>

        <!-- 操作系统名称 -->
        <div class="status-item grid grid-cols-[auto_1fr] items-center gap-3">
          <label class="font-semibold text-text-secondary text-left whitespace-nowrap">{{ t('statusMonitor.osLabel') }}</label>
          <span class="os-name-value truncate text-left" :title="displayOsName">{{ displayOsName }}</span>
        </div>
      </div>
  </div>
</template>


<script setup lang="ts">

import { ref, computed, watch, type PropType, nextTick, onMounted, onBeforeUnmount, onActivated, onDeactivated } from 'vue';
import { ElProgress } from 'element-plus';
import { useI18n } from 'vue-i18n';
import StatusCharts from './StatusCharts.vue';
import { useSessionStore } from '../stores/session.store'; // 注入 sessionStore
import { storeToRefs } from 'pinia'; // 导入 storeToRefs
import { useSettingsStore } from '../stores/settings.store'; //  导入设置 store
import { useConnectionsStore } from '../stores/connections.store'; // 导入连接 store
import { useUiNotificationsStore } from '../stores/uiNotifications.store'; // + 导入通知 store

const { t } = useI18n();
const sessionStore = useSessionStore();
const settingsStore = useSettingsStore(); //  实例化设置 store
const connectionsStore = useConnectionsStore(); // 实例化连接 store
const uiNotificationsStore = useUiNotificationsStore(); // + 实例化通知 store
const { sessions } = storeToRefs(sessionStore); // 获取响应式的 sessions
const { statusMonitorShowIpBoolean } = storeToRefs(settingsStore); //  获取 IP 显示设置
const isSwitchingSession = ref(false);

const formatPercentageText = (percentage: number): string => `${Math.round(percentage)}%`;
const progressPercentageStyle = (percentage: number): Record<string, string> => ({
  '--progress-percentage': `${Math.min(100, Math.max(0, percentage))}%`,
});

interface ServerStatus {
  cpuPercent?: number;
  memPercent?: number;
  memUsed?: number; // MB
  memTotal?: number; // MB
  swapPercent?: number;
  swapUsed?: number; // MB
  swapTotal?: number; // MB
  diskPercent?: number;
  diskUsed?: number; // KB
  diskTotal?: number; // KB
  cpuModel?: string;
  netRxRate?: number; // 字节/秒
  netTxRate?: number; // 字节/秒
  netInterface?: string;
  osName?: string;
}

// --- Props ---
const props = defineProps({
  activeSessionId: {
    type: String as PropType<string | null>,
    required: false, // 允许为 null
    default: null,
  },
});

// --- Computed properties to get current session data ---
const currentSessionState = computed(() => {
  return props.activeSessionId ? sessions.value.get(props.activeSessionId) : null;
});

let attachedStatusManager: { activate: () => void; deactivate: () => void } | null = null;
let componentActive = false;

const syncStatusSubscription = () => {
  const nextManager = currentSessionState.value?.statusMonitorManager ?? null;
  if (attachedStatusManager === nextManager) return;
  if (componentActive) attachedStatusManager?.deactivate();
  attachedStatusManager = nextManager;
  if (componentActive) attachedStatusManager?.activate();
};

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

watch(currentSessionState, syncStatusSubscription);
onMounted(activateStatusComponent);
onActivated(activateStatusComponent);
onDeactivated(deactivateStatusComponent);
onBeforeUnmount(deactivateStatusComponent);

const currentServerStatus = computed<ServerStatus | null>(() => {
  return currentSessionState.value?.statusMonitorManager?.serverStatus?.value ?? null;
});

// --- 计算属性，用于绑定到进度条宽度 ---
// 始终返回当前状态的百分比。动画由 CSS 类控制。
const displayCpuPercent = computed(() => {
  return currentServerStatus.value?.cpuPercent ?? 0;
});

const displayMemPercent = computed(() => {
  return currentServerStatus.value?.memPercent ?? 0;
});

const displaySwapPercent = computed(() => {
  return currentServerStatus.value?.swapPercent ?? 0;
});

const displayDiskPercent = computed(() => {
  return currentServerStatus.value?.diskPercent ?? 0;
});

const currentStatusError = computed<string | null>(() => {
  return currentSessionState.value?.statusMonitorManager?.statusError?.value ?? null;
});

// --- 缓存逻辑保持不变 ---
const cachedCpuModel = ref<string | null>(null);
const cachedOsName = ref<string | null>(null);

// --- Watcher for caching CPU Model and OS Name ---
// 现在监听 currentServerStatus
watch(currentServerStatus, (newData) => {
  if (newData) {
    if (newData.cpuModel !== undefined && newData.cpuModel !== null && newData.cpuModel !== '') {
      cachedCpuModel.value = newData.cpuModel;
    }
    if (newData.osName !== undefined && newData.osName !== null && newData.osName !== '') {
      cachedOsName.value = newData.osName;
    }
  }
}, { immediate: true });

// --- 监听 activeSessionId 变化以处理会话切换状态 ---
watch(() => props.activeSessionId, async (newId, oldId) => {
  if (newId !== oldId) {
    isSwitchingSession.value = true;
    await nextTick(); // 等待DOM更新（currentServerStatus已改变，displayPercent们会返回0）
    isSwitchingSession.value = false;
  }
});

// --- Computed properties for display ---
const displayCpuModel = computed(() => {
  // 使用 currentServerStatus
  return (currentServerStatus.value?.cpuModel ?? cachedCpuModel.value) || t('statusMonitor.notAvailable');
});

const displayOsName = computed(() => {
  // 使用 currentServerStatus
  return (currentServerStatus.value?.osName ?? cachedOsName.value) || t('statusMonitor.notAvailable');
});

const formatBytesPerSecond = (bytes?: number): string => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return t('statusMonitor.notAvailable');
    if (bytes < 1024) return `${bytes} ${t('statusMonitor.bytesPerSecond')}`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ${t('statusMonitor.kiloBytesPerSecond')}`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} ${t('statusMonitor.megaBytesPerSecond')}`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} ${t('statusMonitor.gigaBytesPerSecond')}`;
};

const formatKbToGb = (kb?: number): string => {
    if (kb === undefined || kb === null) return t('statusMonitor.notAvailable');
    if (kb === 0) return `0.0 ${t('statusMonitor.gigaBytes')}`;
    const gb = kb / 1024 / 1024;
    return `${gb.toFixed(1)} ${t('statusMonitor.gigaBytes')}`;
};

// 辅助函数，用于在需要时将 MB 格式化为 GB
const formatMemorySize = (mb?: number): string => {
    if (mb === undefined || mb === null || isNaN(mb)) return t('statusMonitor.notAvailable');
    if (mb < 1024) {
        const value = Number.isInteger(mb) ? mb : mb.toFixed(1);
        return `${value} ${t('statusMonitor.megaBytes')}`;
    } else {
        const gb = mb / 1024;
        return `${gb.toFixed(1)} ${t('statusMonitor.gigaBytes')}`;
    }
};

const memDisplay = computed(() => {
    const data = currentServerStatus.value; // 使用 currentServerStatus
    if (!data || data.memUsed === undefined || data.memTotal === undefined) return t('statusMonitor.notAvailable');
    return `${formatMemorySize(data.memUsed)} / ${formatMemorySize(data.memTotal)}`;
});

const diskDisplay = computed(() => {
    const data = currentServerStatus.value; // 使用 currentServerStatus
    if (!data || data.diskUsed === undefined || data.diskTotal === undefined) return t('statusMonitor.notAvailable');
    return `${formatKbToGb(data.diskUsed)} / ${formatKbToGb(data.diskTotal)}`;
});

const swapDisplay = computed(() => {
    const data = currentServerStatus.value; // 使用 currentServerStatus
    const used = data?.swapUsed ?? 0;
    const total = data?.swapTotal ?? 0;
    const percentVal = data?.swapPercent ?? 0;

    // 仅当交换空间总量 > 0 时显示详细信息
    if (total === 0) {
        return t('statusMonitor.swapNotAvailable'); // 或更具体的消息
    }

    return `${formatMemorySize(used)} / ${formatMemorySize(total)}`;
});

const sessionIpAddress = computed(() => {
  const sessionState = currentSessionState.value;
  if (sessionState && sessionState.connectionId) {
    //  直接从 connectionsStore 的 connections 数组中查找
    const connectionIdAsNumber = parseInt(sessionState.connectionId, 10);
    if (isNaN(connectionIdAsNumber)) {
      return null; // 如果 connectionId 不是有效的数字，则返回 null
    }
    const connectionInfo = connectionsStore.connections.find(conn => conn.id === connectionIdAsNumber);
    return connectionInfo?.host || null;
  }
  return null;
});

const copyIpToClipboard = async (ipAddress: string | null) => {
  if (!ipAddress) return;
  try {
    await navigator.clipboard.writeText(ipAddress);
    uiNotificationsStore.showSuccess(t('common.copied', '已复制!')); 
  } catch (err) {
    console.error('Failed to copy IP address: ', err);
    uiNotificationsStore.showError(t('statusMonitor.copyIpError', '复制 IP 失败'));
  }
};

</script>

<style scoped>
.status-monitor {
  container-type: inline-size;
  container-name: status-monitor-pane;
  min-width: 0;
  padding: 0.75rem !important;
  --status-progress-font-size: 9px;
}
.status-monitor-title {
  margin-bottom: 0.75rem !important;
  padding-bottom: 0.5rem !important;
}
.status-grid {
  gap: 0.6rem !important;
}
.system-info-group {
  gap: 0.5rem !important;
  margin-top: 0.75rem !important;
  padding-top: 0.6rem !important;
}
.status-grid,
.status-item,
.value-wrapper {
  min-width: 0;
}
.status-item label {
  min-width: max-content;
}
.cpu-model-value,
.os-name-value,
.ip-address-value {
  min-width: 0;
}
.ip-address-value {
  font-size: 0.8rem;
}
.progress-track {
  position: relative;
  min-width: 0;
  width: 100%;
}
.progress-track .themed-progress {
  width: 100%;
}
.progress-percentage {
  position: absolute;
  top: 50%;
  left: clamp(1.35rem, var(--progress-percentage), calc(100% - 0.15rem));
  z-index: 1;
  color: #fff;
  font-size: var(--status-progress-font-size);
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  pointer-events: none;
  transform: translate(-100%, -50%);
  text-shadow: 0 1px 1px rgb(0 0 0 / 45%);
}
.resource-monitor-group {
  grid-template-columns: minmax(0, 1fr);
  gap: 0.55rem !important;
  margin-bottom: 0.55rem !important;
}
.resource-compact-summary {
  display: none;
  min-width: 0;
  text-align: right;
}
.network-values {
  min-width: 0;
  flex-wrap: wrap;
  row-gap: 0.25rem;
}
@container status-monitor-pane (min-width: 560px) {
  .resource-monitor-group {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .resource-monitor-group .status-item {
    grid-template-columns: 52px minmax(0, 1fr);
  }
}
@container status-monitor-pane (max-width: 380px) {
  .status-monitor {
    padding: 0.5rem !important;
    font-size: 0.76rem;
    --status-progress-font-size: 7px;
  }
  .status-monitor-title {
    margin-bottom: 0.65rem;
    padding-bottom: 0.45rem;
  }
  .status-grid {
    gap: 0.4rem;
  }
  .status-item {
    grid-template-columns: minmax(0, 1fr) !important;
    align-items: stretch;
    gap: 0.3rem !important;
  }
  .status-item label {
    min-width: 0;
    white-space: normal;
    font-size: 0.7rem;
    line-height: 1.25;
  }
  .ip-status-item {
    grid-template-columns: auto minmax(0, 1fr) !important;
    align-items: center;
    gap: 0.5rem !important;
  }
  .ip-status-item label {
    white-space: nowrap;
  }
  .ip-address-value {
    width: 100%;
    font-size: 0.7rem;
    line-height: 1.2;
    text-align: right;
  }
  .value-wrapper {
    align-items: stretch;
    flex-direction: column;
    gap: 0.18rem;
  }
  .resource-monitor-group .resource-status-item {
    grid-template-columns: auto minmax(0, 1fr) !important;
    align-items: center;
    column-gap: 0.4rem !important;
    row-gap: 0.18rem !important;
  }
  .resource-status-item label {
    white-space: nowrap;
    font-size: 0.68rem;
    line-height: 1.1;
  }
  .resource-status-item .resource-compact-summary {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.64rem;
    line-height: 1.1;
  }
  .resource-status-item .value-wrapper {
    grid-column: 1 / -1;
    flex-direction: row;
  }
  .resource-status-item .resource-inline-details {
    display: none;
  }
  .mem-disk-details {
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .network-status-item {
    grid-template-columns: auto minmax(0, 1fr) !important;
    align-items: center;
    gap: 0.45rem !important;
  }
  .network-status-item label {
    max-width: 11rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .network-status-item .network-values {
    align-items: center;
    flex-direction: row;
    flex-wrap: wrap;
    column-gap: 0.55rem !important;
    row-gap: 0.15rem !important;
  }
  ::v-deep(.themed-progress .el-progress-bar__outer) {
    height: 11px !important;
  }
}
@container status-monitor-pane (max-width: 260px) {
  .status-monitor {
    --status-progress-font-size: 6px;
  }
  .resource-status-item label {
    font-size: 0.64rem;
  }
  .resource-status-item .resource-compact-summary {
    font-size: 0.6rem;
  }
  ::v-deep(.themed-progress .el-progress-bar__outer) {
    height: 10px !important;
  }
}
@container status-monitor-pane (max-width: 220px) {
  .resource-monitor-group .cpu-status-item {
    grid-template-columns: minmax(0, 1fr) !important;
    row-gap: 0.18rem !important;
  }
  .cpu-status-item .value-wrapper {
    grid-column: 1 / -1;
  }
  .network-status-item {
    grid-template-columns: minmax(0, 1fr) !important;
    align-items: stretch;
  }
}

::v-deep(.el-progress-bar__outer) {
  background-color: var(--header-bg-color) !important; 
}
::v-deep(.themed-progress .el-progress-bar__inner) {
  transition: width 0.3s ease-in-out;
}
::v-deep(.themed-progress.no-transition .el-progress-bar__inner) {
  transition: none !important;
}
</style>
