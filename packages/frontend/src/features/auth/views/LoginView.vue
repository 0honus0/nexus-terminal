<script setup lang="ts">
  import { reactive, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseCheckbox, BaseFormField, BaseInput } from '@/foundation/ui';
  import { useAuthSession } from '../public';

  const props = withDefaults(
    defineProps<{ captchaRequired?: boolean; captchaToken?: string | null; passkeyAvailable?: boolean }>(),
    { captchaRequired: false, captchaToken: null, passkeyAvailable: false },
  );
  const emit = defineEmits<{ passkey: [username: string]; securityChallengeConsumed: [] }>();

  const router = useRouter();
  const { t } = useI18n();
  const auth = useAuthSession();

  const credentials = reactive({ username: '', password: '' });
  const rememberMe = ref(false);
  const twoFactorToken = ref('');
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const submit = async (): Promise<void> => {
    error.value = null;
    isLoading.value = true;

    try {
      if (auth.pendingSecondFactor.value) {
        await auth.verifyTwoFactor(twoFactorToken.value);
        await router.push({ name: 'Dashboard' });
        return;
      }

      if (props.captchaRequired && !props.captchaToken) {
        error.value = t('auth.login.error.captchaRequired');
        return;
      }
      try {
        const result = await auth.login({
          username: credentials.username,
          password: credentials.password,
          rememberMe: rememberMe.value,
          captchaToken: props.captchaToken ?? undefined,
        });

        if (result.status === 'authenticated') await router.push({ name: 'Dashboard' });
      } finally {
        if (props.captchaRequired) emit('securityChallengeConsumed');
      }
    } catch (cause) {
      error.value = apiErrorMessage(
        cause,
        t(auth.pendingSecondFactor.value ? 'auth.login.error.twoFactorGeneric' : 'auth.login.error.generic'),
      );
    } finally {
      isLoading.value = false;
    }
  };
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="flex w-full max-w-4xl overflow-hidden rounded-xl border border-border/40 bg-background shadow-2xl">
      <section
        class="hidden w-2/5 flex-col items-center justify-center bg-gradient-to-br from-primary to-link p-10 text-white md:flex"
      >
        <img src="@/assets/logo.png" :alt="t('projectName')" class="mb-5 h-20 w-auto" />
        <h1 class="mb-2 text-3xl font-bold">{{ t('projectName') }}</h1>
        <p class="text-center text-base opacity-80">{{ t('slogan') }}</p>
      </section>

      <section class="flex w-full flex-col justify-center p-8 sm:p-12 md:w-3/5">
        <div class="mb-6 flex justify-center md:hidden">
          <img src="@/assets/logo.png" :alt="t('projectName')" class="h-16 w-auto" />
        </div>

        <h2 class="mb-6 text-center text-2xl font-semibold text-foreground">{{ t('auth.login.title') }}</h2>

        <form class="space-y-5" @submit.prevent="submit">
          <template v-if="!auth.pendingSecondFactor.value">
            <BaseFormField :label="t('auth.login.username')" for-id="username" required>
              <BaseInput
                id="username"
                v-model="credentials.username"
                name="username"
                autocomplete="username"
                required
                size="lg"
                :disabled="isLoading"
              />
            </BaseFormField>

            <BaseFormField :label="t('auth.login.password')" for-id="password" required>
              <BaseInput
                id="password"
                v-model="credentials.password"
                name="password"
                type="password"
                autocomplete="current-password"
                required
                size="lg"
                :disabled="isLoading"
              />
            </BaseFormField>

            <label class="flex cursor-pointer items-center gap-2 text-sm text-text-secondary" for="rememberMe">
              <BaseCheckbox id="rememberMe" v-model="rememberMe" :disabled="isLoading" />
              <span>{{ t('auth.login.rememberMe') }}</span>
            </label>
          </template>

          <BaseFormField v-else :label="t('auth.login.twoFactorPrompt')" for-id="twoFactorToken" required>
            <BaseInput
              id="twoFactorToken"
              v-model="twoFactorToken"
              name="twoFactorToken"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9]{6}"
              required
              size="lg"
              :disabled="isLoading"
            />
          </BaseFormField>

          <slot v-if="!auth.pendingSecondFactor.value" name="security" />

          <p v-if="error" class="text-error text-center text-sm" role="alert">{{ error }}</p>

          <BaseButton type="submit" variant="primary" size="lg" block :loading="isLoading">
            {{
              isLoading
                ? t('auth.login.loggingIn')
                : auth.pendingSecondFactor.value
                  ? t('auth.login.verifyButton')
                  : t('auth.login.loginButton')
            }}
          </BaseButton>

          <BaseButton
            v-if="props.passkeyAvailable && !auth.pendingSecondFactor.value"
            type="button"
            size="lg"
            block
            @click="emit('passkey', credentials.username)"
          >
            <template #leading><i class="fas fa-key" aria-hidden="true"></i></template>
            {{ t('auth.login.loginWithPasskey') }}
          </BaseButton>
        </form>
      </section>
    </div>
  </div>
</template>
