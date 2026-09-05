<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseModal } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import WorkspaceLayoutNodeEditor from './WorkspaceLayoutNodeEditor.vue';
  import {
    createDefaultWorkspaceLayout,
    workspaceLayout,
    type WorkspaceLayoutNode,
    type WorkspacePaneName,
    type WorkspaceSidebarConfig,
  } from '../layout/workspaceLayout';

  const props = defineProps<{ visible: boolean; layoutLocked?: boolean }>();
  const emit = defineEmits<{ close: []; layoutLocked: [locked: boolean] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const draft = ref<WorkspaceLayoutNode>(createDefaultWorkspaceLayout());
  const sidebar = ref<WorkspaceSidebarConfig>({ left: [], right: [] });
  const originalDraft = ref<WorkspaceLayoutNode>(createDefaultWorkspaceLayout());
  const originalSidebar = ref<WorkspaceSidebarConfig>({ left: [], right: [] });
  const saving = ref(false);

  const clone = <T,>(value: T): T => structuredClone(value);
  watch(
    () => props.visible,
    (visible) => {
      if (!visible) return;
      draft.value = clone(workspaceLayout.tree.value);
      sidebar.value = clone(workspaceLayout.sidebars.value);
      originalDraft.value = clone(workspaceLayout.tree.value);
      originalSidebar.value = clone(workspaceLayout.sidebars.value);
    },
    { immediate: true },
  );

  const mainPanes = computed(() => {
    const result: WorkspacePaneName[] = [];
    const visit = (node: WorkspaceLayoutNode) => {
      if (node.type === 'pane' && node.component) result.push(node.component);
      else for (const child of node.children ?? []) visit(child);
    };
    visit(draft.value);
    return result;
  });
  const hasChanges = computed(
    () =>
      JSON.stringify(draft.value) !== JSON.stringify(originalDraft.value) ||
      JSON.stringify(sidebar.value) !== JSON.stringify(originalSidebar.value),
  );

  const usedPanes = computed(
    () => new Set<WorkspacePaneName>([...mainPanes.value, ...sidebar.value.left, ...sidebar.value.right]),
  );
  const availablePanes = computed(() => workspaceLayout.paneNames.filter((pane) => !usedPanes.value.has(pane)));
  const paneLabel = (pane: WorkspacePaneName): string => t(`layout.pane.${pane}`);
  const paneIcon = (pane: WorkspacePaneName): string => {
    if (pane === 'connections') return 'fas fa-network-wired';
    if (pane === 'fileManager') return 'fas fa-folder-open';
    if (pane === 'commandHistory') return 'fas fa-history';
    if (pane === 'quickCommands') return 'fas fa-bolt';
    if (pane === 'dockerManager') return 'fab fa-docker';
    if (pane === 'editor') return 'fas fa-file-alt';
    if (pane === 'statusMonitor') return 'fas fa-tachometer-alt';
    if (pane === 'suspendedSshSessions') return 'fas fa-pause-circle';
    if (pane === 'commandBar') return 'fas fa-terminal';
    if (pane === 'terminal') return 'fas fa-terminal';
    return 'fas fa-window-maximize';
  };
  const addToMain = (pane: WorkspacePaneName): void => {
    const child: WorkspaceLayoutNode = { id: crypto.randomUUID(), type: 'pane', component: pane, size: 25 };
    if (draft.value.type === 'container') {
      draft.value = { ...draft.value, children: [...(draft.value.children ?? []), child] };
      return;
    }
    draft.value = {
      id: crypto.randomUUID(),
      type: 'container',
      direction: 'horizontal',
      children: [{ ...draft.value, size: 75 }, child],
    };
  };
  const moveSidebar = (side: 'left' | 'right', index: number, delta: number): void => {
    const next = [...sidebar.value[side]];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    sidebar.value = { ...sidebar.value, [side]: next };
  };
  const toggleLayoutLock = (): void => emit('layoutLocked', !Boolean(props.layoutLocked));
  const setSidebar = (side: 'left' | 'right', name: WorkspacePaneName, enabled: boolean) => {
    const other = side === 'left' ? 'right' : 'left';
    sidebar.value[side] = enabled
      ? [...new Set([...sidebar.value[side], name])]
      : sidebar.value[side].filter((item) => item !== name);
    if (enabled && name === 'terminal') sidebar.value[other] = sidebar.value[other].filter((item) => item !== name);
  };
  const attemptClose = async () => {
    if (hasChanges.value) {
      const confirmed = await feedback.confirm({ message: t('layoutConfigurator.confirmClose') });
      if (!confirmed) return;
    }
    emit('close');
  };
  const reset = async () => {
    const confirmed = await feedback.confirm({ message: t('layoutConfigurator.confirmReset') });
    if (!confirmed) return;
    draft.value = createDefaultWorkspaceLayout();
    sidebar.value = { left: ['connections', 'dockerManager'], right: [] };
  };
  const save = async () => {
    saving.value = true;
    try {
      await workspaceLayout.save(clone(draft.value), clone(sidebar.value));
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
    :title="t('layoutConfigurator.title')"
    panel-class="h-auto min-h-[600px] w-auto min-w-[800px] max-w-[95vw] max-h-[90dvh]"
    content-class="!py-0"
    @close="attemptClose"
  >
    <main class="grid min-h-[450px] flex-1 grid-cols-[220px_minmax(0,1fr)] gap-6 overflow-y-auto py-6">
      <section class="flex min-w-[200px] flex-col overflow-y-auto border-r border-border pr-6">
        <h3 class="mb-4 text-base font-semibold text-text-secondary">{{ t('layoutConfigurator.availablePanes') }}</h3>
        <ul class="m-0 flex-grow list-none space-y-2 p-0">
          <li
            v-for="pane in availablePanes"
            :key="pane"
            class="flex items-center gap-2 rounded border border-border bg-background p-2 text-sm transition-colors hover:bg-header/60"
          >
            <i :class="paneIcon(pane)" class="w-4 shrink-0 text-center text-text-alt" aria-hidden="true"></i>
            <span class="min-w-0 flex-1 truncate">{{ paneLabel(pane) }}</span>
            <button
              type="button"
              class="available-action"
              :title="t('layoutConfigurator.layoutPreview')"
              @click="addToMain(pane)"
            >
              <i class="fas fa-plus" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              class="available-action"
              :title="t('layoutConfigurator.leftSidebar')"
              @click="setSidebar('left', pane, true)"
            >
              ←
            </button>
            <button
              type="button"
              class="available-action"
              :title="t('layoutConfigurator.rightSidebar')"
              @click="setSidebar('right', pane, true)"
            >
              →
            </button>
          </li>
          <li v-if="!availablePanes.length" class="p-2 text-sm italic text-text-alt">
            {{ t('layoutConfigurator.noAvailablePanes') }}
          </li>
        </ul>
      </section>

      <div class="flex min-w-[350px] flex-col">
        <section class="flex min-h-0 flex-1 flex-col">
          <div class="mb-4 flex items-center justify-between gap-4">
            <h3 class="text-base font-semibold text-text-secondary">{{ t('layoutConfigurator.layoutPreview') }}</h3>
            <div class="flex items-center gap-2">
              <label
                id="layout-lock-label"
                class="cursor-pointer select-none text-sm text-text-secondary"
                @click="toggleLayoutLock"
              >
                {{ t('layoutConfigurator.lockLayout') }}
              </label>
              <button
                type="button"
                role="switch"
                :aria-checked="Boolean(layoutLocked)"
                aria-labelledby="layout-lock-label"
                :class="[
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                  layoutLocked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600',
                ]"
                @click="toggleLayoutLock"
              >
                <span
                  aria-hidden="true"
                  :class="[
                    'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition duration-200',
                    layoutLocked ? 'translate-x-5' : 'translate-x-0',
                  ]"
                ></span>
              </button>
            </div>
          </div>

          <div
            class="flex min-h-[250px] flex-1 flex-col overflow-auto rounded border-2 border-dashed border-border bg-header/20 p-4"
          >
            <WorkspaceLayoutNodeEditor v-model="draft" :panes="workspaceLayout.paneNames" :root="true" />
          </div>
          <div class="mt-4">
            <button type="button" class="secondary-action" @click="reset">
              {{ t('layoutConfigurator.resetDefault') }}
            </button>
          </div>
        </section>

        <div class="mt-4 grid min-h-[150px] grid-cols-2 gap-6 border-t border-border pt-4">
          <section class="flex min-w-0 flex-col">
            <h3 class="mb-4 text-base font-semibold text-text-secondary">{{ t('layoutConfigurator.leftSidebar') }}</h3>
            <ul
              class="m-0 min-h-[120px] flex-1 list-none space-y-2 rounded border border-dashed border-border bg-header/20 p-2"
            >
              <li
                v-for="(pane, index) in sidebar.left"
                :key="`left-${pane}`"
                class="flex items-center gap-2 rounded border border-border bg-background p-2 text-sm"
              >
                <i :class="paneIcon(pane)" class="w-4 shrink-0 text-center text-text-alt" aria-hidden="true"></i>
                <span class="min-w-0 flex-1 truncate">{{ paneLabel(pane) }}</span>
                <button
                  class="sidebar-action"
                  type="button"
                  :disabled="index === 0"
                  @click="moveSidebar('left', index, -1)"
                >
                  <i class="fas fa-arrow-up" aria-hidden="true"></i>
                </button>
                <button
                  class="sidebar-action"
                  type="button"
                  :disabled="index === sidebar.left.length - 1"
                  @click="moveSidebar('left', index, 1)"
                >
                  <i class="fas fa-arrow-down" aria-hidden="true"></i>
                </button>
                <button class="sidebar-action hover:!text-error" type="button" @click="setSidebar('left', pane, false)">
                  ×
                </button>
              </li>
              <li
                v-if="!sidebar.left.length"
                class="flex min-h-[50px] items-center justify-center p-4 text-center text-sm italic text-text-alt"
              >
                {{ t('layoutConfigurator.dropHere') }}
              </li>
            </ul>
          </section>

          <section class="flex min-w-0 flex-col">
            <h3 class="mb-4 text-base font-semibold text-text-secondary">{{ t('layoutConfigurator.rightSidebar') }}</h3>
            <ul
              class="m-0 min-h-[120px] flex-1 list-none space-y-2 rounded border border-dashed border-border bg-header/20 p-2"
            >
              <li
                v-for="(pane, index) in sidebar.right"
                :key="`right-${pane}`"
                class="flex items-center gap-2 rounded border border-border bg-background p-2 text-sm"
              >
                <i :class="paneIcon(pane)" class="w-4 shrink-0 text-center text-text-alt" aria-hidden="true"></i>
                <span class="min-w-0 flex-1 truncate">{{ paneLabel(pane) }}</span>
                <button
                  class="sidebar-action"
                  type="button"
                  :disabled="index === 0"
                  @click="moveSidebar('right', index, -1)"
                >
                  <i class="fas fa-arrow-up" aria-hidden="true"></i>
                </button>
                <button
                  class="sidebar-action"
                  type="button"
                  :disabled="index === sidebar.right.length - 1"
                  @click="moveSidebar('right', index, 1)"
                >
                  <i class="fas fa-arrow-down" aria-hidden="true"></i>
                </button>
                <button
                  class="sidebar-action hover:!text-error"
                  type="button"
                  @click="setSidebar('right', pane, false)"
                >
                  ×
                </button>
              </li>
              <li
                v-if="!sidebar.right.length"
                class="flex min-h-[50px] items-center justify-center p-4 text-center text-sm italic text-text-alt"
              >
                {{ t('layoutConfigurator.dropHere') }}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>

    <template #footer>
      <div class="flex justify-end gap-3">
        <button type="button" class="secondary-action" @click="attemptClose">{{ t('common.cancel') }}</button>
        <button type="button" class="primary-action" :disabled="!hasChanges || saving" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}{{ hasChanges ? '*' : '' }}
        </button>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
  .available-action,
  .sidebar-action {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 1.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: var(--text-alt-color, var(--text-secondary-color));
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .available-action:hover:not(:disabled),
  .sidebar-action:hover:not(:disabled) {
    background: var(--border-color);
    color: var(--text-color);
  }
  .available-action:disabled,
  .sidebar-action:disabled {
    cursor: not-allowed;
    opacity: 0.35;
  }
  .secondary-action,
  .primary-action {
    border-radius: 0.25rem;
    border: 1px solid var(--border-color);
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    transition:
      background-color 0.15s ease,
      opacity 0.15s ease;
  }
  .secondary-action {
    background: var(--button-bg-color);
    color: var(--button-text-color);
  }
  .secondary-action:hover {
    background: var(--button-hover-bg-color);
  }
  .primary-action {
    border-color: transparent;
    background: var(--primary-color);
    color: white;
  }
  .primary-action:hover:not(:disabled) {
    background: var(--primary-dark-color, var(--primary-color));
  }
  .primary-action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
</style>
