<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue';
  import { startRegistration } from '@simplewebauthn/browser';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseInput, BaseTable } from '@/foundation/ui';
  import { securityApi } from '../api/securityApi';
  import type { PasskeySummary } from '../model/security';

  const { t } = useI18n();
  const passkeys = ref<PasskeySummary[]>([]);
  const loading = ref(false);
  const message = ref('');
  const success = ref(false);
  const editing = ref<string | null>(null);
  const names = reactive<Record<string, string>>({});

  const load = async () => {
    loading.value = true;
    try {
      passkeys.value = await securityApi.listPasskeys();
      for (const key of passkeys.value) names[key.credentialId] = key.name ?? '';
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.passkey.error.fetchFailed'));
    } finally {
      loading.value = false;
    }
  };
  const register = async () => {
    loading.value = true;
    message.value = '';
    success.value = false;
    try {
      const optionsJSON = await securityApi.getPasskeyRegistrationOptions();
      const registrationResponse = await startRegistration({ optionsJSON });
      await securityApi.registerPasskey(registrationResponse);
      message.value = t('settings.passkey.success.registered');
      success.value = true;
      await load();
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.passkey.error.registrationFailed'));
    } finally {
      loading.value = false;
    }
  };
  const saveName = async (key: PasskeySummary) => {
    const name = names[key.credentialId]?.trim();
    if (!name) {
      message.value = t('settings.passkey.error.nameRequired');
      return;
    }
    loading.value = true;
    try {
      await securityApi.renamePasskey(key.credentialId, name);
      editing.value = null;
      message.value = t('settings.passkey.success.nameUpdated');
      success.value = true;
      await load();
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.passkey.error.nameUpdateFailed'));
      success.value = false;
    } finally {
      loading.value = false;
    }
  };
  const remove = async (key: PasskeySummary) => {
    loading.value = true;
    message.value = '';
    success.value = false;
    try {
      await securityApi.deletePasskey(key.credentialId);
      message.value = t('settings.passkey.success.deleted');
      success.value = true;
      await load();
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.passkey.error.deleteFailedGeneral'));
    } finally {
      loading.value = false;
    }
  };
  const formatDate = (value: number | null) => (value ? new Date(value * 1000).toLocaleString() : '—');
  onMounted(load);
</script>

<template>
  <section class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-base font-semibold text-foreground">{{ t('settings.passkey.title') }}</h3>
      <BaseButton variant="primary" :loading="loading" @click="register">{{
        t('settings.passkey.registerNewButton')
      }}</BaseButton>
    </div>
    <BaseTable :empty="!loading && passkeys.length === 0" :empty-text="t('settings.passkey.noKeysRegistered')">
      <template #head
        ><tr>
          <th class="px-3 py-2">{{ t('settings.passkey.nameLabel') }}</th>
          <th class="px-3 py-2">{{ t('settings.passkey.createdDate') }}</th>
          <th class="px-3 py-2">{{ t('settings.passkey.lastUsedDate') }}</th>
          <th class="px-3 py-2"></th></tr
      ></template>
      <tr v-for="key in passkeys" :key="key.credentialId">
        <td class="px-3 py-2">
          <BaseInput
            v-if="editing === key.credentialId"
            v-model="names[key.credentialId]"
            :placeholder="t('settings.passkey.namePlaceholder')"
          />
          <span v-else>{{ key.name || key.credentialId.slice(0, 18) }}</span>
        </td>
        <td class="px-3 py-2 text-text-secondary">{{ formatDate(key.createdAt) }}</td>
        <td class="px-3 py-2 text-text-secondary">{{ formatDate(key.lastUsedAt) }}</td>
        <td class="px-3 py-2">
          <div class="flex justify-end gap-2">
            <BaseButton v-if="editing === key.credentialId" size="sm" variant="primary" @click="saveName(key)">{{
              t('common.save')
            }}</BaseButton
            ><BaseButton v-else size="sm" @click="editing = key.credentialId">{{ t('common.edit') }}</BaseButton
            ><BaseButton size="sm" variant="danger" @click="remove(key)">{{ t('common.delete') }}</BaseButton>
          </div>
        </td>
      </tr>
    </BaseTable>
    <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm" role="status">{{ message }}</p>
  </section>
</template>
