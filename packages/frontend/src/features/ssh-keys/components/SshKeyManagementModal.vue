<script setup lang="ts">
  import { onMounted, reactive, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { apiErrorMessage } from '@/client/http';
  import { BaseButton, BaseFormField, BaseInput, BaseModal, BaseTable, BaseTextarea } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import { useSshKeys } from '../composables/useSshKeys';
  import type { SshKeySummary } from '../model/sshKey';
  const visible = defineModel<boolean>({ default: false });
  const { t } = useI18n();
  const keys = useSshKeys();
  const feedback = useFeedback();
  const editing = ref<SshKeySummary | null>(null);
  const showForm = ref(false);
  const form = reactive({ name: '', privateKey: '', passphrase: '' });
  const error = ref('');
  const loading = ref(false);
  const reset = () => {
    editing.value = null;
    showForm.value = false;
    Object.assign(form, { name: '', privateKey: '', passphrase: '' });
    error.value = '';
  };
  const add = () => {
    reset();
    showForm.value = true;
  };
  const edit = (key: SshKeySummary) => {
    editing.value = key;
    showForm.value = true;
    Object.assign(form, { name: key.name, privateKey: '', passphrase: '' });
  };
  const submit = async () => {
    if (loading.value) return;
    error.value = '';
    loading.value = true;
    try {
      if (editing.value)
        await keys.update(editing.value.id, {
          name: form.name,
          ...(form.privateKey ? { privateKey: form.privateKey, passphrase: form.passphrase || null } : {}),
          ...(!form.privateKey && form.passphrase ? { passphrase: form.passphrase } : {}),
        });
      else await keys.create({ name: form.name, privateKey: form.privateKey, passphrase: form.passphrase || null });
      reset();
    } catch (cause) {
      error.value = apiErrorMessage(cause, t('common.errorOccurred'));
    } finally {
      loading.value = false;
    }
  };
  const remove = async (key: SshKeySummary) => {
    if (loading.value) return;
    if (!(await feedback.confirm({ message: `${t('common.delete')} ${key.name}?`, destructive: true }))) return;
    loading.value = true;
    try {
      await keys.remove(key.id);
    } finally {
      loading.value = false;
    }
  };
  onMounted(async () => {
    loading.value = true;
    try {
      await keys.load();
    } finally {
      loading.value = false;
    }
  });
</script>
<template>
  <BaseModal
    :visible="visible"
    panel-class="max-w-3xl max-h-[80vh]"
    content-class="!overflow-hidden !py-0"
    @close="visible = false"
  >
    <div data-testid="ssh-key-management-modal" class="flex max-h-[68vh] min-h-0 flex-col">
      <template v-if="!showForm">
        <h3 class="mb-4 shrink-0 text-center text-xl font-semibold">{{ t('sshKeys.modal.title') }}</h3>
        <div class="mb-4 flex shrink-0 justify-end">
          <BaseButton data-testid="ssh-key-add" variant="primary" :disabled="loading" @click="add"
            ><template #leading><i class="fas fa-plus !text-white" aria-hidden="true" /></template
            >{{ t('sshKeys.modal.addKey') }}</BaseButton
          >
        </div>
        <div class="max-h-[50vh] flex-grow overflow-y-auto rounded-md border border-border">
          <table class="min-w-full divide-y divide-border">
            <thead class="sticky top-0 bg-header">
              <tr>
                <th class="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-secondary">
                  {{ t('sshKeys.modal.keyName') }}
                </th>
                <th class="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-text-secondary">
                  {{ t('sshKeys.modal.actions') }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border bg-background">
              <tr v-if="loading">
                <td colspan="2" class="px-6 py-4 text-center text-sm text-text-secondary">
                  {{ t('sshKeys.modal.loading') }}
                </td>
              </tr>
              <tr v-else-if="keys.keys.value.length === 0">
                <td colspan="2" class="px-6 py-4 text-center text-sm text-text-secondary">
                  {{ t('sshKeys.modal.noKeys') }}
                </td>
              </tr>
              <tr v-for="key in keys.keys.value" :key="key.id" :data-key-id="key.id">
                <td class="px-6 py-4 text-sm font-medium text-foreground">{{ key.name }}</td>
                <td class="space-x-2 px-6 py-4 text-right text-sm font-medium">
                  <button
                    data-testid="ssh-key-edit"
                    type="button"
                    class="text-primary hover:text-link-hover disabled:opacity-50"
                    :disabled="loading"
                    :title="t('sshKeys.modal.edit')"
                    @click="edit(key)"
                  >
                    <i class="fas fa-pencil-alt" aria-hidden="true" /></button
                  ><button
                    data-testid="ssh-key-delete"
                    type="button"
                    class="text-error hover:opacity-80 disabled:opacity-50"
                    :disabled="loading"
                    :title="t('sshKeys.modal.delete')"
                    @click="remove(key)"
                  >
                    <i class="fas fa-trash-alt" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="mt-6 shrink-0 text-right">
          <BaseButton :disabled="loading" @click="visible = false">{{ t('sshKeys.modal.close') }}</BaseButton>
        </div>
      </template>

      <template v-else>
        <h3 class="mb-6 shrink-0 text-center text-xl font-semibold">
          {{ editing ? t('sshKeys.modal.editTitle') : t('sshKeys.modal.addTitle') }}
        </h3>
        <form class="flex-grow space-y-4 overflow-y-auto pr-2" @submit.prevent="submit">
          <BaseFormField :label="t('sshKeys.modal.keyName')"
            ><BaseInput id="key-name" v-model="form.name" required
          /></BaseFormField>
          <BaseFormField :label="t('sshKeys.modal.privateKey')"
            ><BaseTextarea
              id="key-private"
              v-model="form.privateKey"
              rows="8"
              :required="!editing"
              class="font-mono text-sm"
          /></BaseFormField>
          <BaseFormField :label="`${t('sshKeys.modal.passphrase')} (${t('connections.form.optional')})`"
            ><BaseInput id="key-passphrase" v-model="form.passphrase" type="password" autocomplete="new-password"
          /></BaseFormField>
          <p
            v-if="error"
            class="rounded-md border border-error/30 bg-error/10 p-3 text-center text-sm font-medium text-error"
          >
            {{ error }}
          </p>
        </form>
        <div class="mt-4 flex shrink-0 justify-end space-x-3 border-t border-border/50 pt-5">
          <BaseButton :disabled="loading" @click="reset">{{ t('sshKeys.modal.cancel') }}</BaseButton
          ><BaseButton data-testid="ssh-key-submit" variant="primary" :disabled="loading" @click="submit">{{
            editing ? t('sshKeys.modal.saveChanges') : t('sshKeys.modal.addKey')
          }}</BaseButton>
        </div>
      </template>
    </div>
  </BaseModal>
</template>
