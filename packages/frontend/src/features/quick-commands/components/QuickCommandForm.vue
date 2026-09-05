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
  const emit = defineEmits<{
    close: [];
    save: [input: QuickCommandInput];
    execute: [input: QuickCommandInput];
  }>();
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
      const command = props.command;
      form.name = command?.name ?? '';
      form.command = command?.command ?? '';
      form.tagIds = command ? [...command.tagIds] : [];
      form.variables = Object.entries(command?.variables ?? {}).map(([key, value]) => ({ key, value }));
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

  const toInput = (): QuickCommandInput => ({
    name: form.name.trim() || null,
    command: form.command.trim(),
    tagIds: [...form.tagIds],
    variables: Object.fromEntries(
      form.variables.filter((item) => item.key.trim()).map((item) => [item.key.trim(), item.value]),
    ),
  });
  const save = () => emit('save', toInput());
  const execute = () => {
    const input = toInput();
    if (!input.command) return;
    emit('execute', input);
  };
</script>

<template>
  <BaseModal
    :visible="visible"
    :title="t(command ? 'quickCommands.form.titleEdit' : 'quickCommands.form.titleAdd')"
    panel-class="w-[min(720px,94vw)] max-h-[90dvh]"
    content-class="!py-0"
    @close="emit('close')"
  >
    <form data-testid="quick-command-form" class="space-y-5 py-5" @submit.prevent="save">
      <BaseFormField :label="t('quickCommands.form.name')">
        <BaseInput
          v-model="form.name"
          data-testid="quick-command-name"
          :placeholder="t('quickCommands.form.namePlaceholder')"
        />
      </BaseFormField>

      <BaseFormField :label="t('quickCommands.form.command')">
        <BaseTextarea
          v-model="form.command"
          data-testid="quick-command-command"
          rows="5"
          required
          class="min-h-[80px] whitespace-nowrap"
          :placeholder="t('quickCommands.form.commandPlaceholder')"
        />
      </BaseFormField>

      <BaseFormField :label="t('quickCommands.form.tags')">
        <TokenInput
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
        />
      </BaseFormField>

      <section>
        <h3 class="mb-3 text-sm font-medium text-text-secondary">{{ t('quickCommands.form.variablesTitle') }}</h3>
        <div class="space-y-2">
          <p
            v-if="!form.variables.length"
            class="rounded-md border border-dashed border-border/30 p-2 text-sm text-text-alt"
          >
            {{ t('quickCommands.form.noVariables') }}
          </p>
          <div
            v-for="(variable, index) in form.variables"
            :key="index"
            class="space-y-2 rounded-lg border border-border/40 bg-input/30 p-2.5"
          >
            <BaseInput
              v-model="variable.key"
              :data-testid="`quick-command-variable-name-${index}`"
              :placeholder="t('quickCommands.form.variableNamePlaceholder')"
            />
            <BaseInput
              v-model="variable.value"
              :data-testid="`quick-command-variable-value-${index}`"
              :placeholder="t('quickCommands.form.variableValuePlaceholder')"
            />
            <button
              type="button"
              class="w-full rounded-md border border-error/50 px-3 py-1 text-xs text-error transition-colors hover:bg-error/10"
              :title="t('common.delete')"
              @click="form.variables.splice(index, 1)"
            >
              <i class="fas fa-trash-alt mr-1" aria-hidden="true"></i>{{ t('common.delete') }}
            </button>
          </div>
        </div>
        <button
          data-testid="quick-command-variable-add"
          type="button"
          class="mt-3 w-full rounded-md border border-primary/50 px-4 py-2 text-sm text-primary transition-colors hover:bg-primary/10"
          @click="form.variables.push({ key: '', value: '' })"
        >
          <i class="fas fa-plus mr-1" aria-hidden="true"></i>{{ t('quickCommands.form.addVariable') }}
        </button>
      </section>

      <div class="flex justify-end gap-3 border-t border-border pt-4">
        <BaseButton type="button" @click="emit('close')">{{ t('common.cancel') }}</BaseButton>
        <button
          data-testid="quick-command-execute-draft"
          type="button"
          class="execute-action"
          :disabled="!form.command.trim()"
          @click="execute"
        >
          <i class="fas fa-play mr-1" aria-hidden="true"></i>{{ t('quickCommands.form.execute') }}
        </button>
        <BaseButton data-testid="quick-command-submit" type="submit" variant="primary" :disabled="!form.command.trim()">
          {{ t('common.save') }}
        </BaseButton>
      </div>
    </form>
  </BaseModal>
</template>

<style scoped>
  .execute-action {
    border-radius: 0.5rem;
    background: var(--success-color, #28a745);
    padding: 0.5rem 1.25rem;
    color: white;
    font-size: 0.875rem;
    font-weight: 600;
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.18);
    transition:
      opacity 0.15s ease,
      filter 0.15s ease;
  }
  .execute-action:hover:not(:disabled) {
    filter: brightness(0.95);
  }
  .execute-action:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
