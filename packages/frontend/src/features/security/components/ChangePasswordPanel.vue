<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseFormField, BaseInput } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { securityApi } from '../api/securityApi';

  const { t } = useI18n();
  const feedback = useFeedback();
  const currentPassword = ref('');
  const newPassword = ref('');
  const confirmPassword = ref('');
  const loading = ref(false);
  const message = ref('');
  const success = ref(false);

  const submit = async () => {
    message.value = '';
    success.value = false;
    if (!currentPassword.value || !newPassword.value) {
      message.value = t('settings.changePassword.error.fieldsRequired');
      feedback.notifyError(message.value);
      return;
    }
    if (newPassword.value !== confirmPassword.value) {
      message.value = t('settings.changePassword.error.passwordsDoNotMatch');
      feedback.notifyError(message.value);
      return;
    }
    loading.value = true;
    try {
      await securityApi.changePassword(currentPassword.value, newPassword.value);
      message.value = t('settings.changePassword.success');
      success.value = true;
      feedback.notifySuccess(message.value);
      currentPassword.value = '';
      newPassword.value = '';
      confirmPassword.value = '';
    } catch (cause) {
      message.value = apiErrorMessage(cause, t('settings.changePassword.error.generic'));
      feedback.notifyError(message.value);
    } finally {
      loading.value = false;
    }
  };
</script>

<template>
  <section data-testid="change-password-settings">
    <h3 class="mb-3 text-base font-semibold text-foreground">{{ t('settings.changePassword.title') }}</h3>
    <form class="space-y-4" @submit.prevent="submit">
      <BaseFormField :label="t('settings.changePassword.currentPassword')" for-id="currentPassword">
        <BaseInput
          id="currentPassword"
          v-model="currentPassword"
          data-testid="change-password-current"
          type="password"
          autocomplete="current-password"
        />
      </BaseFormField>
      <BaseFormField :label="t('settings.changePassword.newPassword')" for-id="newPassword">
        <BaseInput
          id="newPassword"
          v-model="newPassword"
          data-testid="change-password-new"
          type="password"
          autocomplete="new-password"
        />
      </BaseFormField>
      <BaseFormField :label="t('settings.changePassword.confirmPassword')" for-id="confirmPassword">
        <BaseInput
          id="confirmPassword"
          v-model="confirmPassword"
          data-testid="change-password-confirm"
          type="password"
          autocomplete="new-password"
        />
      </BaseFormField>
      <div class="flex items-center justify-between gap-4">
        <BaseButton data-testid="change-password-submit" type="submit" variant="primary" :loading="loading">{{
          t('settings.changePassword.submit')
        }}</BaseButton>
        <p v-if="message" :class="success ? 'text-success' : 'text-error'" class="text-sm" role="status">
          {{ message }}
        </p>
      </div>
    </form>
  </section>
</template>
