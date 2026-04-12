import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick, ref, type Ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useIpBlacklist } from './useIpBlacklist';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia');
  return {
    ...actual,
    storeToRefs: <T extends object>(store: T) => store,
  };
});

type MockFn = ReturnType<typeof vi.fn>;

interface SettingsStoreMock {
  settings: Ref<{ maxLoginAttempts: string; loginBanDuration: string }>;
  ipBlacklistEnabledBoolean: Ref<boolean>;
  updateSetting: MockFn;
  updateMultipleSettings: MockFn;
}

interface AuthStoreMock {
  fetchIpBlacklist: MockFn;
  deleteIpFromBlacklist: MockFn;
}

interface IpBlacklistTestVm {
  ipBlacklistEnabled: boolean;
  handleUpdateIpBlacklistEnabled: () => Promise<void>;
}

let settingsStoreMock: SettingsStoreMock;
let authStoreMock: AuthStoreMock;

vi.mock('../../stores/settings.store', () => ({
  useSettingsStore: () => settingsStoreMock,
}));

vi.mock('../../stores/auth.store', () => ({
  useAuthStore: () => authStoreMock,
}));

vi.mock('../useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    showConfirmDialog: vi.fn().mockResolvedValue(true),
  }),
}));

const flush = async () => {
  await Promise.resolve();
  await nextTick();
};

describe('useIpBlacklist', () => {
  beforeEach(() => {
    settingsStoreMock = {
      settings: ref({ maxLoginAttempts: '5', loginBanDuration: '300' }),
      ipBlacklistEnabledBoolean: ref(false),
      updateSetting: vi.fn().mockResolvedValue(undefined),
      updateMultipleSettings: vi.fn().mockResolvedValue(undefined),
    };

    authStoreMock = {
      fetchIpBlacklist: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
      deleteIpFromBlacklist: vi.fn().mockResolvedValue(true),
    };
  });

  it('切换黑名单开关时应保存取反后的值', async () => {
    const Comp = defineComponent({
      setup() {
        return useIpBlacklist();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    const vm = wrapper.vm as unknown as IpBlacklistTestVm;

    expect(vm.ipBlacklistEnabled).toBe(false);

    await vm.handleUpdateIpBlacklistEnabled();

    expect(settingsStoreMock.updateSetting).toHaveBeenCalledWith('ipBlacklistEnabled', 'true');
    expect(vm.ipBlacklistEnabled).toBe(true);
  });

  it('保存失败时应回滚开关状态', async () => {
    settingsStoreMock.ipBlacklistEnabledBoolean.value = true;
    settingsStoreMock.updateSetting = vi.fn().mockRejectedValue(new Error('save failed'));

    const Comp = defineComponent({
      setup() {
        return useIpBlacklist();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    const vm = wrapper.vm as unknown as IpBlacklistTestVm;

    expect(vm.ipBlacklistEnabled).toBe(true);

    await vm.handleUpdateIpBlacklistEnabled();

    expect(settingsStoreMock.updateSetting).toHaveBeenCalledWith('ipBlacklistEnabled', 'false');
    expect(vm.ipBlacklistEnabled).toBe(true);
  });
});
