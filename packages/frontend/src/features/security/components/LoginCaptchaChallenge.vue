<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import VueHcaptcha from '@hcaptcha/vue3-hcaptcha';
  import VueRecaptcha from 'vue3-recaptcha2';
  import type { CaptchaConfig } from '../model/security';

  const props = defineProps<{ config: CaptchaConfig }>();
  const emit = defineEmits<{ token: [value: string | null] }>();
  const { t } = useI18n();
  const error = ref('');
  const hcaptcha = ref<InstanceType<typeof VueHcaptcha> | null>(null);
  const recaptcha = ref<{ reset?: () => void } | null>(null);
  const verified = (token: string) => {
    error.value = '';
    emit('token', token);
  };
  const expired = () => emit('token', null);
  const failed = () => {
    emit('token', null);
    error.value = t('auth.login.error.captchaLoadFailed');
  };
  defineExpose({
    reset: () => {
      emit('token', null);
      hcaptcha.value?.reset();
      recaptcha.value?.reset?.();
    },
  });
</script>
<template>
  <div v-if="config.enabled" class="space-y-2">
    <p class="text-sm font-medium text-text-secondary">{{ t('auth.login.captchaPrompt') }}</p>
    <VueHcaptcha
      v-if="config.provider === 'hcaptcha' && config.hcaptchaSiteKey"
      ref="hcaptcha"
      :sitekey="config.hcaptchaSiteKey"
      theme="auto"
      @verify="verified"
      @expired="expired"
      @error="failed"
    />
    <VueRecaptcha
      v-else-if="config.provider === 'recaptcha' && config.recaptchaSiteKey"
      ref="recaptcha"
      :sitekey="config.recaptchaSiteKey"
      theme="light"
      @verify="verified"
      @expire="expired"
      @fail="failed"
    />
    <p v-if="error" class="text-sm text-error">{{ error }}</p>
  </div>
</template>
