<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput, BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import {
    normalizeWorkspaceFocusShortcut,
    workspaceFocus,
    workspaceFocusTargets,
    type WorkspaceFocusConfig,
  } from '../focus/workspaceFocus';

  const props = defineProps<{ visible: boolean }>();
  const emit = defineEmits<{ close: [] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const draft = ref<WorkspaceFocusConfig>({ sequence: [], shortcuts: {} });
  const original = ref<WorkspaceFocusConfig>({ sequence: [], shortcuts: {} });
  const saving = ref(false);
  const draggingTarget = ref<string | null>(null);
  const hasChanges = computed(() => JSON.stringify(draft.value) !== JSON.stringify(original.value));

  watch(
    () => props.visible,
    (visible) => {
      if (!visible) return;
      draft.value = structuredClone(workspaceFocus.config.value);
      original.value = structuredClone(workspaceFocus.config.value);
    },
    { immediate: true },
  );

  const availableTargets = computed(() => workspaceFocusTargets.filter((id) => !draft.value.sequence.includes(id)));
  const enabled = (id: string) => draft.value.sequence.includes(id);
  const setEnabled = (id: string, value: boolean) => {
    if (value && !enabled(id)) draft.value.sequence.push(id);
    if (!value) draft.value.sequence = draft.value.sequence.filter((item) => item !== id);
  };
  const move = (id: string, delta: number) => {
    const index = draft.value.sequence.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= draft.value.sequence.length) return;
    const next = [...draft.value.sequence];
    [next[index], next[target]] = [next[target]!, next[index]!];
    draft.value.sequence = next;
  };
  const startDrag = (event: DragEvent, id: string) => {
    draggingTarget.value = id;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', id);
    }
  };
  const clearDrag = () => {
    draggingTarget.value = null;
  };
  const dropIntoSequence = (beforeId?: string) => {
    const id = draggingTarget.value;
    if (!id || !workspaceFocusTargets.includes(id as (typeof workspaceFocusTargets)[number])) return;
    const next = draft.value.sequence.filter((item) => item !== id);
    if (beforeId) {
      const index = next.indexOf(beforeId);
      if (index >= 0) next.splice(index, 0, id);
      else next.push(id);
    } else next.push(id);
    draft.value.sequence = next;
    draggingTarget.value = null;
  };
  const dropIntoAvailable = () => {
    const id = draggingTarget.value;
    if (!id) return;
    setEnabled(id, false);
    draggingTarget.value = null;
  };
  const shortcut = (id: string) => draft.value.shortcuts[id]?.shortcut ?? '';
  const captureShortcut = (event: KeyboardEvent, id: string) => {
    if (event.key === 'Backspace' || event.key === 'Delete') {
      delete draft.value.shortcuts[id];
      return;
    }
    if (['Alt', 'Control', 'Shift', 'Meta'].includes(event.key)) return;
    if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) return;
    const normalized = normalizeWorkspaceFocusShortcut(`Alt+${event.key}`);
    if (normalized) draft.value.shortcuts[id] = { shortcut: normalized };
  };
  const attemptClose = async () => {
    if (hasChanges.value) {
      const confirmed = await feedback.confirm({ message: t('focusSwitcher.confirmClose') });
      if (!confirmed) return;
    }
    emit('close');
  };
  const save = async () => {
    saving.value = true;
    try {
      await workspaceFocus.save(structuredClone(draft.value));
      original.value = structuredClone(draft.value);
      emit('close');
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saving.value = false;
    }
  };
</script>

