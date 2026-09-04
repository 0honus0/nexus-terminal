<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput, BaseSelect } from '@/foundation/ui';
  import { securityApi } from '../api/securityApi';
  import type { CaptchaConfigUpdate } from '../model/security';

  const { t } = useI18n();
  const form = reactive<CaptchaConfigUpdate>({
    enabled: false,
    provider: 'none',
    hcaptchaSiteKey: '',
    recaptchaSiteKey: '',
    hcaptchaSecretKey: '',
    recaptchaSecretKey: '',
  });
  const loading = ref(false);
  const message = ref('');
  const success = ref(false);
  const load = async () => {
    loading.value = true;
    try {
      Object.assign(form, await securityApi.getCaptchaConfig(), { hcaptchaSecretKey: '', recaptchaSecretKey: '' });
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.captcha.error.loadFailed'));
    } finally {
      loading.value = false;
    }
  };
  const save = async () => {
    loading.value = true;
    message.value = '';
    success.value = false;
    try {
      await securityApi.updateCaptchaConfig({
        ...form,
        hcaptchaSecretKey: form.hcaptchaSecretKey || undefined,
        recaptchaSecretKey: form.recaptchaSecretKey || undefined,
      });
      form.hcaptchaSecretKey = '';
      form.recaptchaSecretKey = '';
      message.value = t('settings.captcha.success.saved');
      success.value = true;
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.captcha.error.saveFailed'));
    } finally {
      loading.value = false;
    }
  };
  onMounted(load);
</script>

<template>
  <section data-testid="captcha-settings" class="space-y-4">
    <h3 class="text-base font-semibold text-foreground">{{ t('settings.captcha.title') }}</h3>
    <form class="max-w-2xl space-y-4" @submit.prevent="save">
      <label class="flex items-center gap-2 text-sm"
        ><BaseCheckbox id="captchaEnabled" v-model="form.enabled" data-testid="captcha-enabled" /><span>{{
          t('settings.captcha.enableLabel')
        }}</span></label
      >
      <BaseFormField :label="t('settings.captcha.providerLabel')" for-id="captchaProvider">
        <BaseSelect id="captchaProvider" v-model="form.provider" data-testid="captcha-provider"
          ><option value="none">{{ t('settings.captcha.providerNone') }}</option>
          <option value="hcaptcha">hCaptcha</option>
          <option value="recaptcha">reCAPTCHA</option></BaseSelect
        >
      </BaseFormField>
      <template v-if="form.provider === 'hcaptcha'">
        <BaseFormField :label="t('settings.captcha.siteKeyLabel')" for-id="hcaptchaSiteKey"
          ><BaseInput id="hcaptchaSiteKey" v-model="form.hcaptchaSiteKey"
        /></BaseFormField>
        <BaseFormField :label="t('settings.captcha.secretKeyLabel')" for-id="hcaptchaSecretKey"
          ><BaseInput id="hcaptchaSecretKey" v-model="form.hcaptchaSecretKey" type="password"
        /></BaseFormField>
      </template>
      <template v-if="form.provider === 'recaptcha'">
        <BaseFormField :label="t('settings.captcha.siteKeyLabel')" for-id="recaptchaSiteKey"
          ><BaseInput id="recaptchaSiteKey" v-model="form.recaptchaSiteKey"
        /></BaseFormField>
        <BaseFormField :label="t('settings.captcha.secretKeyLabel')" for-id="recaptchaSecretKey"
          ><BaseInput id="recaptchaSecretKey" v-model="form.recaptchaSecretKey" type="password"
        /></BaseFormField>
      </template>
      <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm">{{ message }}</p>
      <BaseButton data-testid="captcha-save" type="submit" variant="primary" :loading="loading">{{
        t('common.save')
      }}</BaseButton>
    </form>
  </section>
</template>
