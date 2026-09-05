<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseTable, BaseTextarea } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { securityApi } from '../api/securityApi';
  import type { IpAccessPolicy, IpBlacklistEntry } from '../model/security';

  const { t } = useI18n();
  const feedback = useFeedback();
  const policy = reactive<IpAccessPolicy>({
    whitelist: '',
    blacklistEnabled: true,
    maxLoginAttempts: 5,
    loginBanDuration: 300,
  });
  const entries = ref<IpBlacklistEntry[]>([]);
  const total = ref(0);
  const loading = ref(false);
  const message = ref('');
  const success = ref(false);
  const load = async () => {
    loading.value = true;
    try {
      Object.assign(policy, await securityApi.getIpAccessPolicy());
      const list = await securityApi.listBlockedIps(50, 0);
      entries.value = list.entries;
      total.value = list.total;
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('common.errorOccurred'));
    } finally {
      loading.value = false;
    }
  };
  const saveWhitelist = async () => {
    loading.value = true;
    try {
      await securityApi.updateIpAccessPolicy({ whitelist: policy.whitelist });
      message.value = t('settings.ipWhitelist.success.saved');
      success.value = true;
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.ipWhitelist.error.saveFailed'));
      success.value = false;
    } finally {
      loading.value = false;
    }
  };
  const toggleBlacklist = async (enabled: boolean) => {
    if (loading.value || enabled === policy.blacklistEnabled) return;
    const previous = policy.blacklistEnabled;
    policy.blacklistEnabled = enabled;
    message.value = '';
    loading.value = true;
    try {
      await securityApi.updateIpAccessPolicy({ blacklistEnabled: enabled });
      if (enabled && entries.value.length === 0) {
        const list = await securityApi.listBlockedIps(50, 0);
        entries.value = list.entries;
        total.value = list.total;
      }
    } catch (cause) {
      policy.blacklistEnabled = previous;
      message.value = apiErrorMessage(cause, t('settings.ipBlacklist.error.updateConfigFailed'));
      success.value = false;
    } finally {
      loading.value = false;
    }
  };
  const saveBlacklist = async () => {
    message.value = '';
    success.value = false;
    const maxLoginAttempts = Number(policy.maxLoginAttempts);
    const loginBanDuration = Number(policy.loginBanDuration);
    if (!Number.isInteger(maxLoginAttempts) || maxLoginAttempts <= 0) {
      message.value = t('settings.ipBlacklist.error.invalidMaxAttempts');
      return;
    }
    if (!Number.isInteger(loginBanDuration) || loginBanDuration <= 0) {
      message.value = t('settings.ipBlacklist.error.invalidBanDuration');
      return;
    }
    loading.value = true;
    try {
      await securityApi.updateIpAccessPolicy({ maxLoginAttempts, loginBanDuration });
      policy.maxLoginAttempts = maxLoginAttempts;
      policy.loginBanDuration = loginBanDuration;
      message.value = t('settings.ipBlacklist.success.configUpdated');
      success.value = true;
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.ipBlacklist.error.updateConfigFailed'));
    } finally {
      loading.value = false;
    }
  };
  const remove = async (ip: string) => {
    const confirmed = await feedback.confirm({
      message: t('settings.ipBlacklist.confirmRemoveIp', { ip }),
      destructive: true,
    });
    if (!confirmed) return;
    loading.value = true;
    try {
      await securityApi.removeBlockedIp(ip);
      await load();
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.ipBlacklist.error.deleteFailed'));
      success.value = false;
    } finally {
      loading.value = false;
    }
  };
  onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <section
      data-testid="ip-whitelist-settings"
      class="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
    >
      <h2 class="border-b border-border bg-header/50 px-6 py-4 text-lg font-semibold text-foreground">
        {{ t('settings.ipWhitelist.title') }}
      </h2>
      <div class="p-6">
        <p class="mb-4 text-sm text-text-secondary">{{ t('settings.ipWhitelist.description') }}</p>
        <form class="space-y-4" @submit.prevent="saveWhitelist">
          <BaseFormField :label="t('settings.ipWhitelist.label')" for-id="ipWhitelist">
            <BaseTextarea
              id="ipWhitelist"
              v-model="policy.whitelist"
              data-testid="ip-whitelist-input"
              rows="4"
              :disabled="loading"
            />
            <p class="mt-1 text-xs text-text-secondary">{{ t('settings.ipWhitelist.hint') }}</p>
          </BaseFormField>
          <div class="flex items-center justify-between gap-4">
            <BaseButton data-testid="ip-whitelist-save" type="submit" variant="primary" :loading="loading">{{
              t('common.save')
            }}</BaseButton>
            <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm">{{ message }}</p>
          </div>
        </form>
      </div>
    </section>

    <section
      data-testid="ip-blacklist-settings"
      class="overflow-hidden rounded-lg border border-border bg-background shadow-sm"
    >
      <div class="flex items-center justify-between border-b border-border bg-header/50 px-6 py-4">
        <h2 class="text-lg font-semibold text-foreground">{{ t('settings.ipBlacklist.title') }}</h2>
        <label class="flex items-center gap-2 text-sm">
          <BaseCheckbox
            :model-value="policy.blacklistEnabled"
            data-testid="ip-blacklist-toggle"
            :disabled="loading"
            role="switch"
            :aria-checked="String(policy.blacklistEnabled)"
            @update:model-value="toggleBlacklist"
          />
          <span>{{ policy.blacklistEnabled ? t('common.enabled') : t('common.disabled') }}</span>
        </label>
      </div>
      <div class="space-y-6 p-6">
        <template v-if="policy.blacklistEnabled">
          <p class="text-sm text-text-secondary">{{ t('settings.ipBlacklist.description') }}</p>
          <form class="flex flex-wrap items-end gap-4" @submit.prevent="saveBlacklist">
            <BaseFormField
              :label="t('settings.ipBlacklist.maxAttemptsLabel')"
              for-id="maxLoginAttempts"
              class="min-w-[150px] flex-1"
            >
              <BaseInput
                id="maxLoginAttempts"
                v-model="policy.maxLoginAttempts"
                data-testid="ip-blacklist-max-attempts"
                type="number"
                min="1"
                :disabled="loading"
              />
            </BaseFormField>
            <BaseFormField
              :label="t('settings.ipBlacklist.banDurationLabel')"
              for-id="loginBanDuration"
              class="min-w-[150px] flex-1"
            >
              <BaseInput
                id="loginBanDuration"
                v-model="policy.loginBanDuration"
                data-testid="ip-blacklist-ban-duration"
                type="number"
                min="1"
                :disabled="loading"
              />
            </BaseFormField>
            <BaseButton data-testid="ip-blacklist-save" type="submit" variant="primary" :loading="loading">{{
              t('common.save')
            }}</BaseButton>
          </form>
          <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm">{{ message }}</p>
          <hr class="border-border/50" />
          <h3 class="text-base font-semibold text-foreground">{{ t('settings.ipBlacklist.currentBannedTitle') }}</h3>
          <BaseTable :empty="entries.length === 0" :empty-text="t('settings.ipBlacklist.noBannedIps')">
            <template #head>
              <tr>
                <th class="px-4 py-2 text-left font-medium text-text-secondary">IP</th>
                <th class="px-4 py-2 text-left font-medium text-text-secondary">
                  {{ t('settings.ipBlacklist.table.attempts') }}
                </th>
                <th class="px-4 py-2 text-left font-medium text-text-secondary">
                  {{ t('settings.ipBlacklist.table.lastAttempt') }}
                </th>
                <th class="px-4 py-2 text-left font-medium text-text-secondary">
                  {{ t('settings.ipBlacklist.table.bannedUntil') }}
                </th>
                <th class="px-4 py-2 text-left font-medium text-text-secondary">
                  {{ t('settings.ipBlacklist.table.actions') }}
                </th>
              </tr>
            </template>
            <tr v-for="entry in entries" :key="entry.ip" class="hover:bg-header/50">
              <td class="px-4 py-2 font-mono">{{ entry.ip }}</td>
              <td class="px-4 py-2">{{ entry.attempts }}</td>
              <td class="px-4 py-2">{{ new Date(entry.lastAttemptAt * 1000).toLocaleString() }}</td>
              <td class="px-4 py-2">
                {{ entry.blockedUntil ? new Date(entry.blockedUntil * 1000).toLocaleString() : '—' }}
              </td>
              <td class="px-4 py-2">
                <BaseButton size="sm" variant="danger" @click="remove(entry.ip)">{{ t('common.remove') }}</BaseButton>
              </td>
            </tr>
          </BaseTable>
        </template>
        <div v-else class="rounded-md border border-dashed border-border/50 p-4 text-center text-text-secondary italic">
          {{ t('common.disabled') }}
        </div>
      </div>
    </section>
  </div>
</template>
