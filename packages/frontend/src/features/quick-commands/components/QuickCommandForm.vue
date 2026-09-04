<script setup lang="ts">
  import { reactive, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useFeedback } from '@/shared/feedback/public';
  import {
    BaseButton,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseTextarea,
    TokenInput,
    type TokenOption,
  } from '@/foundation/ui';
  import type { QuickCommand, QuickCommandInput, QuickCommandTag } from '../model/quickCommand';
  import { useQuickCommandsStore } from '../store/quickCommands.store';
  const props = defineProps<{ visible: boolean; command?: QuickCommand | null; tags: QuickCommandTag[] }>();
  const emit = defineEmits<{ close: []; save: [input: QuickCommandInput] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useQuickCommandsStore();
  const form = reactive({
    name: '',
    command: '',
    tagIds: [] as number[],
    variables: [] as Array<{ key: string; value: string }>,
  });
  watch(
    () => [props.visible, props.command] as const,
    () => {
      const c = props.command;
      form.name = c?.name ?? '';
      form.command = c?.command ?? '';
      form.tagIds = c ? [...c.tagIds] : [];
      form.variables = Object.entries(c?.variables ?? {}).map(([key, value]) => ({ key, value }));
    },
    { immediate: true },
  );
  const options = () => props.tags.map<TokenOption>((tag) => ({ value: String(tag.id), label: tag.name }));
  const createTag = async (name: string) => {
    const normalized = name.trim();
    if (!normalized) return;
    const existing = props.tags.find((tag) => tag.name.toLowerCase() === normalized.toLowerCase());
    const tag = existing ?? (await store.addTag(normalized));
    if (!form.tagIds.includes(tag.id)) form.tagIds = [...form.tagIds, tag.id];
  };
  const deleteTag = async (option: TokenOption) => {
    const id = Number(option.value);
    const tag = props.tags.find((item) => item.id === id);
    if (!tag) return;
    if (
      !(await feedback.confirm({
        message: t('quickCommands.tags.confirmDelete', { name: tag.name }),
        destructive: true,
      }))
    )
      return;
    try {
      await store.removeTag(id);
      form.tagIds = form.tagIds.filter((tagId) => tagId !== id);
    } catch (cause) {
      feedback.notifyError(
        t('quickCommands.tags.deleteFailed', {
          name: tag.name,
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  };
  const save = () =>
    emit('save', {
      name: form.name.trim() || null,
      command: form.command.trim(),
      tagIds: [...form.tagIds],
      variables: Object.fromEntries(form.variables.filter((x) => x.key.trim()).map((x) => [x.key.trim(), x.value])),
    });
</script>
<template>
  <BaseModal
    :visible="visible"
    :title="t(command ? 'quickCommands.form.titleEdit' : 'quickCommands.form.titleAdd')"
    panel-class="w-[min(720px,94vw)]"
    @close="emit('close')"
    ><form data-testid="quick-command-form" class="space-y-4" @submit.prevent="save">
      <BaseFormField :label="t('quickCommands.form.name')"
        ><BaseInput
          v-model="form.name"
          data-testid="quick-command-name"
          :placeholder="t('quickCommands.form.namePlaceholder')"
      /></BaseFormField>
      <BaseFormField :label="t('quickCommands.form.command')"
        ><BaseTextarea v-model="form.command" data-testid="quick-command-command" rows="5" required
      /></BaseFormField>
      <BaseFormField :label="t('quickCommands.form.tags')"
        ><TokenInput
          :model-value="form.tagIds.map(String)"
          input-test-id="tag-input-text"
          token-test-id="tag-chip"
          :options="options()"
          :placeholder="t('quickCommands.form.tagsPlaceholder')"
          :remove-token-label="t('quickCommands.tags.removeSelection')"
          :delete-option-label="t('quickCommands.tags.deleteGlobally')"
          allow-custom
          allow-option-delete
          @update:model-value="form.tagIds = $event.map(Number)"
          @create="createTag"
          @delete-option="deleteTag"
      /></BaseFormField>
      <div>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="font-medium">{{ t('quickCommands.form.variablesTitle') }}</h3>
          <BaseButton
            data-testid="quick-command-variable-add"
            size="sm"
            type="button"
            @click="form.variables.push({ key: '', value: '' })"
            >{{ t('quickCommands.form.addVariable') }}</BaseButton
          >
        </div>
        <div class="space-y-2">
          <div v-for="(variable, index) in form.variables" :key="index" class="grid gap-2 grid-cols-[1fr_1fr_auto]">
            <BaseInput
              v-model="variable.key"
              :data-testid="`quick-command-variable-name-${index}`"
              :placeholder="t('quickCommands.form.variableNamePlaceholder')"
            /><BaseInput
              v-model="variable.value"
              :data-testid="`quick-command-variable-value-${index}`"
              :placeholder="t('quickCommands.form.variableValuePlaceholder')"
            /><BaseButton type="button" variant="ghost" @click="form.variables.splice(index, 1)">×</BaseButton>
          </div>
        </div>
      </div>
      <div class="flex justify-end gap-2">
        <BaseButton type="button" @click="emit('close')">{{ t('common.cancel') }}</BaseButton
        ><BaseButton data-testid="quick-command-submit" type="submit" variant="primary">{{
          t('common.save')
        }}</BaseButton>
      </div>
    </form></BaseModal
  >
</template>
