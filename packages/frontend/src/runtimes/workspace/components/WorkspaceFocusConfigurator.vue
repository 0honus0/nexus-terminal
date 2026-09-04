<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseInput, BaseModal } from '@/foundation/ui';
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
    panel-class="w-[min(760px,94vw)]"
    @close="attemptClose"
  >
    <div class="space-y-4">
      <p class="text-sm text-text-secondary">{{ t('focusSwitcher.altSwitchHint') }}</p>
      <ul class="divide-y divide-border rounded border border-border">
        <li
          v-for="id in workspaceFocusTargets"
          :key="id"
          class="grid gap-2 p-3 md:grid-cols-[1fr_auto_14rem] md:items-center"
        >
          <label class="flex items-center gap-2"
            ><BaseCheckbox :model-value="enabled(id)" @update:model-value="setEnabled(id, $event)" />{{
              t(`focusSwitcher.input.${id}`)
            }}</label
          >
          <div class="flex gap-1">
            <BaseButton size="sm" :disabled="!enabled(id)" @click="move(id, -1)">↑</BaseButton
            ><BaseButton size="sm" :disabled="!enabled(id)" @click="move(id, 1)">↓</BaseButton>
          </div>
          <BaseInput
            :model-value="shortcut(id)"
            size="sm"
            readonly
            :placeholder="t('focusSwitcher.shortcutPlaceholder')"
            @keydown.prevent="captureShortcut($event, id)"
          />
        </li>
      </ul>
      <div class="flex justify-end gap-2">
        <BaseButton @click="attemptClose">{{ t('common.cancel') }}</BaseButton
        ><BaseButton variant="primary" :loading="saving" :disabled="!hasChanges" @click="save">{{
          t('common.save')
        }}</BaseButton>
      </div>
    </div>
  </BaseModal>
</template>
