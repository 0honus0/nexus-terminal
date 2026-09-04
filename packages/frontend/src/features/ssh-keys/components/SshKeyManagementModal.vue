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
    error.value = '';
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
    }
  };
  const remove = async (key: SshKeySummary) => {
    if (!(await feedback.confirm({ message: `${t('common.delete')} ${key.name}?`, destructive: true }))) return;
    await keys.remove(key.id);
  };
  onMounted(() => keys.load());
</script>
<template>
  <BaseModal
    :visible="visible"
    :title="t('sshKeys.modal.title')"
    panel-class="w-[min(860px,94vw)]"
    @close="visible = false"
    ><div data-testid="ssh-key-management-modal" class="space-y-4">
      <div class="flex justify-end">
        <BaseButton data-testid="ssh-key-add" variant="primary" @click="add">{{
          t('sshKeys.modal.addTitle')
        }}</BaseButton>
      </div>
      <form v-if="showForm" class="space-y-3 rounded border border-border p-4" @submit.prevent="submit">
        <BaseFormField :label="t('sshKeys.modal.keyName')"
          ><BaseInput id="key-name" v-model="form.name" required /></BaseFormField
        ><BaseFormField :label="t('sshKeys.modal.privateKey')"
          ><BaseTextarea id="key-private" v-model="form.privateKey" :required="!editing" rows="8" />
          <p v-if="editing" class="mt-1 text-xs text-text-secondary">
            {{ t('sshKeys.modal.keyUpdateNote') }}
          </p></BaseFormField
        ><BaseFormField :label="t('sshKeys.modal.passphrase')"
          ><BaseInput id="key-passphrase" v-model="form.passphrase" type="password" />
          <p v-if="editing" class="mt-1 text-xs text-text-secondary">
            {{ t('sshKeys.modal.passphraseUpdateNote') }}
          </p></BaseFormField
        >
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex gap-2">
          <BaseButton data-testid="ssh-key-submit" type="submit" variant="primary">{{ t('common.save') }}</BaseButton
          ><BaseButton @click="reset">{{ t('common.cancel') }}</BaseButton>
        </div>
      </form>
      <BaseTable :empty="keys.keys.value.length === 0"
        ><template #head
          ><tr>
            <th class="px-3 py-2">{{ t('sshKeys.modal.keyName') }}</th>
            <th></th></tr
        ></template>
        <tr v-for="key in keys.keys.value" :key="key.id" :data-key-id="key.id">
          <td class="px-3 py-2">{{ key.name }}</td>
          <td class="px-3 py-2">
            <div class="flex justify-end gap-2">
              <BaseButton data-testid="ssh-key-edit" size="sm" @click="edit(key)">{{ t('common.edit') }}</BaseButton
              ><BaseButton data-testid="ssh-key-delete" size="sm" variant="danger" @click="remove(key)">{{
                t('common.delete')
              }}</BaseButton>
            </div>
          </td>
        </tr></BaseTable
      >
    </div></BaseModal
  >
</template>
