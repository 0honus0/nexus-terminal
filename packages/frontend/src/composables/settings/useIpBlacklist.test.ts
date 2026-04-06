import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

import { useIpBlacklist } from './useIpBlacklist';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<any>('pinia');
  return {
    ...actual,
    storeToRefs: (store: any) => store,
  };
});

let settingsStoreMock: any;
let authStoreMock: any;

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

    expect((wrapper.vm as any).ipBlacklistEnabled).toBe(false);

    await (wrapper.vm as any).handleUpdateIpBlacklistEnabled();

    expect(settingsStoreMock.updateSetting).toHaveBeenCalledWith('ipBlacklistEnabled', 'true');
    expect((wrapper.vm as any).ipBlacklistEnabled).toBe(true);
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

    expect((wrapper.vm as any).ipBlacklistEnabled).toBe(true);

    await (wrapper.vm as any).handleUpdateIpBlacklistEnabled();

    expect(settingsStoreMock.updateSetting).toHaveBeenCalledWith('ipBlacklistEnabled', 'false');
    expect((wrapper.vm as any).ipBlacklistEnabled).toBe(true);
  });
});
