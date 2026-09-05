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
    panel-class="max-w-xl max-h-[90vh]"
    content-class="!overflow-hidden !py-0"
    @close="emit('close')"
  >
    <div class="flex max-h-[78vh] min-h-0 flex-col">
      <h3 class="mb-6 shrink-0 text-center text-xl font-semibold">
        {{ t('connections.batchEdit.title') }} ({{ t('connections.batchEdit.selectedItems', { count }) }})
      </h3>
      <div class="flex-grow space-y-4 overflow-y-auto pr-2">
        <section class="rounded-md border border-border bg-background p-4">
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-base font-semibold">{{ t('connections.table.port') }}</h4>
            <BaseCheckbox v-model="editPort" />
          </div>
          <BaseFormField v-if="editPort" :label="t('connections.form.port')"
            ><BaseInput v-model="form.port" type="number" min="1" max="65535"
          /></BaseFormField>
        </section>

        <section class="rounded-md border border-border bg-background p-4">
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-base font-semibold">{{ t('connections.form.sectionAuth') }}</h4>
            <BaseCheckbox v-model="editAuth" />
          </div>
          <div v-if="editAuth" class="space-y-3">
            <BaseFormField :label="t('connections.form.username')"
              ><BaseInput v-model="form.username" :placeholder="t('connections.batchEdit.leaveBlankNoChange')"
            /></BaseFormField>
            <BaseFormField :label="t('connections.form.authMethod')">
              <BaseSelect v-model="form.authChoice"
                ><option value="__nochange__">{{ t('connections.batchEdit.noChange') }}</option>
                <option value="password">{{ t('connections.form.authMethodPassword') }}</option>
                <option value="key">{{ t('connections.form.authMethodKey') }}</option></BaseSelect
              >
            </BaseFormField>
            <BaseFormField v-if="form.authChoice === 'password'" :label="t('connections.form.password')"
              ><BaseInput v-model="form.password" type="password" autocomplete="new-password"
            /></BaseFormField>
            <BaseFormField v-else-if="form.authChoice === 'key'" :label="t('connections.form.sshKey')">
              <BaseSelect v-model="form.sshKeyChoice"
                ><option value="">{{ t('connections.form.noSshKey') }}</option>
                <option v-for="key in sshKeys.keys.value" :key="key.id" :value="String(key.id)">
                  {{ key.name }}
                </option></BaseSelect
              >
            </BaseFormField>
          </div>
        </section>

        <section class="rounded-md border border-border bg-background p-4">
          <div class="mb-2 flex items-center justify-between">
            <h4 class="text-base font-semibold">{{ t('connections.form.sectionAdvanced') }}</h4>
            <BaseCheckbox v-model="editAdvanced" data-testid="batch-edit-advanced-toggle" />
          </div>
          <div v-if="editAdvanced" class="space-y-3">
            <BaseFormField :label="t('connections.form.proxy')">
              <BaseSelect v-model="form.proxyChoice"
                ><option value="__nochange__">{{ t('connections.batchEdit.noChange') }}</option>
                <option value="__none__">{{ t('connections.form.noProxy') }}</option>
                <option v-for="proxy in proxies.proxies.value" :key="proxy.id" :value="String(proxy.id)">
                  {{ proxy.name }} ({{ proxy.type }})
                </option></BaseSelect
              >
            </BaseFormField>
            <div>
              <label class="mb-1 flex items-center justify-between text-sm font-medium text-text-secondary"
                ><span>{{ t('connections.table.tags') }}</span
                ><span class="flex items-center gap-2 text-xs font-normal"
                  ><BaseCheckbox v-model="editTags" />{{ t('connections.batchEdit.changeTags') }}</span
                ></label
              >
              <ConnectionTagPicker v-if="editTags" v-model="form.tagIds" />
            </div>
            <div class="pt-2">
              <label class="mb-1 flex items-center justify-between text-sm font-medium text-text-secondary"
                ><span>{{ t('connections.form.notes') }}</span
                ><span class="flex items-center gap-2 text-xs font-normal"
                  ><BaseCheckbox v-model="editNotes" data-testid="batch-edit-notes-toggle" />{{
                    t('connections.batchEdit.changeNotes')
                  }}</span
                ></label
              >
              <BaseTextarea v-if="editNotes" id="batch-notes" v-model="form.notes" rows="3" />
            </div>
          </div>
        </section>
        <p
          v-if="error"
          class="rounded-md border border-error/30 bg-error/10 p-3 text-center text-sm text-error"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
      <footer class="mt-4 flex shrink-0 justify-end space-x-3 border-t border-border/50 pt-5">
        <BaseButton @click="emit('close')">{{ t('common.cancel') }}</BaseButton>
        <BaseButton data-testid="batch-edit-save" variant="primary" @click="save"
          ><template #leading><i class="fas fa-save" aria-hidden="true" /></template>{{ t('common.save') }}</BaseButton
        >
      </footer>
    </div>
  </BaseModal>
</template>
