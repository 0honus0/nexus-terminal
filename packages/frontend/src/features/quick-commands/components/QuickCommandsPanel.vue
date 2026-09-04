<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseContextMenu, BaseInput, BaseSelect, BaseSpinner } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry } from '@/shared/focus/public';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  import QuickCommandForm from './QuickCommandForm.vue';
  import { useQuickCommandsStore } from '../store/quickCommands.store';
  import type { ExecuteCommandIntent, QuickCommand, QuickCommandInput } from '../model/quickCommand';

  type DisplayMode = 'name' | 'command';
  const DISPLAY_MODE_KEY = 'quickCommandsDisplayMode';
  const props = withDefaults(
    defineProps<{ collapsibleSearch?: boolean; showTags?: boolean; rowScale?: number; compact?: boolean }>(),
    { collapsibleSearch: false, showTags: true, rowScale: 1, compact: false },
  );
  const emit = defineEmits<{
    execute: [intent: ExecuteCommandIntent];
    rowScale: [scale: number];
    compactMode: [compact: boolean];
  }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const store = useQuickCommandsStore();
  const { groups, flat, tags, search, sort, loading, expanded, selectedId } = storeToRefs(store);
  const localScale = ref(props.rowScale);
  const visible = ref(false);
  const editing = ref<QuickCommand | null>(null);
  const searchInput = ref<{ focus?: () => void } | null>(null);
  const searchExpanded = ref(!props.collapsibleSearch);
  const root = ref<HTMLElement | null>(null);
  const context = ref<{ command: QuickCommand; x: number; y: number } | null>(null);
  const editingTagId = ref<number | 'untagged' | null>(null);
  const tagDraft = ref('');
  let unregisterFocus: (() => void) | undefined;

  const readDisplayMode = (): DisplayMode => {
    try {
      return localStorage.getItem(DISPLAY_MODE_KEY) === 'name' ? 'name' : 'command';
    } catch {
      return 'command';
    }
  };
  const displayMode = ref<DisplayMode>(readDisplayMode());
  const resolveScale = createWheelScaleResolver({
    min: 0.5,
    max: 2.5,
    step: 0.12,
    precision: 2,
    thresholdPx: 64,
    maxStepsPerEvent: 3,
    stopImmediatePropagation: true,
  });
  const rowStyle = computed(() => ({ '--quick-row-scale': localScale.value }));
  const rowClass = computed(() => (props.compact ? 'py-1.5' : 'py-3'));

  watch(
    () => props.rowScale,
    (value) => {
      if (Number.isFinite(value)) localScale.value = value;
    },
  );
  watch(
    () => props.collapsibleSearch,
    (enabled) => {
      if (!enabled) searchExpanded.value = true;
    },
  );

  const openSearch = async (): Promise<boolean> => {
    searchExpanded.value = true;
    await nextTick();
    searchInput.value?.focus?.();
    return true;
  };

  onMounted(() => {
    void store.load();
    unregisterFocus = focusRegistry.register('quickCommandsSearch', openSearch, () =>
      Boolean(root.value?.getClientRects().length),
    );
  });
  onBeforeUnmount(() => unregisterFocus?.());

  const scaleRows = (event: WheelEvent) => {
    const change = resolveScale(event, localScale.value);
    if (!change) return;
    localScale.value = change.next;
    emit('rowScale', change.next);
  };
  const toggleDisplayMode = () => {
    displayMode.value = displayMode.value === 'name' ? 'command' : 'name';
    try {
      localStorage.setItem(DISPLAY_MODE_KEY, displayMode.value);
    } catch {
      // Display preference may remain in memory when storage is unavailable.
    }
  };
  const revealSelected = () => {
    const id = selectedId.value;
    if (id === null) return;
    root.value?.querySelector<HTMLElement>(`[data-command-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  const handleSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && props.collapsibleSearch && !search.value) {
      event.preventDefault();
      searchExpanded.value = false;
      store.resetSelection();
      return;
    }
    const candidates = props.showTags ? store.visible : store.flat;
    if (!candidates.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      store.selectNext(props.showTags);
      revealSelected();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      store.selectPrevious(props.showTags);
      revealSelected();
      return;
    }
    if (event.key === 'Enter') {
      const command = candidates.find((item) => item.id === selectedId.value);
      if (!command) return;
      event.preventDefault();
      run(command);
    }
  };
  const handleSearchBlur = () => {
    window.setTimeout(() => {
      if (!root.value?.contains(document.activeElement)) store.resetSelection();
    }, 0);
  };
  const startTagEdit = (group: { id: number | null; name: string }) => {
    editingTagId.value = group.id ?? 'untagged';
    tagDraft.value = group.id === null ? '' : group.name;
  };
  const cancelTagEdit = () => {
    editingTagId.value = null;
    tagDraft.value = '';
  };
  const finishTagEdit = async (group: { id: number | null; name: string; commands: QuickCommand[] }) => {
    const editing = editingTagId.value;
    if (editing === null) return;
    const name = tagDraft.value.trim();
    cancelTagEdit();
    if (!name) return;
    try {
      if (editing === 'untagged') {
        const result = await store.createTagForCommands(
          name,
          group.commands.map((command) => command.id),
        );
        if (!result.assigned) {
          feedback.notifyWarning(
            t('quickCommands.tags.assignFailedAfterCreate', { name: result.tag.name, error: result.error ?? '' }),
          );
        }
      } else if (name !== group.name) await store.renameTag(editing, name);
    } catch (cause) {
      feedback.notifyError(
        t(editing === 'untagged' ? 'quickCommands.tags.createFailed' : 'quickCommands.tags.renameFailed', {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  };
  const displayText = (command: QuickCommand) =>
    displayMode.value === 'name' ? command.name?.trim() || command.command : command.command;
  const secondaryText = (command: QuickCommand) =>
    displayMode.value === 'name' ? command.command : command.name?.trim() || '';

  const edit = (command: QuickCommand) => {
    editing.value = command;
    visible.value = true;
  };
  const add = () => {
    editing.value = null;
    visible.value = true;
  };
  const save = async (input: QuickCommandInput) => {
    await store.save(input, editing.value?.id);
    visible.value = false;
  };
  const processCommand = (commandDefinition: QuickCommand) => {
    let command = commandDefinition.command;
    for (const [name, value] of Object.entries(commandDefinition.variables)) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      command = command.replace(new RegExp(`\\$\\{${escaped}\\}`, 'g'), value);
    }
    const unresolved = [...command.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]).filter(Boolean);
    if (unresolved.length) {
      feedback.notifyWarning(
        t('quickCommands.form.warningUndefinedVariables', { variables: [...new Set(unresolved)].join(', ') }),
      );
    }
    return command;
  };
  const run = (command: QuickCommand, all = false) => {
    context.value = null;
    emit('execute', { command: processCommand(command), sourceId: command.id, allSessions: all });
    void store.recordUsage(command.id);
  };
  const copy = async (command: QuickCommand) => {
    context.value = null;
    try {
      await writeClipboardText(command.command);
      feedback.notifySuccess(t('quickCommands.notifications.copied'));
    } catch {
      feedback.notifyError(t('quickCommands.notifications.copyFailed'));
    }
  };
  const remove = async (command: QuickCommand) => {
    context.value = null;
    if (
      await feedback.confirm({
        message: t('quickCommands.confirmDelete', { name: command.name ?? command.command }),
        destructive: true,
      })
    ) {
      await store.remove(command.id);
    }
  };
  const openContext = (event: MouseEvent, command: QuickCommand) => {
    selectedId.value = command.id;
    context.value = { command, x: event.clientX, y: event.clientY };
  };
</script>

<template>
  <section ref="root" data-testid="quick-commands-view" class="flex min-h-0 flex-1 flex-col">
    <div class="flex flex-wrap gap-2 border-b border-border p-3">
      <BaseButton
        v-if="collapsibleSearch && !searchExpanded"
        data-testid="quick-command-search-toggle"
        size="sm"
        @click="openSearch"
        >⌕</BaseButton
      >
      <BaseInput
        v-if="searchExpanded"
        ref="searchInput"
        v-model="search"
        data-testid="quick-command-search"
        class="min-w-36 flex-1"
        :placeholder="t('quickCommands.searchPlaceholder')"
        @keydown="handleSearchKeydown"
        @blur="handleSearchBlur"
      />
      <BaseSelect v-model="sort" class="min-w-32">
        <option value="name">{{ t('quickCommands.sortByName') }}</option>
        <option value="usageCount">{{ t('quickCommands.sortByUsage') }}</option>
        <option value="lastUsed">{{ t('quickCommands.sortByLastUsed') }}</option>
      </BaseSelect>
      <BaseButton
        size="sm"
        :title="t(displayMode === 'name' ? 'quickCommands.switchToCommand' : 'quickCommands.switchToName')"
        @click="toggleDisplayMode"
        >{{ displayMode === 'name' ? t('quickCommands.displayName') : t('quickCommands.displayCommand') }}</BaseButton
      >
      <BaseButton size="sm" :variant="compact ? 'primary' : 'ghost'" @click="emit('compactMode', !compact)">{{
        t('quickCommands.compactMode')
      }}</BaseButton>
      <BaseButton data-testid="quick-command-add" variant="primary" @click="add">{{
        t('quickCommands.add')
      }}</BaseButton>
    </div>

    <BaseSpinner v-if="loading" class="m-6" />
    <div
      v-else
      data-testid="quick-command-list"
      class="min-h-0 flex-1 overflow-auto p-3"
      :style="rowStyle"
      :data-row-scale="localScale.toFixed(2)"
      @wheel="scaleRows"
    >
      <p v-if="!(showTags ? groups.length : flat.length)" class="p-6 text-center text-text-secondary">
        {{ t('quickCommands.empty') }}
      </p>

      <template v-if="showTags">
        <section
          v-for="group in groups"
          :key="group.id ?? 'untagged'"
          :data-testid="`quick-command-group-${group.id ?? 'untagged'}`"
          class="mb-3 rounded border border-border"
        >
          <div class="flex items-center gap-2 bg-header/50 px-3 py-2 font-medium">
            <BaseInput
              v-if="editingTagId === (group.id ?? 'untagged')"
              v-model="tagDraft"
              data-testid="quick-command-group-rename-input"
              class="min-w-0 flex-1"
              autofocus
              :placeholder="
                group.id === null ? t('quickCommands.tags.createFromUntagged') : t('quickCommands.tags.renameHint')
              "
              @keyup.enter.stop="finishTagEdit(group)"
              @keyup.esc.stop="cancelTagEdit"
              @blur="finishTagEdit(group)"
            />
            <button
              v-else
              type="button"
              data-testid="quick-command-group-name"
              class="min-w-0 flex-1 truncate text-left hover:text-primary"
              :title="
                group.id === null ? t('quickCommands.tags.createFromUntagged') : t('quickCommands.tags.clickToEditTag')
              "
              @click.stop="startTagEdit(group)"
            >
              {{ group.id === null ? t('quickCommands.untagged') : group.name }}
            </button>
            <button
              type="button"
              class="shrink-0 rounded px-2 py-1 hover:bg-primary/10"
              :aria-expanded="expanded[group.name] !== false"
              @click="store.toggle(group.name)"
            >
              {{ expanded[group.name] === false ? '▸' : '▾' }}
            </button>
          </div>
          <ul v-if="expanded[group.name] !== false" class="divide-y divide-border">
            <li
              v-for="command in group.commands"
              :key="command.id"
              :data-command-id="command.id"
              :class="[
                'quick-command-row flex flex-wrap items-center gap-2 px-3',
                rowClass,
                selectedId === command.id ? 'bg-primary/10' : '',
              ]"
              @contextmenu.prevent="openContext($event, command)"
            >
              <button data-testid="quick-command-execute" class="min-w-32 flex-1 text-left" @click="run(command)">
                <span class="block truncate font-medium">{{ displayText(command) }}</span>
                <code v-if="!compact && secondaryText(command)" class="block truncate text-xs text-text-secondary">{{
                  secondaryText(command)
                }}</code>
              </button>
              <span v-if="!compact" class="text-xs text-text-secondary">{{ command.usageCount }}</span>
              <BaseButton size="sm" variant="ghost" @click="copy(command)">{{
                t('quickCommands.actions.copy')
              }}</BaseButton>
              <BaseButton size="sm" @click="run(command, true)">{{ t('common.all') }}</BaseButton>
              <BaseButton size="sm" @click="edit(command)">{{ t('common.edit') }}</BaseButton>
              <BaseButton size="sm" variant="danger" @click="remove(command)">{{ t('common.delete') }}</BaseButton>
            </li>
          </ul>
        </section>
      </template>

      <ul v-else class="divide-y divide-border rounded border border-border">
        <li
          v-for="command in flat"
          :key="command.id"
          :data-command-id="command.id"
          :class="[
            'quick-command-row flex flex-wrap items-center gap-2 px-3',
            rowClass,
            selectedId === command.id ? 'bg-primary/10' : '',
          ]"
          @contextmenu.prevent="openContext($event, command)"
        >
          <button data-testid="quick-command-execute" class="min-w-32 flex-1 text-left" @click="run(command)">
            <span class="block truncate font-medium">{{ displayText(command) }}</span>
            <code v-if="!compact && secondaryText(command)" class="block truncate text-xs text-text-secondary">{{
              secondaryText(command)
            }}</code>
          </button>
          <span v-if="!compact" class="text-xs text-text-secondary">{{ command.usageCount }}</span>
          <BaseButton size="sm" variant="ghost" @click="copy(command)">{{
            t('quickCommands.actions.copy')
          }}</BaseButton>
          <BaseButton size="sm" @click="run(command, true)">{{ t('common.all') }}</BaseButton>
          <BaseButton size="sm" @click="edit(command)">{{ t('common.edit') }}</BaseButton>
          <BaseButton size="sm" variant="danger" @click="remove(command)">{{ t('common.delete') }}</BaseButton>
        </li>
      </ul>
    </div>

    <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="210" @close="context = null">
      <button class="context-item" @click="copy(context.command)">{{ t('quickCommands.actions.copy') }}</button>
      <button class="context-item" @click="run(context.command)">{{ t('quickCommands.form.execute') }}</button>
      <button class="context-item" @click="run(context.command, true)">
        {{ t('quickCommands.actions.sendToAllSessions') }}
      </button>
      <button
        class="context-item"
        @click="
          edit(context.command);
          context = null;
        "
      >
        {{ t('common.edit') }}
      </button>
      <button class="context-item text-error" @click="remove(context.command)">{{ t('common.delete') }}</button>
    </BaseContextMenu>

    <QuickCommandForm :visible="visible" :command="editing" :tags="tags" @close="visible = false" @save="save" />
  </section>
</template>

<style scoped>
  .quick-command-row {
    padding-top: calc(var(--quick-row-scale) * 0.5rem);
    padding-bottom: calc(var(--quick-row-scale) * 0.5rem);
  }
  .context-item {
    display: block;
    width: 100%;
    border-radius: 0.25rem;
    padding: 0.4rem 0.55rem;
    text-align: left;
  }
  .context-item:hover {
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  }
</style>
