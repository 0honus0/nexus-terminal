/**
 * 设置 Store - 安全设置子模块
 * 职责：IP 白名单/黑名单、登录安全等安全相关设置的计算属性
 */
import { computed } from 'vue';

/** 安全设置子模块的依赖参数 */
export interface SecuritySettingsDeps {
  settings: { value: Record<string, string | undefined> };
}

/**
 * 创建安全设置子 Store 的计算属性
 */
export function createSecuritySettingsGetters(deps: SecuritySettingsDeps) {
  const { settings } = deps;

  /** IP 白名单启用状态 */
  const ipWhitelistEnabled = computed(() => settings.value?.ipWhitelistEnabled === 'true');

  /** IP 黑名单启用状态（默认启用） */
  const ipBlacklistEnabledBoolean = computed(() => {
    return settings.value?.ipBlacklistEnabled !== 'false';
  });

  /** 最大登录尝试次数 */
  const maxLoginAttempts = computed(() => {
    const val = parseInt(settings.value?.maxLoginAttempts || '5', 10);
    return Number.isNaN(val) || val <= 0 ? 5 : val;
  });

  /** 登录封禁时长（秒） */
  const loginBanDuration = computed(() => {
    const val = parseInt(settings.value?.loginBanDuration || '300', 10);
    return Number.isNaN(val) || val <= 0 ? 300 : val;
  });

  return {
    ipWhitelistEnabled,
    ipBlacklistEnabledBoolean,
    maxLoginAttempts,
    loginBanDuration,
  };
}

export type SecuritySettingsGetters = ReturnType<typeof createSecuritySettingsGetters>;
