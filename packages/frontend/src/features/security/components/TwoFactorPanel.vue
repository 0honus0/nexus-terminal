<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseFormField, BaseInput } from '@/foundation/ui';
  import { securityApi } from '../api/securityApi';
  import type { TwoFactorSetup } from '../model/security';

  const props = defineProps<{ enabled: boolean }>();
  const emit = defineEmits<{ changed: [] }>();
  const { t } = useI18n();
  const setup = ref<TwoFactorSetup | null>(null);
  const verificationCode = ref('');
  const disablePassword = ref('');
  const loading = ref(false);
  const message = ref('');
  const success = ref(false);
  const begin = async () => {
    loading.value = true;
    message.value = '';
    success.value = false;
    try {
      setup.value = await securityApi.beginTwoFactorSetup();
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.twoFactor.error.setupFailed'));
    } finally {
      loading.value = false;
    }
  };
  const activate = async () => {
    if (!verificationCode.value) {
      message.value = t('settings.twoFactor.error.codeRequired');
      return;
    }
    loading.value = true;
    message.value = '';
    success.value = false;
    try {
      await securityApi.activateTwoFactor(verificationCode.value);
      emit('changed');
      setup.value = null;
      verificationCode.value = '';
      message.value = t('settings.twoFactor.success.activated');
      success.value = true;
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.twoFactor.error.verificationFailed'));
    } finally {
      loading.value = false;
    }
  };
  const disable = async () => {
    if (!disablePassword.value) {
      message.value = t('settings.twoFactor.error.passwordRequiredForDisable');
      return;
    }
    loading.value = true;
    message.value = '';
    success.value = false;
    try {
      await securityApi.disableTwoFactor(disablePassword.value);
      emit('changed');
      disablePassword.value = '';
      message.value = t('settings.twoFactor.success.disabled');
      success.value = true;
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.twoFactor.error.disableFailed'));
    } finally {
      loading.value = false;
    }
  };
</script>

<template>
  <section class="space-y-4">
    <h3 class="text-base font-semibold text-foreground">{{ t('settings.twoFactor.title') }}</h3>
    <template v-if="props.enabled">
      <form class="max-w-xl space-y-3" @submit.prevent="disable">
        <BaseFormField :label="t('settings.twoFactor.disable.passwordPrompt')" for-id="disablePassword">
          <BaseInput id="disablePassword" v-model="disablePassword" type="password" autocomplete="current-password" />
        </BaseFormField>
        <BaseButton type="submit" variant="danger" :loading="loading">{{
          t('settings.twoFactor.disable.button')
        }}</BaseButton>
      </form>
    </template>
    <template v-else-if="setup">
      <div class="max-w-xl space-y-4 rounded-lg border border-border p-4">
        <img :src="setup.qrCodeUrl" :alt="t('settings.twoFactor.qrCodeAlt')" class="h-48 w-48 bg-white p-2" />
        <code class="block break-all rounded bg-header p-2 text-sm">{{ setup.secret }}</code>
        <form class="space-y-3" @submit.prevent="activate">
          <BaseFormField :label="t('settings.twoFactor.setup.enterCode')" for-id="verificationCode">
            <BaseInput
              id="verificationCode"
              v-model="verificationCode"
              inputmode="numeric"
              pattern="[0-9]{6}"
              autocomplete="one-time-code"
            />
          </BaseFormField>
          <div class="flex gap-2">
            <BaseButton type="submit" variant="primary" :loading="loading">{{
              t('settings.twoFactor.setup.verifyButton')
            }}</BaseButton>
            <BaseButton @click="setup = null">{{ t('common.cancel') }}</BaseButton>
          </div>
        </form>
      </div>
    </template>
    <BaseButton v-else variant="primary" :loading="loading" @click="begin">{{
      t('settings.twoFactor.enable.button')
    }}</BaseButton>
    <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm" role="status">{{ message }}</p>
  </section>
</template>
