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
  <div class="space-y-8">
    <section data-testid="ip-whitelist-settings" class="space-y-4">
      <h3 class="text-base font-semibold">{{ t('settings.ipWhitelist.title') }}</h3>
      <form class="max-w-2xl space-y-3" @submit.prevent="saveWhitelist">
        <BaseFormField :label="t('settings.ipWhitelist.label')" for-id="ipWhitelist"
          ><BaseTextarea
            id="ipWhitelist"
            v-model="policy.whitelist"
            data-testid="ip-whitelist-input"
            rows="4"
            :disabled="loading"
        /></BaseFormField>
        <BaseButton data-testid="ip-whitelist-save" type="submit" variant="primary" :loading="loading">{{
          t('common.save')
        }}</BaseButton>
      </form>
    </section>

    <section data-testid="ip-blacklist-settings" class="space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-base font-semibold">{{ t('settings.ipBlacklist.title') }}</h3>
        <label class="flex items-center gap-2 text-sm"
          ><BaseCheckbox
            :model-value="policy.blacklistEnabled"
            data-testid="ip-blacklist-toggle"
            :disabled="loading"
            role="switch"
            :aria-checked="String(policy.blacklistEnabled)"
            @update:model-value="toggleBlacklist"
          /><span>{{ policy.blacklistEnabled ? t('common.enabled') : t('common.disabled') }}</span></label
        >
      </div>
      <div v-if="policy.blacklistEnabled" class="space-y-4">
        <form class="flex flex-wrap items-end gap-4" @submit.prevent="saveBlacklist">
          <BaseFormField :label="t('settings.ipBlacklist.maxAttemptsLabel')" for-id="maxLoginAttempts"
            ><BaseInput
              id="maxLoginAttempts"
              v-model="policy.maxLoginAttempts"
              data-testid="ip-blacklist-max-attempts"
              type="number"
              min="1"
              :disabled="loading"
          /></BaseFormField>
          <BaseFormField :label="t('settings.ipBlacklist.banDurationLabel')" for-id="loginBanDuration"
            ><BaseInput
              id="loginBanDuration"
              v-model="policy.loginBanDuration"
              data-testid="ip-blacklist-ban-duration"
              type="number"
              min="1"
              :disabled="loading"
          /></BaseFormField>
          <BaseButton data-testid="ip-blacklist-save" type="submit" variant="primary" :loading="loading">{{
            t('common.save')
          }}</BaseButton>
        </form>
        <h4 class="font-medium">
          {{ t('settings.ipBlacklist.currentBannedTitle') }} <span class="text-text-secondary">({{ total }})</span>
        </h4>
        <BaseTable :empty="entries.length === 0" :empty-text="t('settings.ipBlacklist.noBannedIps')"
          ><template #head
            ><tr>
              <th class="px-3 py-2">IP</th>
              <th class="px-3 py-2">{{ t('settings.ipBlacklist.table.attempts') }}</th>
              <th class="px-3 py-2">{{ t('settings.ipBlacklist.table.lastAttempt') }}</th>
              <th class="px-3 py-2">{{ t('settings.ipBlacklist.table.bannedUntil') }}</th>
              <th></th></tr
          ></template>
          <tr v-for="entry in entries" :key="entry.ip">
            <td class="px-3 py-2 font-mono">{{ entry.ip }}</td>
            <td class="px-3 py-2">{{ entry.attempts }}</td>
            <td class="px-3 py-2">{{ new Date(entry.lastAttemptAt * 1000).toLocaleString() }}</td>
            <td class="px-3 py-2">
              {{ entry.blockedUntil ? new Date(entry.blockedUntil * 1000).toLocaleString() : '—' }}
            </td>
            <td class="px-3 py-2 text-right">
              <BaseButton size="sm" variant="danger" @click="remove(entry.ip)">{{ t('common.remove') }}</BaseButton>
            </td>
          </tr></BaseTable
        >
      </div>
      <p v-else class="rounded border border-dashed border-border/70 p-4 text-center text-sm text-text-secondary">
        {{ t('common.disabled') }}
      </p>
    </section>
    <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm">{{ message }}</p>
  </div>
</template>
