<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useFeedback } from '@/shared/feedback/public';
  import { useResizeHandle } from '@/foundation/interaction';
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

  const LEGACY_MIN_WIDTH = 800;
  const LEGACY_MIN_HEIGHT = 700;
  const VIEWPORT_GAP = 32;
  const availableWidth = () => Math.max(1, window.innerWidth - VIEWPORT_GAP);
  const availableHeight = () => Math.max(1, window.innerHeight - VIEWPORT_GAP);
  const minWidth = () => Math.min(LEGACY_MIN_WIDTH, availableWidth());
  const minHeight = () => Math.min(LEGACY_MIN_HEIGHT, availableHeight());
  const defaultWidth = () => Math.min(1152, window.innerWidth * 0.9, availableWidth());
  const defaultHeight = () => Math.min(window.innerHeight * 0.85, availableHeight());
  const desktopResizable = ref(typeof window !== 'undefined' && window.innerWidth >= 768);
  const dialogWidth = ref(typeof window === 'undefined' ? 1152 : defaultWidth());
  const dialogHeight = ref(typeof window === 'undefined' ? LEGACY_MIN_HEIGHT : Math.max(minHeight(), defaultHeight()));
  const resetDialogSize = () => {
    dialogWidth.value = Math.max(minWidth(), defaultWidth());
    dialogHeight.value = Math.max(minHeight(), defaultHeight());
  };
  const clampDialogSize = () => {
    desktopResizable.value = window.innerWidth >= 768;
    dialogWidth.value = Math.min(availableWidth(), Math.max(minWidth(), dialogWidth.value));
    dialogHeight.value = Math.min(availableHeight(), Math.max(minHeight(), dialogHeight.value));
  };
  const dialogStyle = computed(() =>
    desktopResizable.value
      ? {
          width: `${dialogWidth.value}px`,
          height: `${dialogHeight.value}px`,
          maxWidth: `${availableWidth()}px`,
          maxHeight: `${availableHeight()}px`,
        }
      : {
          width: 'min(1152px, 90vw, calc(100vw - 2rem))',
          maxWidth: 'min(1152px, 90vw, calc(100vw - 2rem))',
          maxHeight: '90dvh',
        },
  );
  const resizeOptions = (widthDirection: 1 | -1 | 0, heightDirection: 1 | -1 | 0) =>
    useResizeHandle({
      width: dialogWidth,
      height: dialogHeight,
      minWidth,
      minHeight,
      maxWidth: availableWidth,
      maxHeight: availableHeight,
      widthDirection: widthDirection === 0 ? 1 : widthDirection,
      heightDirection: heightDirection === 0 ? 1 : heightDirection,
      widthMultiplier: widthDirection === 0 ? 0 : 1,
      heightMultiplier: heightDirection === 0 ? 0 : 1,
      canStart: () => desktopResizable.value,
    });
  const resizeTop = resizeOptions(0, -1);
  const resizeRight = resizeOptions(1, 0);
  const resizeBottom = resizeOptions(0, 1);
  const resizeLeft = resizeOptions(-1, 0);
  const resizeTopLeft = resizeOptions(-1, -1);
  const resizeTopRight = resizeOptions(1, -1);
  const resizeBottomRight = resizeOptions(1, 1);
  const resizeBottomLeft = resizeOptions(-1, 1);
  onMounted(() => window.addEventListener('resize', clampDialogSize));
  onBeforeUnmount(() => window.removeEventListener('resize', clampDialogSize));

  const form = reactive({
    name: '',
    command: '',
    tagIds: [] as number[],
    variables: [] as Array<{ key: string; value: string }>,
  });

  watch(
    () => [props.visible, props.command] as const,
    ([visible]) => {
      if (visible) resetDialogSize();
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
    try {
      const tag = existing ?? (await store.addTag(normalized));
      if (!form.tagIds.includes(tag.id)) form.tagIds = [...form.tagIds, tag.id];
    } catch (cause) {
      feedback.notifyError(
        t('quickCommands.tags.createTagFailed', {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
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
  const save = () => {
    const input = toInput();
    if (!input.command) return;
    emit('save', input);
  };
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
    panel-class="!max-h-none !max-w-none"
    :panel-style="dialogStyle"
    content-class="!py-0"
    :close-on-backdrop="false"
    :close-on-escape="true"
    @close="emit('close')"
  >
    <template v-if="visible">
      <div
        data-testid="quick-command-resize-top"
        class="quick-resize quick-resize--top"
        @pointerdown="resizeTop.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-right"
        class="quick-resize quick-resize--right"
        @pointerdown="resizeRight.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-bottom"
        class="quick-resize quick-resize--bottom"
        @pointerdown="resizeBottom.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-left"
        class="quick-resize quick-resize--left"
        @pointerdown="resizeLeft.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-top-left"
        class="quick-resize quick-resize--top-left"
        @pointerdown="resizeTopLeft.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-top-right"
        class="quick-resize quick-resize--top-right"
        @pointerdown="resizeTopRight.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-bottom-right"
        class="quick-resize quick-resize--bottom-right"
        @pointerdown="resizeBottomRight.startResize"
      ></div>
      <div
        data-testid="quick-command-resize-bottom-left"
        class="quick-resize quick-resize--bottom-left"
        @pointerdown="resizeBottomLeft.startResize"
      ></div>
    </template>
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
              @keydown.enter.prevent.stop
            />
            <BaseTextarea
              v-model="variable.value"
              :data-testid="`quick-command-variable-value-${index}`"
              rows="2"
              class="min-h-[40px] resize-y"
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
    background: var(--status-success-color, #28a745);
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
  .quick-resize {
    position: absolute;
    z-index: 20;
  }
  .quick-resize--top,
  .quick-resize--bottom {
    left: 10px;
    right: 10px;
    height: 10px;
    cursor: ns-resize;
  }
  .quick-resize--top {
    top: -5px;
  }
  .quick-resize--bottom {
    bottom: -5px;
  }
  .quick-resize--left,
  .quick-resize--right {
    top: 10px;
    bottom: 10px;
    width: 10px;
    cursor: ew-resize;
  }
  .quick-resize--left {
    left: -5px;
  }
  .quick-resize--right {
    right: -5px;
  }
  .quick-resize--top-left,
  .quick-resize--top-right,
  .quick-resize--bottom-right,
  .quick-resize--bottom-left {
    width: 14px;
    height: 14px;
  }
  .quick-resize--top-left {
    top: -7px;
    left: -7px;
    cursor: nwse-resize;
  }
  .quick-resize--top-right {
    top: -7px;
    right: -7px;
    cursor: nesw-resize;
  }
  .quick-resize--bottom-right {
    right: -7px;
    bottom: -7px;
    cursor: nwse-resize;
  }
  .quick-resize--bottom-left {
    bottom: -7px;
    left: -7px;
    cursor: nesw-resize;
  }
  @media (max-width: 767px) {
    .quick-resize {
      display: none;
    }
  }
</style>
