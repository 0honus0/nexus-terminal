import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

const mockLocale = ref<'zh-CN' | 'en-US'>('zh-CN');

const translations: Record<string, Record<string, string>> = {
  'zh-CN': {
    'settings.tabs.workspace': '工作区',
    'settings.tabs.system': '系统',
    'settings.tabs.ai': 'AI 助手',
    'settings.tabs.security': '安全',
    'settings.tabs.ipControl': 'IP 管控',
    'settings.tabs.dataManagement': '数据管理',
    'settings.tabs.appearance': '外观',
    'settings.tabs.about': '关于',
  },
  'en-US': {
    'settings.tabs.workspace': 'Workspace',
    'settings.tabs.system': 'System',
    'settings.tabs.ai': 'AI Assistant',
    'settings.tabs.security': 'Security',
    'settings.tabs.ipControl': 'IP Control',
    'settings.tabs.dataManagement': 'Data Management',
    'settings.tabs.appearance': 'Appearance',
    'settings.tabs.about': 'About',
  },
};

vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: mockLocale,
    },
  }),
  useI18n: () => ({
    t: (key: string, fallback?: string) => translations[mockLocale.value][key] ?? fallback ?? key,
  }),
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia');
  return {
    ...actual,
    storeToRefs: <T extends object>(store: T) => store,
  };
});

const settingsStoreMock = {
  settings: ref({}),
  isLoading: ref(false),
  error: ref(null),
  captchaError: ref(null),
  language: ref('zh-CN'),
  loadCaptchaSettings: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../stores/settings.store', () => ({
  useSettingsStore: () => settingsStoreMock,
}));

vi.mock('../stores/captchaSettings.store', () => ({
  useCaptchaSettingsStore: () => ({
    captchaSettings: ref(null),
    captchaError: ref(null),
    isLoading: ref(false),
    isCaptchaEnabled: ref(false),
    captchaProvider: ref('none'),
    hcaptchaSiteKey: ref(''),
    recaptchaSiteKey: ref(''),
    loadCaptchaSettings: vi.fn().mockResolvedValue(undefined),
    updateCaptchaSettings: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('../stores/auth.store', () => ({
  useAuthStore: () => ({}),
}));

vi.mock('../stores/appearance.store', () => ({
  useAppearanceStore: () => ({}),
}));

vi.mock('../composables/settings/useVersionCheck', () => ({
  useVersionCheck: () => ({
    isUpdateAvailable: ref(false),
    checkLatestVersion: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('SettingsView tabs i18n', () => {
  beforeEach(() => {
    mockLocale.value = 'zh-CN';
    settingsStoreMock.loadCaptchaSettings.mockClear();
  });

  it('切换语言后 tabs 文案应响应更新', async () => {
    const { default: SettingsView } = await import('./SettingsView.vue');

    const wrapper = mount(SettingsView, {
      global: {
        stubs: {
          ChangePasswordForm: true,
          PasskeyManagement: true,
          TwoFactorAuthSettings: true,
          CaptchaSettingsForm: true,
          IpWhitelistSettings: true,
          IpBlacklistSettings: true,
          AboutSection: true,
          WorkspaceSettingsSection: true,
          SystemSettingsSection: true,
          DataManagementSection: true,
          AppearanceSection: true,
          AISettingsSection: true,
        },
      },
    });

    const getTabLabels = () =>
      wrapper
        .findAll('button')
        .map((button) => button.text().trim())
        .filter(Boolean);

    expect(getTabLabels()).toContain('工作区');
    expect(getTabLabels()).not.toContain('Workspace');

    mockLocale.value = 'en-US';
    await nextTick();

    expect(getTabLabels()).toContain('Workspace');
    expect(getTabLabels()).not.toContain('工作区');
  });
});
