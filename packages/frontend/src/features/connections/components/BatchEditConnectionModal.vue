<script setup lang="ts">
  import { onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    BaseButton,
    BaseCheckbox,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSelect,
    BaseTextarea,
  } from '@/foundation/ui';
  import { ConnectionTagPicker } from '@/features/tags/public';
  import { useProxies } from '@/features/proxies/public';
  import { useSshKeys } from '@/features/ssh-keys/public';
  import type { ConnectionUpdate } from '../model/connection';

  type BatchAuthChoice = '__nochange__' | 'password' | 'key';

  const props = defineProps<{ visible: boolean; count: number }>();
  const emit = defineEmits<{ close: []; save: [update: ConnectionUpdate] }>();
  const { t } = useI18n();
  const proxies = useProxies();
  const sshKeys = useSshKeys();

  const editPort = ref(false);
  const editAuth = ref(false);
  const editAdvanced = ref(false);
  const editTags = ref(false);
  const editNotes = ref(false);
  const error = ref('');
  const form = reactive({
    port: '',
    username: '',
    authChoice: '__nochange__' as BatchAuthChoice,
    password: '',
    sshKeyChoice: '',
    proxyChoice: '__nochange__',
    tagIds: [] as number[],
    notes: '',
  });

  const reset = () => {
    editPort.value = false;
    editAuth.value = false;
    editAdvanced.value = false;
    editTags.value = false;
    editNotes.value = false;
    error.value = '';
    Object.assign(form, {
      port: '',
      username: '',
      authChoice: '__nochange__',
      password: '',
      sshKeyChoice: '',
      proxyChoice: '__nochange__',
      tagIds: [],
      notes: '',
    });
  };

  watch(
    () => props.visible,
    (visible) => visible && reset(),
  );
  watch(
    () => form.authChoice,
    () => {
      form.password = '';
      form.sshKeyChoice = '';
      error.value = '';
    },
  );
  onMounted(() => Promise.all([proxies.load(), sshKeys.load()]));

  const save = () => {
    error.value = '';
    const update: ConnectionUpdate = {};

    if (editPort.value) {
      const port = Number(form.port);
      if (!form.port.trim() || !Number.isInteger(port) || port <= 0 || port > 65535) {
        error.value = t('connections.form.errorPort');
        return;
      }
      update.port = port;
    }

    if (editAuth.value) {
      if (form.username.trim()) update.username = form.username.trim();
      if (form.authChoice === 'password') {
        if (!form.password) {
          error.value = t('connections.form.errorPasswordRequiredOnSwitch');
          return;
        }
        update.authMethod = 'password';
        update.password = form.password;
      } else if (form.authChoice === 'key') {
        if (!form.sshKeyChoice) {
          error.value = t('connections.form.errorSshKeyRequiredOnSwitch');
          return;
        }
        update.authMethod = 'key';
        update.sshKeyId = Number(form.sshKeyChoice);
      }
    }

    if (editAdvanced.value) {
      if (form.proxyChoice !== '__nochange__') {
        update.proxyId = form.proxyChoice === '__none__' ? null : Number(form.proxyChoice);
        update.route = form.proxyChoice === '__none__' ? null : 'proxy';
      }
      if (editTags.value) update.tagIds = [...form.tagIds];
      if (editNotes.value) update.notes = form.notes;
    }

    if (Object.keys(update).length === 0) {
      error.value = t('connections.batchEdit.noChanges');
      return;
    }
    emit('save', update);
  };
</script>

<template>
  <BaseModal
    :visible="visible"
    data-testid="batch-edit-modal"
    :title="t('connections.batchEdit.title')"
    @close="emit('close')"
  >
    <div class="space-y-5">
      <p>{{ t('connections.batchEdit.selectedItems', { count }) }}</p>

      <section class="space-y-3 rounded border border-border p-4">
        <label class="flex items-center gap-2">
          <BaseCheckbox v-model="editPort" />{{ t('connections.batchEdit.changePort') }}
        </label>
        <BaseFormField v-if="editPort" :label="t('connections.form.port')">
          <BaseInput v-model="form.port" type="number" min="1" max="65535" />
        </BaseFormField>
      </section>

      <section class="space-y-3 rounded border border-border p-4">
        <label class="flex items-center gap-2">
          <BaseCheckbox v-model="editAuth" />{{ t('connections.batchEdit.changeAuth') }}
        </label>
        <template v-if="editAuth">
          <BaseFormField :label="t('connections.form.username')">
            <BaseInput v-model="form.username" :placeholder="t('connections.batchEdit.leaveBlankNoChange')" />
          </BaseFormField>
          <BaseFormField :label="t('connections.form.authMethod')">
            <BaseSelect v-model="form.authChoice">
              <option value="__nochange__">{{ t('connections.batchEdit.noChange') }}</option>
              <option value="password">{{ t('connections.form.authMethodPassword') }}</option>
              <option value="key">{{ t('connections.form.authMethodKey') }}</option>
            </BaseSelect>
          </BaseFormField>
          <BaseFormField v-if="form.authChoice === 'password'" :label="t('connections.form.password')">
            <BaseInput v-model="form.password" type="password" autocomplete="new-password" />
          </BaseFormField>
          <BaseFormField v-else-if="form.authChoice === 'key'" :label="t('connections.form.sshKey')">
            <BaseSelect v-model="form.sshKeyChoice">
              <option value="">{{ t('connections.form.noSshKey') }}</option>
              <option v-for="key in sshKeys.keys.value" :key="key.id" :value="String(key.id)">{{ key.name }}</option>
            </BaseSelect>
          </BaseFormField>
        </template>
      </section>

      <section class="space-y-3 rounded border border-border p-4">
        <label class="flex items-center gap-2">
          <BaseCheckbox v-model="editAdvanced" data-testid="batch-edit-advanced-toggle" />{{
            t('connections.form.sectionAdvanced')
          }}
        </label>
        <template v-if="editAdvanced">
          <BaseFormField :label="t('connections.form.proxy')">
            <BaseSelect v-model="form.proxyChoice">
              <option value="__nochange__">{{ t('connections.batchEdit.noChange') }}</option>
              <option value="__none__">{{ t('connections.form.noProxy') }}</option>
              <option v-for="proxy in proxies.proxies.value" :key="proxy.id" :value="String(proxy.id)">
                {{ proxy.name }} ({{ proxy.type }})
              </option>
            </BaseSelect>
          </BaseFormField>
          <label class="flex items-center gap-2">
            <BaseCheckbox v-model="editTags" />{{ t('connections.batchEdit.changeTags') }}
          </label>
          <ConnectionTagPicker v-if="editTags" v-model="form.tagIds" />
          <label class="flex items-center gap-2">
            <BaseCheckbox v-model="editNotes" data-testid="batch-edit-notes-toggle" />{{
              t('connections.batchEdit.changeNotes')
            }}
          </label>
          <BaseFormField v-if="editNotes" :label="t('connections.form.notes')">
            <BaseTextarea id="batch-notes" v-model="form.notes" rows="4" />
          </BaseFormField>
        </template>
      </section>

      <p v-if="error" class="text-sm text-error" role="alert">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <BaseButton @click="emit('close')">{{ t('common.cancel') }}</BaseButton>
        <BaseButton data-testid="batch-edit-save" variant="primary" @click="save">{{ t('common.save') }}</BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
