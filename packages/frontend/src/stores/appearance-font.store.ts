/**
 * 外观 Store - 字体与文字效果子模块
 * 职责：终端字体、编辑器字体、文字描边、文字阴影的设置
 */
import { computed } from 'vue';
import type { AppearanceSettings } from '../types/appearance.types';

/** 字体子 Store 的依赖参数 */
export interface FontDeps {
  appearanceSettings: { value: Partial<AppearanceSettings> };
  updateAppearanceSettings: (updates: Record<string, unknown>) => Promise<void>;
}

/**
 * 创建字体与文字效果子 Store
 */
export function createFontStore(deps: FontDeps) {
  const { appearanceSettings, updateAppearanceSettings } = deps;
  // 辅助函数：安全获取 settings（ref 始终已初始化，不会为 undefined）
  const getSettings = () => appearanceSettings.value as AppearanceSettings;

  // --- 终端字体计算属性 ---

  const currentTerminalFontFamily = computed<string>(() => {
    return (
      getSettings().terminalFontFamily ||
      'Consolas, "Courier New", monospace, "Microsoft YaHei", "微软雅黑"'
    );
  });

  const currentTerminalFontSize = computed<number>(() => {
    // 此 getter 根据设备类型返回对应的字体大小
    const size = getSettings().terminalFontSize;
    return typeof size === 'number' && size > 0 ? size : 14;
  });

  const terminalFontSizeDesktop = computed<number>(() => {
    const size = getSettings().terminalFontSize;
    return typeof size === 'number' && size > 0 ? size : 14;
  });

  const terminalFontSizeMobile = computed<number>(() => {
    const size = getSettings().terminalFontSizeMobile;
    return typeof size === 'number' && size > 0 ? size : 14;
  });

  // --- 编辑器字体计算属性 ---

  const currentEditorFontSize = computed<number>(() => {
    const size = getSettings().editorFontSize;
    return typeof size === 'number' && size > 0 ? size : 14;
  });

  const currentEditorFontFamily = computed<string>(() => {
    return getSettings().editorFontFamily || 'Consolas, "Noto Sans SC", "Microsoft YaHei"';
  });

  const currentMobileEditorFontSize = computed<number>(() => {
    const size = getSettings().mobileEditorFontSize;
    return typeof size === 'number' && size > 0 ? size : 16;
  });

  // --- 文字描边计算属性 ---

  const terminalTextStrokeEnabled = computed<boolean>(() => {
    return getSettings().terminalTextStrokeEnabled ?? false;
  });
  const terminalTextStrokeWidth = computed<number>(() => {
    return getSettings().terminalTextStrokeWidth ?? 1;
  });
  const terminalTextStrokeColor = computed<string>(() => {
    return getSettings().terminalTextStrokeColor ?? '#000000';
  });

  // --- 文字阴影计算属性 ---

  const terminalTextShadowEnabled = computed<boolean>(() => {
    return getSettings().terminalTextShadowEnabled ?? false;
  });
  const terminalTextShadowOffsetX = computed<number>(() => {
    return getSettings().terminalTextShadowOffsetX ?? 0;
  });
  const terminalTextShadowOffsetY = computed<number>(() => {
    return getSettings().terminalTextShadowOffsetY ?? 0;
  });
  const terminalTextShadowBlur = computed<number>(() => {
    return getSettings().terminalTextShadowBlur ?? 0;
  });
  const terminalTextShadowColor = computed<string>(() => {
    return getSettings().terminalTextShadowColor ?? 'rgba(0,0,0,0.5)';
  });

  // --- 字体设置操作方法 ---

  async function setTerminalFontFamily(fontFamily: string) {
    await updateAppearanceSettings({ terminalFontFamily: fontFamily });
  }

  async function setTerminalFontSize(size: number) {
    await updateAppearanceSettings({ terminalFontSize: size });
  }

  async function setTerminalFontSizeMobile(size: number) {
    await updateAppearanceSettings({ terminalFontSizeMobile: size });
  }

  async function setEditorFontSize(size: number) {
    await updateAppearanceSettings({ editorFontSize: size });
  }

  async function setEditorFontFamily(fontFamily: string) {
    await updateAppearanceSettings({ editorFontFamily: fontFamily });
  }

  async function setMobileEditorFontSize(size: number) {
    await updateAppearanceSettings({ mobileEditorFontSize: size });
  }

  // --- 文字描边设置操作方法 ---

  async function setTerminalTextStrokeEnabled(enabled: boolean) {
    await updateAppearanceSettings({ terminalTextStrokeEnabled: enabled });
  }
  async function setTerminalTextStrokeWidth(width: number) {
    await updateAppearanceSettings({ terminalTextStrokeWidth: width });
  }
  async function setTerminalTextStrokeColor(color: string) {
    await updateAppearanceSettings({ terminalTextStrokeColor: color });
  }

  // --- 文字阴影设置操作方法 ---

  async function setTerminalTextShadowEnabled(enabled: boolean) {
    await updateAppearanceSettings({ terminalTextShadowEnabled: enabled });
  }
  async function setTerminalTextShadowOffsetX(offset: number) {
    await updateAppearanceSettings({ terminalTextShadowOffsetX: offset });
  }
  async function setTerminalTextShadowOffsetY(offset: number) {
    await updateAppearanceSettings({ terminalTextShadowOffsetY: offset });
  }
  async function setTerminalTextShadowBlur(blur: number) {
    await updateAppearanceSettings({ terminalTextShadowBlur: blur });
  }
  async function setTerminalTextShadowColor(color: string) {
    await updateAppearanceSettings({ terminalTextShadowColor: color });
  }

  return {
    // 终端字体计算属性
    currentTerminalFontFamily,
    currentTerminalFontSize,
    terminalFontSizeDesktop,
    terminalFontSizeMobile,
    // 编辑器字体计算属性
    currentEditorFontSize,
    currentEditorFontFamily,
    currentMobileEditorFontSize,
    // 文字描边计算属性
    terminalTextStrokeEnabled,
    terminalTextStrokeWidth,
    terminalTextStrokeColor,
    // 文字阴影计算属性
    terminalTextShadowEnabled,
    terminalTextShadowOffsetX,
    terminalTextShadowOffsetY,
    terminalTextShadowBlur,
    terminalTextShadowColor,
    // 字体设置方法
    setTerminalFontFamily,
    setTerminalFontSize,
    setTerminalFontSizeMobile,
    setEditorFontSize,
    setEditorFontFamily,
    setMobileEditorFontSize,
    // 文字描边设置方法
    setTerminalTextStrokeEnabled,
    setTerminalTextStrokeWidth,
    setTerminalTextStrokeColor,
    // 文字阴影设置方法
    setTerminalTextShadowEnabled,
    setTerminalTextShadowOffsetX,
    setTerminalTextShadowOffsetY,
    setTerminalTextShadowBlur,
    setTerminalTextShadowColor,
  };
}

export type FontStore = ReturnType<typeof createFontStore>;
