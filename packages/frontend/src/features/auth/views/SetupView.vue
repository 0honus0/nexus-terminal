<script setup lang="ts">
  import { ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseFormField, BaseInput } from '@/foundation/ui';
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
  <div
    class="flex min-h-screen items-center justify-center bg-background bg-[radial-gradient(var(--border-color)_1px,transparent_1px)] bg-[size:16px_16px] p-4"
  >
    <div class="flex w-full max-w-4xl overflow-hidden rounded-xl border border-border/40 bg-background shadow-2xl">
      <section
        class="hidden w-2/5 flex-col items-center justify-center bg-gradient-to-br from-primary to-link p-10 text-white md:flex"
      >
        <img src="@/assets/logo.png" :alt="t('projectName')" class="mb-5 h-20 w-auto" />
        <h1 class="mb-2 text-3xl font-bold">{{ t('projectName') }}</h1>
        <p class="text-center text-base opacity-80">{{ t('auth.setup.description') }}</p>
      </section>

      <section class="flex w-full flex-col justify-center p-8 sm:p-12 md:w-3/5">
        <div class="mb-6 flex flex-col items-center md:hidden">
          <img src="@/assets/logo.png" :alt="t('projectName')" class="mb-3 h-16 w-auto" />
          <h2 class="text-xl font-semibold text-foreground">{{ t('auth.setup.title') }}</h2>
          <p class="mt-1 text-sm text-text-secondary">{{ t('auth.setup.description') }}</p>
        </div>
        <h2 class="mb-6 hidden text-center text-2xl font-semibold text-foreground md:block">
          {{ t('auth.setup.title') }}
        </h2>

        <form class="space-y-5" @submit.prevent="submit">
          <BaseFormField :label="t('auth.setup.username')" for-id="username" required>
            <BaseInput
              id="username"
              v-model="username"
              name="username"
              autocomplete="username"
              required
              size="lg"
              :placeholder="t('auth.setup.usernamePlaceholder')"
              :disabled="isLoading"
            />
          </BaseFormField>

          <BaseFormField :label="t('auth.setup.password')" for-id="password" required>
            <BaseInput
              id="password"
              v-model="password"
              name="password"
              type="password"
              autocomplete="new-password"
              required
              size="lg"
              :placeholder="t('auth.setup.passwordPlaceholder')"
              :disabled="isLoading"
            />
          </BaseFormField>

          <BaseFormField :label="t('auth.setup.confirmPassword')" for-id="confirmPassword" required>
            <BaseInput
              id="confirmPassword"
              v-model="confirmPassword"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              required
              size="lg"
              :placeholder="t('auth.setup.confirmPasswordPlaceholder')"
              :disabled="isLoading"
            />
          </BaseFormField>

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

          <BaseButton type="submit" variant="primary" size="lg" block :loading="isLoading">
            {{ isLoading ? t('auth.setup.settingUp') : t('auth.setup.submitButton') }}
          </BaseButton>
        </form>
      </section>
    </div>
  </div>
</template>
