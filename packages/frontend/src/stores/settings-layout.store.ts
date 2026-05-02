/**
 * 设置 Store - 布局设置子模块
 * 职责：侧边栏宽度、文件管理器布局、布局锁定等布局相关设置的计算属性
 */
import { computed } from 'vue';
import type { PaneName } from './layout.store';

/** 布局设置子模块的依赖参数 */
export interface LayoutSettingsDeps {
  settings: { value: Record<string, string | undefined> };
  parsedSidebarPaneWidths: { value: Record<string, string> };
  parsedFileManagerColWidths: { value: Record<string, number> };
}

/**
 * 创建布局设置子 Store 的计算属性
 */
export function createLayoutSettingsGetters(deps: LayoutSettingsDeps) {
  const { settings, parsedSidebarPaneWidths, parsedFileManagerColWidths } = deps;

  /** 工作区侧边栏是否固定 */
  const workspaceSidebarPersistentBoolean = computed(() => {
    return settings.value!.workspaceSidebarPersistent === 'true';
  });

  /** 获取特定面板宽度 */
  const getSidebarPaneWidth = computed(() => (paneName: PaneName | null): string => {
    const defaultWidth = '350px';
    if (!paneName) return defaultWidth;
    const widths = parsedSidebarPaneWidths.value! || {};
    return widths[paneName] || defaultWidth;
  });

  /** 文件管理器行大小乘数 */
  const fileManagerRowSizeMultiplierNumber = computed(() => {
    const val = parseFloat(settings.value!.fileManagerRowSizeMultiplier || '1.0');
    return Number.isNaN(val) || val <= 0 ? 1.0 : val;
  });

  /** 文件管理器列宽 */
  const fileManagerColWidthsObject = computed(() => {
    return parsedFileManagerColWidths.value!;
  });

  /** 文件管理器删除确认提示 */
  const fileManagerShowDeleteConfirmationBoolean = computed(() => {
    return settings.value!.fileManagerShowDeleteConfirmation !== 'false';
  });

  /** 文件管理器单击打开文件 */
  const fileManagerSingleClickOpenFileBoolean = computed(() => {
    return settings.value!.fileManagerSingleClickOpenFile === 'true';
  });

  /** 布局锁定状态 */
  const layoutLockedBoolean = computed(() => {
    return settings.value!.layoutLocked === 'true';
  });

  return {
    workspaceSidebarPersistentBoolean,
    getSidebarPaneWidth,
    fileManagerRowSizeMultiplierNumber,
    fileManagerColWidthsObject,
    fileManagerShowDeleteConfirmationBoolean,
    fileManagerSingleClickOpenFileBoolean,
    layoutLockedBoolean,
  };
}

export type LayoutSettingsGetters = ReturnType<typeof createLayoutSettingsGetters>;
