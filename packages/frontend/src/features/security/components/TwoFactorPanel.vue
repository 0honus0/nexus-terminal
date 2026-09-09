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
  <section>
    <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.twoFactor.title') }}</h3>
    <div v-if="props.enabled">
      <p class="mb-3 rounded border-l-4 border-success bg-success/10 p-3 text-sm text-success">
        {{ t('settings.twoFactor.status.enabled') }}
      </p>
      <form class="space-y-4" @submit.prevent="disable">
        <BaseFormField :label="t('settings.twoFactor.disable.passwordPrompt')" for-id="disablePassword">
          <BaseInput id="disablePassword" v-model="disablePassword" type="password" autocomplete="current-password" />
        </BaseFormField>
        <BaseButton type="submit" variant="danger" :loading="loading">{{
          t('settings.twoFactor.disable.button')
        }}</BaseButton>
      </form>
    </div>
    <div v-else>
      <p class="mb-4 text-sm text-text-secondary">{{ t('settings.twoFactor.status.disabled') }}</p>
      <BaseButton v-if="!setup" variant="primary" :loading="loading" @click="begin">{{
        t('settings.twoFactor.enable.button')
      }}</BaseButton>
      <div v-else class="mt-4 space-y-4 rounded-md border border-border bg-header/30 p-4">
        <p class="text-sm text-text-secondary">{{ t('settings.twoFactor.setup.scanQrCode') }}</p>
        <img
          :src="setup.qrCodeUrl"
          :alt="t('settings.twoFactor.qrCodeAlt')"
          class="mx-auto block max-w-[180px] rounded border border-border bg-white p-1"
        />
        <p class="text-sm text-text-secondary">
          {{ t('settings.twoFactor.setup.orEnterSecret') }}
          <code class="rounded border border-border/50 bg-header/50 px-2 py-1 font-mono text-sm">{{
            setup.secret
          }}</code>
        </p>
        <form class="space-y-4" @submit.prevent="activate">
          <BaseFormField :label="t('settings.twoFactor.setup.enterCode')" for-id="verificationCode">
            <BaseInput
              id="verificationCode"
              v-model="verificationCode"
              inputmode="numeric"
              pattern="[0-9]{6}"
              autocomplete="one-time-code"
            />
          </BaseFormField>
          <div class="flex items-center gap-3">
            <BaseButton type="submit" variant="primary" :loading="loading">{{
              t('settings.twoFactor.setup.verifyButton')
            }}</BaseButton>
            <BaseButton type="button" :disabled="loading" @click="setup = null">{{ t('common.cancel') }}</BaseButton>
          </div>
        </form>
      </div>
    </div>
    <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="mt-3 text-sm" role="status">
      {{ message }}
    </p>
  </section>
</template>
