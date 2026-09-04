<script setup lang="ts">
  import { ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import ConnectionForm from './ConnectionForm.vue';
  import { useConnections } from '../composables/useConnections';
  import type { Connection, ConnectionInput, ConnectionUpdate } from '../model/connection';

  const props = defineProps<{ visible: boolean; connection?: Connection | null }>();
  const emit = defineEmits<{ close: []; saved: [connection: Connection]; deleted: [id: number] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const data = useConnections();
  const loading = ref(false);

  const save = async (input: ConnectionInput | Partial<ConnectionInput>) => {
    if (loading.value) return;
    loading.value = true;
    try {
      const connection = props.connection
        ? await data.update(props.connection.id, input as ConnectionUpdate)
        : await data.create(input as ConnectionInput);
      emit('saved', connection);
      emit('close');
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      feedback.notifyError(
        t(props.connection ? 'connections.errors.updateFailed' : 'connections.errors.createFailed', { error }),
      );
    } finally {
      loading.value = false;
    }
  };

  const saveMany = async (inputs: ConnectionInput[]) => {
    if (loading.value || inputs.length === 0) return;
    loading.value = true;
    let successCount = 0;
    let errorCount = 0;
    let firstError = '';
    let last: Connection | null = null;
    try {
      for (const input of inputs) {
        try {
          last = await data.create(input);
          successCount += 1;
        } catch (cause) {
          errorCount += 1;
          if (!firstError) firstError = cause instanceof Error ? cause.message : String(cause);
        }
      }

      if (last) emit('saved', last);
      if (errorCount > 0) {
        const message = t('connections.form.errorBatchAddResult', {
          successCount,
          errorCount,
          firstErrorEncountered: firstError,
        });
        if (successCount > 0) feedback.notifyWarning(message);
        else feedback.notifyError(message);
        return;
      }

      feedback.notifySuccess(t('connections.form.successBatchAddResult', { successCount }));
      emit('close');
    } finally {
      loading.value = false;
    }
  };

  const remove = async () => {
    const connection = props.connection;
    if (!connection || loading.value) return;
    if (
      !(await feedback.confirm({
        message: t('connections.prompts.confirmDelete', { name: connection.name || connection.host }),
        destructive: true,
      }))
    )
      return;
    loading.value = true;
    try {
      await data.remove(connection.id);
      emit('deleted', connection.id);
      emit('close');
    } catch (cause) {
      feedback.notifyError(
        t('connections.errors.deleteFailed', { error: cause instanceof Error ? cause.message : String(cause) }),
      );
    } finally {
      loading.value = false;
    }
  };
</script>

<template>
  <BaseModal :visible="visible" panel-class="w-[min(96vw,900px)]" @close="emit('close')">
    <ConnectionForm
      :connection="connection ?? null"
      :loading="loading"
      @submit="save"
      @submit-many="saveMany"
      @cancel="emit('close')"
      @delete="remove"
    />
  </BaseModal>
</template>
