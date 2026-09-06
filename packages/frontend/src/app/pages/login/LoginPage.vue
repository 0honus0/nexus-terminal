<script setup lang="ts">
  import { onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import LoginView from '@/features/auth/views/LoginView.vue';
  import { useAuthSession } from '@/features/auth/public';
  import { LoginCaptchaChallenge, useLoginSecurity } from '@/features/security/public';

  const router = useRouter();
  const { t } = useI18n();
  const auth = useAuthSession();
  const security = useLoginSecurity();
  const captchaToken = ref<string | null>(null);
  const captchaFeedback = ref<string | null>(null);
  const captchaChallenge = ref<{ reset: () => void } | null>(null);
  const passkeyError = ref('');
  onMounted(() => security.refresh());
  const handleLoginAttempted = () => {
    passkeyError.value = '';
    captchaFeedback.value = null;
  };
  const handleCaptchaToken = (token: string | null) => {
    captchaToken.value = token;
    if (token) captchaFeedback.value = null;
  };
  const loginWithPasskey = async (username: string) => {
    passkeyError.value = '';
    captchaFeedback.value = null;
    try {
      await security.loginWithPasskey(username || undefined);
      await auth.refreshSession();
      await router.push({ name: 'Dashboard' });
    } catch (cause) {
      passkeyError.value = apiErrorMessage(cause, t('auth.login.error.passkeyAuthFailed'));
    }
  };
</script>
<template>
  <LoginView
    :captcha-required="security.captchaConfig.value.enabled"
    :captcha-token="captchaToken"
    :captcha-status="security.captchaStatus.value"
    :passkey-available="security.hasPasskeys.value"
    :passkey-loading="security.loading.value"
    @passkey="loginWithPasskey"
    @login-attempted="handleLoginAttempted"
    @security-challenge-feedback="captchaFeedback = $event"
    @security-challenge-consumed="captchaChallenge?.reset()"
  >
    <template #security>
      <LoginCaptchaChallenge
        ref="captchaChallenge"
        :config="security.captchaConfig.value"
        :status="security.captchaStatus.value"
        :feedback="captchaFeedback"
        @token="handleCaptchaToken"
      />
      <p v-if="passkeyError" class="mt-2 text-center text-sm text-error" role="alert">{{ passkeyError }}</p>
    </template>
  </LoginView>
</template>
