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
  <section>
    <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.passkey.title') }}</h3>
    <p class="mb-4 text-sm text-text-secondary">{{ t('settings.passkey.description') }}</p>
    <BaseButton variant="primary" :loading="loading" @click="register">{{
      t('settings.passkey.registerNewButton')
    }}</BaseButton>
    <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="mt-3 text-sm" role="status">
      {{ message }}
    </p>

    <div class="mt-6">
      <h4 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.passkey.registeredKeysTitle') }}</h4>
      <div v-if="loading && passkeys.length === 0" class="p-4 text-center text-text-secondary italic">
        {{ t('common.loading') }}
      </div>
      <ul v-else-if="passkeys.length" class="space-y-3">
        <li
          v-for="key in passkeys"
          :key="key.credentialId"
          class="flex flex-col items-start justify-between rounded-md border border-border bg-header/20 p-3 transition-colors duration-150 hover:bg-header/40 sm:flex-row sm:items-center"
        >
          <div class="mb-2 flex-grow sm:mb-0">
            <div class="flex items-center">
              <template v-if="editing !== key.credentialId">
                <span class="block text-sm font-medium text-foreground">
                  {{ key.name || t('settings.passkey.unnamedKey') }}
                  <span class="ml-1 text-xs text-text-secondary">(ID: ...{{ key.credentialId.slice(-8) }})</span>
                </span>
                <button
                  type="button"
                  class="ml-2 p-1 text-text-secondary transition hover:text-foreground"
                  :title="t('common.edit')"
                  @click="editing = key.credentialId"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                    aria-hidden="true"
                  >
                    <path
                      d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"
                    />
                    <path
                      fill-rule="evenodd"
                      d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"
                    />
                  </svg>
                </button>
              </template>
              <div v-else class="flex flex-grow items-center">
                <BaseInput
                  v-model="names[key.credentialId]"
                  class="!w-48"
                  :placeholder="t('settings.passkey.namePlaceholder')"
                  @keyup.enter="saveName(key)"
                  @keyup.esc="editing = null"
                />
                <BaseButton class="ml-2" size="sm" variant="primary" :disabled="loading" @click="saveName(key)">{{
                  t('common.save')
                }}</BaseButton>
                <BaseButton class="ml-1" size="sm" :disabled="loading" @click="editing = null">{{
                  t('common.cancel')
                }}</BaseButton>
              </div>
            </div>
            <div class="mt-1 space-x-2 text-xs text-text-secondary">
              <span>{{ t('settings.passkey.createdDate') }}: {{ formatDate(key.createdAt) }}</span>
              <span v-if="key.lastUsedAt"
                >{{ t('settings.passkey.lastUsedDate') }}: {{ formatDate(key.lastUsedAt) }}</span
              >
              <span v-if="key.transports?.length" class="capitalize">({{ key.transports.join(', ') }})</span>
            </div>
          </div>
          <BaseButton
            size="sm"
            variant="danger"
            class="self-start sm:self-center"
            :disabled="loading || editing === key.credentialId"
            @click="remove(key)"
            >{{ t('common.delete') }}</BaseButton
          >
        </li>
      </ul>
      <p v-else class="text-sm text-text-secondary italic">{{ t('settings.passkey.noKeysRegistered') }}</p>
    </div>
  </section>
</template>
