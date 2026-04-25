import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from './settings.store';
import apiClient from '../utils/apiClient';

// Mock 依赖
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../i18n', () => ({
  setLocale: vi.fn(),
  defaultLng: 'en-US',
  availableLocales: ['en-US', 'zh-CN'],
}));

describe('settings.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useSettingsStore();
      expect(store.settings).toEqual({});
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('Getters 默认值', () => {
    it('language 应返回默认语言 en-US', () => {
      const store = useSettingsStore();
      expect(store.language).toBe('en-US');
    });

    it('showPopupFileEditorBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showPopupFileEditorBoolean).toBe(true);
    });

    it('showPopupFileManagerBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showPopupFileManagerBoolean).toBe(true);
    });

    it('shareFileEditorTabsBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.shareFileEditorTabsBoolean).toBe(true);
    });

    it('ipWhitelistEnabled 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.ipWhitelistEnabled).toBe(false);
    });

    it('ipBlacklistEnabledBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.ipBlacklistEnabledBoolean).toBe(true);
    });

    it('autoCopyOnSelectBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.autoCopyOnSelectBoolean).toBe(false);
    });

    it('workspaceSidebarPersistentBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.workspaceSidebarPersistentBoolean).toBe(false);
    });

    it('dockerDefaultExpandBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.dockerDefaultExpandBoolean).toBe(false);
    });

    it('statusMonitorIntervalSecondsNumber 默认应为 3', () => {
      const store = useSettingsStore();
      expect(store.statusMonitorIntervalSecondsNumber).toBe(3);
    });

    it('fileManagerRowSizeMultiplierNumber 默认应为 1.0', () => {
      const store = useSettingsStore();
      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.0);
    });

    it('commandInputSyncTarget 默认应为 none', () => {
      const store = useSettingsStore();
      expect(store.commandInputSyncTarget).toBe('none');
    });

    it('timezone 默认应为 UTC', () => {
      const store = useSettingsStore();
      expect(store.timezone).toBe('UTC');
    });

    it('dashboardSortBy 默认应为 last_connected_at', () => {
      const store = useSettingsStore();
      expect(store.dashboardSortBy).toBe('last_connected_at');
    });

    it('dashboardSortOrder 默认应为 desc', () => {
      const store = useSettingsStore();
      expect(store.dashboardSortOrder).toBe('desc');
    });

    it('showConnectionTagsBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showConnectionTagsBoolean).toBe(true);
    });

    it('showQuickCommandTagsBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showQuickCommandTagsBoolean).toBe(true);
    });

    it('layoutLockedBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.layoutLockedBoolean).toBe(false);
    });

    it('terminalScrollbackLimitNumber 默认应为 5000', () => {
      const store = useSettingsStore();
      expect(store.terminalScrollbackLimitNumber).toBe(5000);
    });

    it('terminalAutoWrapEnabledBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.terminalAutoWrapEnabledBoolean).toBe(true);
    });

    it('sshSuspendKeepAliveSecondsNumber 默认应为 0', () => {
      const store = useSettingsStore();
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(0);
    });

    it('fileManagerShowDeleteConfirmationBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.fileManagerShowDeleteConfirmationBoolean).toBe(true);
    });

    it('fileManagerSingleClickOpenFileBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.fileManagerSingleClickOpenFileBoolean).toBe(false);
    });

    it('terminalEnableRightClickPasteBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.terminalEnableRightClickPasteBoolean).toBe(true);
    });

    it('statusMonitorShowIpBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.statusMonitorShowIpBoolean).toBe(false);
    });

    it('quickCommandRowSizeMultiplierNumber 默认应为 1.0', () => {
      const store = useSettingsStore();
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.0);
    });

    it('quickCommandsCompactModeBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.quickCommandsCompactModeBoolean).toBe(false);
    });

    it('terminalOutputEnhancerEnabledBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.terminalOutputEnhancerEnabledBoolean).toBe(true);
    });
  });

  describe('Getters 自定义值', () => {
    it('language 应从 settings 中返回设置的语言', () => {
      const store = useSettingsStore();
      store.settings.language = 'zh-CN';
      expect(store.language).toBe('zh-CN');
    });

    it('showPopupFileEditorBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.showPopupFileEditor = 'false';
      expect(store.showPopupFileEditorBoolean).toBe(false);
    });

    it('ipWhitelistEnabled 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.ipWhitelistEnabled = 'true';
      expect(store.ipWhitelistEnabled).toBe(true);
    });

    it('autoCopyOnSelectBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.autoCopyOnSelect = 'true';
      expect(store.autoCopyOnSelectBoolean).toBe(true);
    });

    it('layoutLockedBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.layoutLocked = 'true';
      expect(store.layoutLockedBoolean).toBe(true);
    });

    it('terminalScrollbackLimitNumber 应正确解析数字', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = '10000';
      expect(store.terminalScrollbackLimitNumber).toBe(10000);
    });

    it('terminalScrollbackLimitNumber 为 0 时应返回 0', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = '0';
      expect(store.terminalScrollbackLimitNumber).toBe(0);
    });

    it('terminalScrollbackLimitNumber 为无效值时应回退到 5000', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = 'invalid';
      expect(store.terminalScrollbackLimitNumber).toBe(5000);
    });

    it('sshSuspendKeepAliveSecondsNumber 应正确解析数字', () => {
      const store = useSettingsStore();
      store.settings.sshSuspendKeepAliveSeconds = '60';
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(60);
    });

    it('commandInputSyncTarget 为 quickCommands 时应返回该值', () => {
      const store = useSettingsStore();
      store.settings.commandInputSyncTarget = 'quickCommands';
      expect(store.commandInputSyncTarget).toBe('quickCommands');
    });

    it('commandInputSyncTarget 为无效值时应回退到 none', () => {
      const store = useSettingsStore();
      store.settings.commandInputSyncTarget = 'invalid' as any;
      expect(store.commandInputSyncTarget).toBe('none');
    });

    it('dashboardSortBy 为无效值时应回退到 last_connected_at', () => {
      const store = useSettingsStore();
      store.settings.dashboardSortBy = 'invalid' as any;
      expect(store.dashboardSortBy).toBe('last_connected_at');
    });

    it('dashboardSortOrder 为无效值时应回退到 desc', () => {
      const store = useSettingsStore();
      store.settings.dashboardSortOrder = 'invalid' as any;
      expect(store.dashboardSortOrder).toBe('desc');
    });

    it('quickCommandRowSizeMultiplierNumber 应正确解析浮点数', () => {
      const store = useSettingsStore();
      store.settings.quickCommandRowSizeMultiplier = '1.50';
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.5);
    });

    it('quickCommandsCompactModeBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.quickCommandsCompactMode = 'true';
      expect(store.quickCommandsCompactModeBoolean).toBe(true);
    });
  });

  describe('updateSetting', () => {
    it('应成功更新允许的设置项', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('language', 'zh-CN');

      expect(apiClient.put).toHaveBeenCalledWith('/settings', { language: 'zh-CN' });
      expect(store.settings.language).toBe('zh-CN');
    });

    it('应拒绝更新不允许的设置键', async () => {
      const store = useSettingsStore();

      await expect(store.updateSetting('invalidKey' as any, 'value')).rejects.toThrow(
        "不允许更新设置项 'invalidKey'"
      );
    });

    it('更新失败时应抛出错误', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });

      await expect(store.updateSetting('language', 'zh-CN')).rejects.toThrow('更新失败');
    });

    it('应通过专用端点更新布尔设置', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('showConnectionTags', true);

      expect(apiClient.put).toHaveBeenCalledWith('/settings/show-connection-tags', {
        enabled: true,
      });
    });
  });

  describe('updateMultipleSettings', () => {
    it('应成功批量更新设置', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
      });

      expect(apiClient.put).toHaveBeenCalledWith('/settings', {
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
      });
      expect(store.settings.language).toBe('zh-CN');
      expect(store.settings.timezone).toBe('Asia/Shanghai');
    });

    it('应过滤不允许的设置键', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({
        language: 'zh-CN',
        invalidKey: 'value',
      } as any);

      expect(apiClient.put).toHaveBeenCalledWith('/settings', { language: 'zh-CN' });
    });

    it('无有效设置时应不发送请求', async () => {
      const store = useSettingsStore();

      await store.updateMultipleSettings({ invalidKey: 'value' } as any);

      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('更新失败时应抛出错误', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '批量更新失败' } },
      });

      await expect(store.updateMultipleSettings({ language: 'zh-CN' })).rejects.toThrow(
        '批量更新失败'
      );
    });
  });

  describe('loadInitialSettings', () => {
    it('应成功加载设置并设置默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { language: 'zh-CN' } })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.settings.language).toBe('zh-CN');
      expect(store.settings.showPopupFileEditor).toBe('true');
      expect(store.settings.ipWhitelistEnabled).toBe('false');
      expect(store.settings.maxLoginAttempts).toBe('5');
      expect(store.settings.loginBanDuration).toBe('300');
    });

    it('加载失败时应设置错误状态', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络错误'));

      await store.loadInitialSettings();

      expect(store.isLoading).toBe(false);
      expect(store.error).toBeTruthy();
    });

    it('加载完成后 isLoading 应为 false', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: false } })
        .mockResolvedValueOnce({ data: { enabled: false } });

      await store.loadInitialSettings();

      expect(store.isLoading).toBe(false);
    });
  });

  describe('saveDashboardSortPreference', () => {
    it('应保存仪表盘排序偏好', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.saveDashboardSortPreference('name', 'asc');

      expect(apiClient.put).toHaveBeenCalledWith('/settings', {
        dashboardSortBy: 'name',
        dashboardSortOrder: 'asc',
      });
    });
  });

  describe('getSidebarPaneWidth', () => {
    it('应返回默认宽度当没有设置时', () => {
      const store = useSettingsStore();
      expect(store.getSidebarPaneWidth(null)).toBe('350px');
    });

    it('应返回默认宽度当面板名称不在已知列表中', () => {
      const store = useSettingsStore();
      expect(store.getSidebarPaneWidth('unknown' as any)).toBe('350px');
    });
  });
});
