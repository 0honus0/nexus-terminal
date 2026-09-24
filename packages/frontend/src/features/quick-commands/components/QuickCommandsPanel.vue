<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu, BaseInput } from '@/foundation/ui';
  import { writeClipboardText } from '@/foundation/browser';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry } from '@/shared/focus/public';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  import QuickCommandForm from './QuickCommandForm.vue';
  import { useQuickCommandsStore } from '../store/quickCommands.store';
  import { expandQuickCommand } from '../model/quickCommand';
  import type { ExecuteCommandIntent, QuickCommandDto, QuickCommandFormInput } from '../model/quickCommand';

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
  const { groups, flat, tags, search, sort, loading, error, tagLoadError, expanded, selectedId } = storeToRefs(store);
  const localScale = ref(props.rowScale);
  const visible = ref(false);
  const editing = ref<QuickCommandDto | null>(null);
  const searchInput = ref<HTMLInputElement | null>(null);
  const searchExpanded = ref(!props.collapsibleSearch);
  const root = ref<HTMLElement | null>(null);
  const list = ref<HTMLElement | null>(null);
  const context = ref<{ command: QuickCommandDto; x: number; y: number } | null>(null);
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

  watch(
    () => props.rowScale,
    (value) => {
      if (Number.isFinite(value)) localScale.value = value;
    },
  );
  watch(
    () => props.collapsibleSearch,
    (enabled) => {
      searchExpanded.value = !enabled || Boolean(search.value);
    },
  );

  const openSearch = async (): Promise<boolean> => {
    searchExpanded.value = true;
    await nextTick();
    searchInput.value?.focus?.();
    return true;
  };

  onMounted(() => {
    void store.load().catch(() => undefined);
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
  const cycleSort = () => {
    sort.value = sort.value === 'name' ? 'usageCount' : sort.value === 'usageCount' ? 'lastUsed' : 'name';
  };
  const sortButtonIcon = computed(() =>
    sort.value === 'name'
      ? 'fas fa-sort-alpha-down'
      : sort.value === 'usageCount'
        ? 'fas fa-sort-amount-down'
        : 'fas fa-clock',
  );
  const sortButtonTitle = computed(() =>
    t(
      sort.value === 'name'
        ? 'quickCommands.sortByName'
        : sort.value === 'usageCount'
          ? 'quickCommands.sortByUsage'
          : 'quickCommands.sortByLastUsed',
    ),
  );
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
      if (document.activeElement !== searchInput.value && !list.value?.contains(document.activeElement)) {
        store.resetSelection();
        if (props.collapsibleSearch && !search.value) searchExpanded.value = false;
      }
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
  const finishTagEdit = async (group: { id: number | null; name: string; commands: QuickCommandDto[] }) => {
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
  const displayText = (command: QuickCommandDto) =>
    displayMode.value === 'name' ? command.name?.trim() || command.command : command.command;
  const secondaryText = (command: QuickCommandDto) =>
    displayMode.value === 'name' ? command.command : command.name?.trim() || '';

  const edit = (command: QuickCommandDto) => {
    editing.value = command;
    visible.value = true;
  };
  const add = () => {
    editing.value = null;
    visible.value = true;
  };
  const save = async (input: QuickCommandFormInput) => {
    try {
      await store.save(input, editing.value?.id);
      visible.value = false;
    } catch (cause) {
      feedback.notifyError(
        t('quickCommands.notifications.saveFailed', {
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      );
    }
  };
  const processTemplate = (template: string, variables: Record<string, string>) => {
    const expansion = expandQuickCommand(template, variables);
    if (expansion.unresolvedVariables.length) {
      feedback.notifyWarning(
        t('quickCommands.form.warningUndefinedVariables', {
          variables: expansion.unresolvedVariables.join(', '),
        }),
      );
    }
    return expansion.command;
  };
  const processCommand = (commandDefinition: QuickCommandDto) =>
    processTemplate(commandDefinition.command, commandDefinition.variables);
  const executeDraft = (input: QuickCommandFormInput) => {
    emit('execute', { command: processTemplate(input.command, input.variables) });
    visible.value = false;
  };
  const run = (command: QuickCommandDto, all = false) => {
    context.value = null;
    emit('execute', { command: processCommand(command), sourceId: command.id, allSessions: all });
    void store.recordUsage(command.id);
  };
  const copy = async (command: QuickCommandDto) => {
    context.value = null;
    try {
      await writeClipboardText(command.command);
      feedback.notifySuccess(t('quickCommands.notifications.copied'));
    } catch {
      feedback.notifyError(t('quickCommands.notifications.copyFailed'));
    }
  };
  const remove = async (command: QuickCommandDto) => {
    context.value = null;
    if (
      await feedback.confirm({
        message: t('quickCommands.confirmDelete', { name: command.name ?? command.command }),
        destructive: true,
      })
    ) {
      try {
        await store.remove(command.id);
      } catch (cause) {
        feedback.notifyError(
          t('quickCommands.notifications.deleteFailed', {
            error: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    }
  };
  const openContext = (event: MouseEvent, command: QuickCommandDto) => {
    selectedId.value = command.id;
    context.value = { command, x: event.clientX, y: event.clientY };
  };
</script>

<template>
  <section
    ref="root"
    data-testid="quick-commands-view"
    class="quick-commands-root flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
  >
    <div
      class="quick-commands-controls flex shrink-0 items-center gap-2 border-b border-border/40 bg-background/80 px-2 py-1.5"
    >
      <button
        v-if="collapsibleSearch && !searchExpanded"
        data-testid="quick-command-search-toggle"
        type="button"
        class="quick-control"
        :title="t('quickCommands.expandSearch')"
        :aria-label="t('quickCommands.expandSearch')"
        @click="openSearch"
      >
        <i class="fas fa-search" aria-hidden="true"></i>
      </button>
      <input
        v-if="searchExpanded"
        ref="searchInput"
        v-model="search"
        data-testid="quick-command-search"
        data-focus-id="quickCommandsSearch"
        type="text"
        :placeholder="t('quickCommands.searchPlaceholder')"
        class="quick-commands-search min-w-0 flex-1 rounded-lg border border-border/50 bg-input px-4 py-1.5 text-sm text-foreground shadow-sm transition duration-150 ease-in-out focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
        @keydown="handleSearchKeydown"
        @blur="handleSearchBlur"
      />
      <button
        type="button"
        class="quick-control"
        :title="sortButtonTitle"
        :aria-label="sortButtonTitle"
        @click="cycleSort"
      >
        <i :class="sortButtonIcon" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="quick-control"
        :class="{ 'bg-primary/20 text-primary': compact }"
        :title="t('quickCommands.compactMode')"
        :aria-label="t('quickCommands.compactMode')"
        @click="emit('compactMode', !compact)"
      >
        <i :class="['fas', compact ? 'fa-compress-alt' : 'fa-expand-alt']" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        class="quick-control"
        :title="t(displayMode === 'name' ? 'quickCommands.switchToCommand' : 'quickCommands.switchToName')"
        :aria-label="t(displayMode === 'name' ? 'quickCommands.switchToCommand' : 'quickCommands.switchToName')"
        @click="toggleDisplayMode"
      >
        <i :class="['fas', displayMode === 'name' ? 'fa-tag' : 'fa-terminal']" aria-hidden="true"></i>
      </button>
      <button
        data-testid="quick-command-add"
        type="button"
        class="quick-control quick-control--primary"
        :title="t('quickCommands.add')"
        :aria-label="t('quickCommands.add')"
        @click="add"
      >
        <i class="fas fa-plus" aria-hidden="true"></i>
      </button>
    </div>

    <div
      data-testid="quick-command-list"
      ref="list"
      class="quick-command-list-area min-h-0 flex-1 overflow-y-auto p-2"
      :style="rowStyle"
      :data-row-scale="localScale.toFixed(2)"
      @wheel="scaleRows"
    >
      <p
        v-if="tagLoadError"
        data-testid="quick-command-tag-load-warning"
        class="mb-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning"
        role="alert"
      >
        {{ t('quickCommands.notifications.tagLoadFailed', { error: tagLoadError }) }}
      </p>
      <div
        v-if="loading"
        class="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        <i class="fas fa-spinner fa-spin mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ t('common.loading') }}</p>
      </div>
      <div
        v-else-if="error && !store.items.length"
        class="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-error"
      >
        <i class="fas fa-exclamation-triangle mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ t('quickCommands.notifications.loadFailed', { error }) }}</p>
      </div>
      <div
        v-else-if="!(showTags ? groups.length : flat.length) && search"
        class="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        <i class="fas fa-search mb-2 text-xl" aria-hidden="true"></i>
        <p>{{ t('quickCommands.empty') }}</p>
      </div>
      <div
        v-else-if="!(showTags ? groups.length : flat.length)"
        class="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-text-secondary"
      >
        <i class="fas fa-bolt mb-2 text-xl" aria-hidden="true"></i>
        <p class="mb-3">{{ t('quickCommands.empty') }}</p>
        <button
          type="button"
          class="rounded-lg bg-primary px-4 py-2 font-semibold text-white shadow-md hover:bg-primary-dark"
          @click="add"
        >
          {{ t('quickCommands.addFirst') }}
        </button>
      </div>

      <template v-else-if="showTags && !tagLoadError">
        <section
          v-for="group in groups"
          :key="group.id ?? 'untagged'"
          :data-testid="`quick-command-group-${group.id ?? 'untagged'}`"
          class="quick-command-group-card mb-2.5 last:mb-0 overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-2xs transition-all duration-200 hover:border-border/80"
        >
          <!-- 组头：协调统一的高度（38px），带卡片背景、折叠箭头动画、分类图标徽章、标题及数量胶囊 -->
          <div
            data-testid="quick-command-group-header"
            class="quick-command-group-header group flex select-none items-center justify-between bg-card/90 dark:bg-card/60 px-3 py-2 font-semibold text-foreground transition-all duration-150 hover:bg-header/70 cursor-pointer"
            :class="[
              compact ? 'quick-command-group-header--compact' : '',
              expanded[group.name] !== false ? 'border-b border-border/40' : '',
            ]"
            @click="store.toggle(group.name)"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-secondary/70 transition-colors group-hover:text-foreground cursor-pointer"
                :aria-expanded="expanded[group.name] !== false"
                @click.stop="store.toggle(group.name)"
              >
                <i
                  class="fas fa-chevron-down text-[10px] transition-transform duration-200"
                  :class="{ '-rotate-90': expanded[group.name] === false }"
                  aria-hidden="true"
                ></i>
              </button>
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15"
              >
                <i class="fas fa-layer-group text-[11px]" aria-hidden="true"></i>
              </span>
              <BaseInput
                v-if="editingTagId === (group.id ?? 'untagged')"
                v-model="tagDraft"
                data-testid="quick-command-group-rename-input"
                class="min-w-0 flex-1 h-6 text-xs"
                autofocus
                :placeholder="
                  group.id === null ? t('quickCommands.tags.createFromUntagged') : t('quickCommands.tags.renameHint')
                "
                @click.stop
                @keyup.enter.stop="finishTagEdit(group)"
                @keyup.esc.stop="cancelTagEdit"
                @blur="finishTagEdit(group)"
              />
              <button
                v-else
                type="button"
                data-testid="quick-command-group-name"
                class="min-w-0 shrink truncate text-left text-xs font-semibold text-foreground tracking-tight hover:text-primary transition-colors cursor-pointer"
                :title="t('quickCommands.tags.clickToEditTag')"
                @click.stop="startTagEdit(group)"
              >
                {{ group.id === null ? t('quickCommands.untagged') : group.name }}
              </button>
            </div>

            <!-- 右侧：数量胶囊徽章 -->
            <span
              class="quick-command-group-badge flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-foreground/6 px-1.5 font-mono text-[10px] font-semibold text-text-secondary/80 border border-border/20 transition-colors group-hover:bg-foreground/10 group-hover:text-foreground"
            >
              {{ group.commands.length }}
            </span>
          </div>

          <!-- 指令条目列表 -->
          <ul
            v-show="expanded[group.name] !== false"
            class="quick-command-group-list m-0 list-none p-1.5 space-y-1 bg-background/20"
          >
            <li
              v-for="command in group.commands"
              :key="command.id"
              :data-command-id="command.id"
              class="quick-command-row group flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-primary/10 active:bg-primary/15"
              :class="[
                compact ? 'quick-command-row--compact' : '',
                selectedId === command.id ? 'bg-primary/20 font-medium' : '',
              ]"
              @click="run(command)"
              @contextmenu.prevent="openContext($event, command)"
            >
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <i
                  class="fas fa-terminal text-[10px] text-text-secondary/50 group-hover:text-primary transition-colors shrink-0"
                  aria-hidden="true"
                ></i>
                <span
                  data-testid="quick-command-execute"
                  class="quick-command-display-text truncate text-xs font-medium text-foreground group-hover:text-foreground"
                  :title="displayText(command)"
                >
                  {{ displayText(command) }}
                </span>
                <span
                  v-if="secondaryText(command)"
                  class="quick-command-subtext hidden sm:inline truncate text-[10px] font-mono text-text-secondary/50 shrink-0"
                  :title="secondaryText(command)"
                >
                  ({{ secondaryText(command) }})
                </span>
              </div>
              <span
                class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-secondary/40 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:bg-primary/10 transition-all text-[9px]"
                :title="t('quickCommands.form.execute')"
              >
                <i class="fas fa-play" aria-hidden="true"></i>
              </span>
            </li>
          </ul>
        </section>
      </template>

      <!-- 扁平列表（未分组视图） -->
      <div v-else class="overflow-hidden rounded-xl border border-border/60 bg-card/25 shadow-2xs">
        <ul class="m-0 list-none p-1.5 space-y-1">
          <li
            v-for="command in flat"
            :key="command.id"
            :data-command-id="command.id"
            class="quick-command-row group flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-150 hover:bg-primary/10 active:bg-primary/15"
            :class="[
              compact ? 'quick-command-row--compact' : '',
              selectedId === command.id ? 'bg-primary/20 font-medium' : '',
            ]"
            @click="run(command)"
            @contextmenu.prevent="openContext($event, command)"
          >
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <i
                class="fas fa-terminal text-[10px] text-text-secondary/50 group-hover:text-primary transition-colors shrink-0"
                aria-hidden="true"
              ></i>
              <span
                data-testid="quick-command-execute"
                class="quick-command-display-text truncate text-xs font-medium text-foreground group-hover:text-foreground"
                :title="displayText(command)"
              >
                {{ displayText(command) }}
              </span>
              <span
                v-if="secondaryText(command)"
                class="quick-command-subtext hidden sm:inline truncate text-[10px] font-mono text-text-secondary/50 shrink-0"
                :title="secondaryText(command)"
              >
                ({{ secondaryText(command) }})
              </span>
            </div>
            <span
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-secondary/40 opacity-0 group-hover:opacity-100 group-hover:text-primary group-hover:bg-primary/10 transition-all text-[9px]"
              :title="t('quickCommands.form.execute')"
            >
              <i class="fas fa-play" aria-hidden="true"></i>
            </span>
          </li>
        </ul>
      </div>
    </div>

    <BaseContextMenu v-if="context" :visible="true" :x="context.x" :y="context.y" :width="200" @close="context = null">
      <button class="context-item" @click="copy(context.command)">
        <i class="fas fa-copy" aria-hidden="true"></i><span>{{ t('quickCommands.actions.copy') }}</span>
      </button>
      <button class="context-item" @click="run(context.command)">
        <i class="fas fa-play" aria-hidden="true"></i><span>{{ t('quickCommands.form.execute') }}</span>
      </button>
      <button
        class="context-item"
        @click="
          edit(context.command);
          context = null;
        "
      >
        <i class="fas fa-edit" aria-hidden="true"></i><span>{{ t('common.edit') }}</span>
      </button>
      <button class="context-item text-error" @click="remove(context.command)">
        <i class="fas fa-trash-alt" aria-hidden="true"></i><span>{{ t('common.delete') }}</span>
      </button>
      <div class="my-1 border-t border-border" role="separator"></div>
      <button class="context-item" @click="run(context.command, true)">
        <i class="fas fa-paper-plane" aria-hidden="true"></i
        ><span>{{ t('quickCommands.actions.sendToAllSessions') }}</span>
      </button>
    </BaseContextMenu>

    <QuickCommandForm
      :visible="visible"
      :command="editing"
      :tags="tags"
      @close="visible = false"
      @save="save"
      @execute="executeDraft"
    />
  </section>
</template>

<style scoped>
  .quick-commands-root {
    container-type: inline-size;
    container-name: quick-commands-pane;
    min-width: 0;
  }
  .quick-commands-controls {
    justify-content: center;
    gap: clamp(0.2rem, 1.25cqi, 0.5rem);
  }
  .quick-commands-controls,
  .quick-command-list-area,
  .quick-command-row,
  .quick-command-info {
    min-width: 0;
  }
  .quick-command-group-header {
    min-width: 0;
    min-height: calc(var(--quick-row-scale) * 2.375rem);
    font-size: calc(0.85rem * max(0.9, var(--quick-row-scale) * 0.5 + 0.5));
    line-height: 1.25;
  }
  .quick-command-group-header--compact {
    min-height: calc(var(--quick-row-scale) * 1.875rem);
    padding-block: calc(var(--quick-row-scale) * 0.25rem);
  }
  .quick-command-row {
    min-height: calc(var(--quick-row-scale) * 1.875rem);
    padding: calc(var(--quick-row-scale) * 0.35rem) calc(var(--quick-row-scale) * 0.6rem);
  }
  .quick-command-row--compact {
    min-height: calc(var(--quick-row-scale) * 1.5rem);
    padding-block: calc(var(--quick-row-scale) * 0.15rem);
  }
  .quick-command-display-text {
    min-width: 0;
  }
  @container quick-commands-pane (max-width: 340px) {
    .quick-commands-controls {
      gap: 0.25rem;
      padding: 0.35rem 0.4rem;
    }
    .quick-commands-search {
      padding-inline: 0.5rem;
      font-size: 0.75rem;
      height: 1.75rem;
    }
    .quick-command-list-area {
      padding: 0.35rem 0.35rem;
    }
    .quick-command-group-header {
      padding-inline: 0.5rem;
    }
    .quick-command-row {
      padding-inline: 0.45rem;
    }
    .quick-command-subtext {
      display: none;
    }
  }
  @container quick-commands-pane (max-width: 240px) {
    .quick-commands-controls {
      flex-wrap: wrap;
      justify-content: center;
    }
    .quick-commands-search {
      flex: 1 1 100%;
      width: 100%;
    }
    .quick-command-row {
      flex-wrap: nowrap;
      align-items: center;
    }
  }
  .quick-control {
    display: flex;
    width: clamp(1.6rem, 8.5cqi, 1.875rem);
    height: clamp(1.6rem, 8.5cqi, 1.875rem);
    flex: 0 0 clamp(1.6rem, 8.5cqi, 1.875rem);
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in srgb, var(--border-color) 60%, transparent);
    border-radius: 0.5rem;
    color: var(--text-color-secondary);
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      color 0.15s ease;
    cursor: pointer;
  }
  .quick-control i {
    font-size: clamp(0.72rem, 3.5cqi, 0.825rem);
  }
  .quick-control:hover {
    background: var(--header-bg-color);
    color: var(--text-color);
    border-color: var(--border-color);
  }
  .quick-control--primary {
    border-color: transparent;
    background: var(--link-active-color);
    color: white;
  }
  .quick-control--primary i {
    color: currentColor !important;
  }
  .quick-control--primary:hover {
    background: var(--button-hover-bg-color);
    color: white;
  }
  .context-item {
    display: flex;
    width: calc(100% - 0.5rem);
    margin-inline: 0.25rem;
    align-items: center;
    gap: 0.75rem;
    border-radius: 0.375rem;
    padding: 0.4rem 0.75rem;
    text-align: left;
    font-size: 0.875rem;
  }
  .context-item:hover {
    background: color-mix(in srgb, var(--link-active-color) 10%, transparent);
    color: var(--link-active-color);
  }
  .context-item i {
    width: 1rem;
    text-align: center;
  }
</style>
