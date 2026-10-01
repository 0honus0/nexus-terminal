<script setup lang="ts">
  import { ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { UiButton, UiFormField, UiInput } from '@/foundation/ui';
  import { useAuthSession } from '../public';

  const router = useRouter();
  const { t } = useI18n();
  const auth = useAuthSession();

  const username = ref('');
  const password = ref('');
  const confirmPassword = ref('');
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const successMessage = ref<string | null>(null);

  const submit = async (): Promise<void> => {
    error.value = null;
    successMessage.value = null;

    if (!username.value || !password.value) {
      error.value = t('auth.setup.error.fieldsRequired');
      return;
    }
    if (password.value !== confirmPassword.value) {
      error.value = t('auth.setup.error.passwordsDoNotMatch');
      return;
    }

    isLoading.value = true;
    try {
      await auth.setup({
        username: username.value,
        password: password.value,
        confirmPassword: confirmPassword.value,
      });
      successMessage.value = t('auth.setup.success');
      await router.push({ name: 'Login' });
    } catch (cause) {
      error.value = apiErrorMessage(cause, t('auth.setup.error.generic'));
    } finally {
      isLoading.value = false;
    }
  };
</script>

<template>
  <div class="auth-page flex min-h-dvh items-center justify-center overflow-y-auto p-4">
    <div class="auth-setup-panel ui-glass-panel flex w-full max-w-4xl overflow-hidden rounded-2xl">
      <section class="auth-brand-pane hidden w-2/5 flex-col items-center justify-center p-10 text-white md:flex">
        <img src="@/assets/logo-small.png" :alt="t('projectName')" class="mb-5 h-20 w-auto" />
        <h1 class="mb-2 text-3xl font-bold">{{ t('projectName') }}</h1>
        <p class="text-center text-base opacity-80">{{ t('auth.setup.description') }}</p>
      </section>

      <section class="flex w-full flex-col justify-center p-8 sm:p-12 md:w-3/5">
        <div class="mb-6 flex flex-col items-center md:hidden">
          <img src="@/assets/logo-small.png" :alt="t('projectName')" class="mb-3 h-16 w-auto" />
          <h2 class="text-xl font-semibold text-foreground">{{ t('auth.setup.title') }}</h2>
          <p class="mt-1 text-sm text-text-secondary">{{ t('auth.setup.description') }}</p>
        </div>
        <h2 class="mb-6 hidden text-center text-2xl font-semibold text-foreground md:block">
          {{ t('auth.setup.title') }}
        </h2>

        <form class="space-y-5" @submit.prevent="submit">
          <UiFormField :label="t('auth.setup.username')" for-id="username">
            <UiInput
              id="username"
              v-model="username"
              name="username"
              autocomplete="username"
              required
              density="comfortable"
              class="auth-setup-control rounded-lg"
              :placeholder="t('auth.setup.usernamePlaceholder')"
              :disabled="isLoading"
            />
          </UiFormField>

          <UiFormField :label="t('auth.setup.password')" for-id="password">
            <UiInput
              id="password"
              v-model="password"
              name="password"
              type="password"
              autocomplete="new-password"
              required
              density="comfortable"
              class="auth-setup-control rounded-lg"
              :placeholder="t('auth.setup.passwordPlaceholder')"
              :disabled="isLoading"
            />
          </UiFormField>

          <UiFormField :label="t('auth.setup.confirmPassword')" for-id="confirmPassword">
            <UiInput
              id="confirmPassword"
              v-model="confirmPassword"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
              density="comfortable"
              class="auth-setup-control rounded-lg"
              :placeholder="t('auth.setup.confirmPasswordPlaceholder')"
              :disabled="isLoading"
            />
          </UiFormField>

          <p
            v-if="error"
            class="text-error rounded border border-error/20 bg-error/10 px-4 py-2 text-center text-sm"
            role="alert"
          >
            {{ error }}
          </p>
          <p
            v-if="successMessage"
            class="text-success rounded border border-success/20 bg-success/10 px-4 py-2 text-center text-sm"
            role="status"
          >
            {{ successMessage }}
          </p>

          <UiButton
            type="submit"
            appearance="solid"
            tone="primary"
            density="comfortable"
            block
            class="auth-setup-control rounded-lg px-4"
            :loading="isLoading"
          >
            {{ isLoading ? t('auth.setup.settingUp') : t('auth.setup.submitButton') }}
          </UiButton>
        </form>
      </section>
    </div>
  </div>
</template>

<style scoped>
  .auth-page {
    background:
      radial-gradient(circle at 12% 24%, rgb(57 153 210 / 18%), transparent 34rem),
      radial-gradient(circle at 88% 76%, rgb(171 102 205 / 14%), transparent 38rem), var(--app-bg-color);
  }

  .auth-brand-pane {
    background:
      linear-gradient(145deg, color-mix(in srgb, var(--link-active-color) 82%, transparent), transparent),
      color-mix(in srgb, var(--link-color) 72%, transparent);
    border-right: 1px solid rgb(255 255 255 / 20%);
    box-shadow: inset -1px 0 0 rgb(0 0 0 / 8%);
  }

  .auth-setup-panel {
    border-color: color-mix(in srgb, var(--border-color) 82%, var(--glass-rim));
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--glass-rim) 24%, transparent),
      var(--glass-shadow);
  }

  .auth-setup-control[data-ui-gen='2'] {
    --ui-control-height: 44px;
  }
</style>
