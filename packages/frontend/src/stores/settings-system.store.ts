/**
 * 设置 Store - 系统设置子模块
 * 职责：语言、通用 UI 偏好、Docker/状态监控等系统级设置的计算属性
 */
import { computed } from 'vue';
import { defaultLng } from '../i18n';
import type { ConnectionInfo } from './connections.store';

export type SortField = keyof Pick<
  ConnectionInfo,
  'created_at' | 'last_connected_at' | 'updated_at' | 'name' | 'type'
>;
export type SortOrder = 'asc' | 'desc';

/** 系统设置子模块的依赖参数 */
export interface SystemSettingsDeps {
  settings: { value: Record<string, string | undefined> };
}

/**
 * 创建系统设置子 Store 的计算属性
 */
export function createSystemSettingsGetters(deps: SystemSettingsDeps) {
  const { settings } = deps;

  /** 当前语言 */
  const language = computed(() => settings.value?.language || defaultLng);

  /** 弹窗文件编辑器 */
  const showPopupFileEditorBoolean = computed(() => {
    return settings.value?.showPopupFileEditor !== 'false';
  });

  /** 弹窗文件管理器 */
  const showPopupFileManagerBoolean = computed(() => {
    return settings.value?.showPopupFileManager !== 'false';
  });

  /** 共享编辑器标签页 */
  const shareFileEditorTabsBoolean = computed(() => {
    return settings.value?.shareFileEditorTabs !== 'false';
  });

  /** 选中即复制 */
  const autoCopyOnSelectBoolean = computed(() => {
    return settings.value?.autoCopyOnSelect === 'true';
  });

  /** Docker 状态刷新间隔（秒） */
  const dockerStatusIntervalSeconds = computed(() => {
    const val = parseInt(settings.value?.dockerStatusIntervalSeconds || '2', 10);
    return Number.isNaN(val) || val <= 0 ? 2 : val;
  });

  /** Docker 默认展开详情 */
  const dockerDefaultExpandBoolean = computed(() => {
    return settings.value?.dockerDefaultExpand === 'true';
  });

  /** 状态监控轮询间隔（秒） */
  const statusMonitorIntervalSecondsNumber = computed(() => {
    const val = parseInt(settings.value?.statusMonitorIntervalSeconds || '3', 10);
    return Number.isNaN(val) || val <= 0 ? 3 : val;
  });

  /** 状态监视器显示 IP 地址 */
  const statusMonitorShowIpBoolean = computed(() => {
    return settings.value?.showStatusMonitorIpAddress === 'true';
  });

  /** 命令输入同步目标 */
  const commandInputSyncTarget = computed(() => {
    const target = settings.value?.commandInputSyncTarget;
    if (target === 'quickCommands' || target === 'commandHistory') {
      return target;
    }
    return 'none';
  });

  /** 时区 */
  const timezone = computed(() => settings.value?.timezone || 'UTC');

  /** 仪表盘排序字段 */
  const dashboardSortBy = computed((): SortField => {
    const savedSortBy = settings.value?.dashboardSortBy;
    const validFields: SortField[] = [
      'created_at',
      'last_connected_at',
      'updated_at',
      'name',
      'type',
    ];
    return savedSortBy && validFields.includes(savedSortBy as SortField)
      ? (savedSortBy as SortField)
      : 'last_connected_at';
  });

  /** 仪表盘排序方向 */
  const dashboardSortOrder = computed((): SortOrder => {
    const savedSortOrder = settings.value?.dashboardSortOrder;
    return savedSortOrder === 'asc' || savedSortOrder === 'desc' ? savedSortOrder : 'desc';
  });

  /** 显示连接标签 */
  const showConnectionTagsBoolean = computed(() => {
    return settings.value?.showConnectionTags !== 'false';
  });

  /** 显示快捷命令标签 */
  const showQuickCommandTagsBoolean = computed(() => {
    return settings.value?.showQuickCommandTags !== 'false';
  });

  /** 快捷指令视图紧凑模式 */
  const quickCommandsCompactModeBoolean = computed(() => {
    return settings.value?.quickCommandsCompactMode === 'true';
  });

  /** 快捷命令列表行大小乘数 */
  const quickCommandRowSizeMultiplierNumber = computed(() => {
    const valStr = settings.value?.quickCommandRowSizeMultiplier;
    if (valStr === null || valStr === undefined || valStr.trim() === '') {
      return 1.0;
    }
    const val = parseFloat(valStr);
    return Number.isNaN(val) || val <= 0 ? 1.0 : val;
  });

  /** 终端输出增强器开关 */
  const terminalOutputEnhancerEnabledBoolean = computed(() => {
    return settings.value?.terminalOutputEnhancerEnabled !== 'false';
  });

  /** 终端回滚行数上限（0 表示无限） */
  const terminalScrollbackLimitNumber = computed(() => {
    const valStr = settings.value?.terminalScrollbackLimit;
    if (valStr === null || valStr === undefined || valStr.trim() === '') {
      return 5000;
    }
    const val = parseInt(valStr, 10);
    if (Number.isNaN(val) || val < 0) {
      return 5000;
    }
    return val;
  });

  /** 终端自动换行 */
  const terminalAutoWrapEnabledBoolean = computed(() => {
    return settings.value?.terminalAutoWrapEnabled !== 'false';
  });

  /** 终端右键粘贴 */
  const terminalEnableRightClickPasteBoolean = computed(() => {
    return settings.value?.terminalEnableRightClickPaste !== 'false';
  });

  /** SSH 挂起会话保活时长（秒） */
  const sshSuspendKeepAliveSecondsNumber = computed(() => {
    const valStr = settings.value?.sshSuspendKeepAliveSeconds;
    if (valStr === null || valStr === undefined || valStr.trim() === '') {
      return 0;
    }
    const val = parseInt(valStr, 10);
    if (Number.isNaN(val) || val < 0) {
      return 0;
    }
    return val;
  });

  /** RDP 模态框尺寸 */
  const rdpModalWidth = computed(() => settings.value?.rdpModalWidth || '1064');
  const rdpModalHeight = computed(() => settings.value?.rdpModalHeight || '858');

  /** VNC 模态框尺寸 */
  const vncModalWidth = computed(() => settings.value?.vncModalWidth || '1024');
  const vncModalHeight = computed(() => settings.value?.vncModalHeight || '768');

  return {
    language,
    showPopupFileEditorBoolean,
    showPopupFileManagerBoolean,
    shareFileEditorTabsBoolean,
    autoCopyOnSelectBoolean,
    dockerStatusIntervalSeconds,
    dockerDefaultExpandBoolean,
    statusMonitorIntervalSecondsNumber,
    statusMonitorShowIpBoolean,
    commandInputSyncTarget,
    timezone,
    dashboardSortBy,
    dashboardSortOrder,
    showConnectionTagsBoolean,
    showQuickCommandTagsBoolean,
    quickCommandsCompactModeBoolean,
    quickCommandRowSizeMultiplierNumber,
    terminalOutputEnhancerEnabledBoolean,
    terminalScrollbackLimitNumber,
    terminalAutoWrapEnabledBoolean,
    terminalEnableRightClickPasteBoolean,
    sshSuspendKeepAliveSecondsNumber,
    rdpModalWidth,
    rdpModalHeight,
    vncModalWidth,
    vncModalHeight,
  };
}

export type SystemSettingsGetters = ReturnType<typeof createSystemSettingsGetters>;