<template>
  <BaseModal
    :visible="visible"
    :title="t('focusSwitcher.configTitle')"
    panel-class="w-[min(900px,95vw)] max-h-[90dvh]"
    content-class="!py-0"
    @close="attemptClose"
  >
    <div class="flex min-h-0 flex-col gap-6 overflow-y-auto py-6">
      <p class="text-sm italic text-text-secondary">{{ t('focusSwitcher.altSwitchHint') }}</p>

      <div class="flex min-h-[300px] gap-6">
        <section
          class="flex min-w-0 flex-1 flex-col overflow-y-auto rounded border border-border bg-input p-4"
          @dragover.prevent
          @drop.prevent="dropIntoAvailable"
        >
          <h3 class="mb-4 border-b border-border pb-2 text-base font-semibold text-text-secondary">
            {{ t('focusSwitcher.availableInputs') }}
          </h3>
          <ul
            class="m-0 min-h-[100px] flex-grow list-none space-y-2 rounded border border-dashed border-border bg-background/50 p-2"
          >
            <li
              v-for="id in availableTargets"
              :key="id"
              draggable="true"
              class="flex cursor-grab items-center gap-2 overflow-hidden rounded border border-border bg-background p-2 text-sm transition-colors hover:bg-header active:cursor-grabbing"
              :class="{ 'opacity-50': draggingTarget === id }"
              @dragstart="startDrag($event, id)"
              @dragend="clearDrag"
            >
              <i class="fas fa-grip-vertical shrink-0 text-text-secondary" aria-hidden="true"></i>
              <span class="min-w-0 flex-1 truncate">{{ t(`focusSwitcher.input.${id}`) }}</span>
              <button
                type="button"
                class="focus-action"
                :title="t('focusSwitcher.configuredSequence')"
                @click="setEnabled(id, true)"
              >
                <i class="fas fa-plus" aria-hidden="true"></i>
              </button>
            </li>
            <li v-if="!availableTargets.length" class="p-4 text-center text-sm italic text-text-secondary">
              {{ t('focusSwitcher.allInputsConfigured') }}
            </li>
          </ul>
        </section>

        <section
          class="flex min-w-0 flex-1 flex-col overflow-y-auto rounded border border-border bg-input p-4"
          @dragover.prevent
          @drop.prevent="dropIntoSequence()"
        >
          <h3 class="mb-4 border-b border-border pb-2 text-base font-semibold text-text-secondary">
            {{ t('focusSwitcher.configuredSequence') }}
          </h3>
          <ul
            class="m-0 min-h-[100px] flex-grow list-none space-y-2 rounded border border-dashed border-border bg-background/50 p-2"
          >
            <li
              v-for="(id, index) in draft.sequence"
              :key="id"
              draggable="true"
              class="flex cursor-grab items-center gap-2 overflow-hidden rounded border border-border bg-background p-2 text-sm transition-colors hover:bg-header active:cursor-grabbing"
              :class="{ 'opacity-50': draggingTarget === id }"
              @dragstart="startDrag($event, id)"
              @dragend="clearDrag"
              @dragover.prevent.stop
              @drop.prevent.stop="dropIntoSequence(id)"
            >
              <i class="fas fa-grip-vertical shrink-0 text-text-secondary" aria-hidden="true"></i>
              <span class="min-w-0 flex-1 truncate">{{ t(`focusSwitcher.input.${id}`) }}</span>
              <button type="button" class="focus-action" :disabled="index === 0" @click="move(id, -1)">
                <i class="fas fa-arrow-up" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                class="focus-action"
                :disabled="index === draft.sequence.length - 1"
                @click="move(id, 1)"
              >
                <i class="fas fa-arrow-down" aria-hidden="true"></i>
              </button>
              <button type="button" class="focus-action focus-action--danger" @click="setEnabled(id, false)">×</button>
            </li>
            <li v-if="!draft.sequence.length" class="p-4 text-center text-sm italic text-text-secondary">
              {{ t('focusSwitcher.dragHere') }}
            </li>
          </ul>
        </section>
      </div>

      <section class="max-h-64 overflow-y-auto rounded border border-border bg-input p-4">
        <h3 class="mb-4 border-b border-border pb-2 text-base font-semibold text-text-secondary">
          {{ t('focusSwitcher.shortcutSettings') }}
        </h3>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          <div
            v-for="id in workspaceFocusTargets"
            :key="id"
            class="flex items-center justify-between gap-3 rounded border border-border/50 bg-input p-2"
          >
            <span class="min-w-0 flex-1 truncate text-sm">{{ t(`focusSwitcher.input.${id}`) }}</span>
            <BaseInput
              :model-value="shortcut(id)"
              class="w-28 shrink-0 text-center text-xs italic"
              readonly
              :placeholder="t('focusSwitcher.shortcutPlaceholder')"
              @keydown.prevent="captureShortcut($event, id)"
            />
          </div>
          <p
            v-if="!workspaceFocusTargets.length"
            class="col-span-full p-4 text-center text-sm italic text-text-secondary"
          >
            {{ t('focusSwitcher.noInputsAvailable') }}
          </p>
        </div>
      </section>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3">
        <BaseButton @click="attemptClose">{{ t('common.cancel') }}</BaseButton>
        <BaseButton variant="primary" :loading="saving" :disabled="!hasChanges" @click="save">
          {{ t('common.save') }}{{ hasChanges ? ' *' : '' }}
        </BaseButton>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
  .focus-action {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 1.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: var(--text-secondary-color);
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .focus-action:hover:not(:disabled) {
    background: var(--border-color);
    color: var(--text-color);
  }
  .focus-action:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }
  .focus-action--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--error-color) 12%, transparent);
    color: var(--error-color);
  }
</style>
