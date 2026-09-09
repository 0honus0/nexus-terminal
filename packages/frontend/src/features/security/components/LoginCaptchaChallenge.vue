<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import VueHcaptcha from '@hcaptcha/vue3-hcaptcha';
  import VueRecaptcha from 'vue3-recaptcha2';
  import type { CaptchaConfig } from '../model/security';

  type CaptchaStatus = 'loading' | 'ready' | 'error' | 'invalid';

  const props = withDefaults(
    defineProps<{
      config: CaptchaConfig;
      status?: CaptchaStatus;
      feedback?: string | null;
    }>(),
    { status: 'ready', feedback: null },
  );
  const emit = defineEmits<{ token: [value: string | null] }>();
  const { t } = useI18n();
  const error = ref('');
  const hcaptcha = ref<InstanceType<typeof VueHcaptcha> | null>(null);
  const recaptcha = ref<{ reset?: () => void } | null>(null);
  const displayedError = computed(() => props.feedback || error.value);
  const verified = (token: string) => {
    error.value = '';
    emit('token', token);
  };
  const expired = () => emit('token', null);
  const failed = () => {
    emit('token', null);
    error.value = t('auth.login.error.captchaLoadFailed');
  };
  watch(
    () => props.status,
    (status) => {
      if (status !== 'ready') {
        emit('token', null);
        error.value = '';
      }
    },
  );
  defineExpose({
    reset: () => {
      emit('token', null);
      error.value = '';
      hcaptcha.value?.reset();
      recaptcha.value?.reset?.();
    },
  });
</script>
<template>
  <div v-if="props.status !== 'ready' || config.enabled" class="space-y-2">
    <p v-if="props.status === 'loading'" class="text-sm text-text-secondary" role="status">
      {{ t('auth.login.error.captchaLoading') }}
    </p>
    <p v-else-if="props.status === 'error'" class="text-sm text-error" role="alert">
      {{ t('auth.login.error.captchaLoadFailed') }}
    </p>
    <p v-else-if="props.status === 'invalid'" class="text-sm text-error" role="alert">
      {{ t('auth.login.error.captchaConfigInvalid') }}
    </p>
    <template v-else>
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
      <p v-if="displayedError" class="text-sm text-error" role="alert">{{ displayedError }}</p>
    </template>
  </div>
</template>
