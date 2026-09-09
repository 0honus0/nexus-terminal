<script setup lang="ts">
  import { computed, ref, toRaw, watch } from 'vue';
  import draggable from 'vuedraggable';
  import { useI18n } from 'vue-i18n';
  import { OverlayPanel } from '@/foundation/ui';
  import { useFeedback } from '@/shared/feedback/public';
  import WorkspaceLayoutNodeEditor from './WorkspaceLayoutNodeEditor.vue';
  import {
    createDefaultWorkspaceLayout,
    workspaceLayout,
    type WorkspaceLayoutNode,
    type WorkspacePaneName,
    type WorkspaceSidebarConfig,
  } from '../layout/workspaceLayout';

  type DragItem = WorkspaceLayoutNode | WorkspacePaneName;

  const props = defineProps<{ visible: boolean; layoutLocked?: boolean }>();
  const emit = defineEmits<{ close: []; layoutLocked: [locked: boolean] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const draft = ref<WorkspaceLayoutNode>(createDefaultWorkspaceLayout());
  const sidebar = ref<WorkspaceSidebarConfig>({ left: [], right: [] });
  const originalDraft = ref<WorkspaceLayoutNode>(createDefaultWorkspaceLayout());
  const originalSidebar = ref<WorkspaceSidebarConfig>({ left: [], right: [] });
  const saving = ref(false);

  const clone = <T,>(value: T): T => {
    const unproxy = (candidate: unknown): unknown => {
      const raw = toRaw(candidate);
      if (Array.isArray(raw)) return raw.map(unproxy);
      if (raw && typeof raw === 'object')
        return Object.fromEntries(Object.entries(raw).map(([key, nested]) => [key, unproxy(nested)]));
      return raw;
    };
    return unproxy(value) as T;
  };

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
    const result = new Set<WorkspacePaneName>();
    const visit = (node: WorkspaceLayoutNode): void => {
      if (node.type === 'pane' && node.component) result.add(node.component);
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
  const allUsedPanes = computed(
    () => new Set<WorkspacePaneName>([...mainPanes.value, ...sidebar.value.left, ...sidebar.value.right]),
  );
  const availablePanes = computed(() =>
    workspaceLayout.paneNames.filter((pane) => pane !== 'terminal' || !allUsedPanes.value.has('terminal')),
  );

  const paneLabel = (pane: WorkspacePaneName): string => t(`layout.pane.${pane}`);
  const clonePane = (pane: WorkspacePaneName): WorkspaceLayoutNode => ({
    id: crypto.randomUUID(),
    type: 'pane',
    component: pane,
    size: 25,
  });

  const normalizeSidebar = (side: 'left' | 'right', items: DragItem[]): WorkspacePaneName[] => {
    const other = side === 'left' ? sidebar.value.right : sidebar.value.left;
    const next: WorkspacePaneName[] = [];
    for (const item of items) {
      const pane = typeof item === 'string' ? item : item.type === 'pane' ? item.component : undefined;
      if (!pane || next.includes(pane) || other.includes(pane)) continue;
      next.push(pane);
    }
    return next;
  };

  const leftSidebar = computed<DragItem[]>({
    get: () => sidebar.value.left,
    set: (items) => {
      sidebar.value = { ...sidebar.value, left: normalizeSidebar('left', items) };
    },
  });
  const rightSidebar = computed<DragItem[]>({
    get: () => sidebar.value.right,
    set: (items) => {
      sidebar.value = { ...sidebar.value, right: normalizeSidebar('right', items) };
    },
  });

  const canMoveToSidebar = (event: { draggedContext?: { element?: DragItem } }): boolean => {
    const item = event.draggedContext?.element;
    return Boolean(typeof item === 'string' || (item && typeof item === 'object' && item.type === 'pane'));
  };

  const removeSidebarPane = (side: 'left' | 'right', index: number): void => {
    const next = [...sidebar.value[side]];
    next.splice(index, 1);
    sidebar.value = { ...sidebar.value, [side]: next };
  };

  const toggleLayoutLock = (): void => emit('layoutLocked', !Boolean(props.layoutLocked));
  const attemptClose = async (): Promise<void> => {
    if (hasChanges.value) {
      const confirmed = await feedback.confirm({ message: t('layoutConfigurator.confirmClose') });
      if (!confirmed) return;
    }
    emit('close');
  };
  const reset = async (): Promise<void> => {
    const confirmed = await feedback.confirm({ message: t('layoutConfigurator.confirmReset') });
    if (!confirmed) return;
    draft.value = createDefaultWorkspaceLayout();
    sidebar.value = { left: ['connections', 'dockerManager'], right: [] };
  };
  const save = async (): Promise<void> => {
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
  <OverlayPanel
    :visible="visible"
    :z-index="1000"
    :surface="false"
    overlay-class="!p-0"
    :close-on-escape="true"
    @close="attemptClose"
  >
    <div
      data-testid="workspace-layout-configurator"
      class="layout-configurator-dialog pointer-events-auto relative flex h-auto max-h-[90dvh] min-h-[600px] w-auto min-w-[800px] max-w-[95vw] cursor-default flex-col overflow-auto rounded-lg bg-background text-foreground shadow-xl"
      role="dialog"
      :aria-label="t('layoutConfigurator.title')"
    >
      <header class="flex items-center justify-between border-b border-border bg-header p-4">
        <h2 class="m-0 text-lg font-semibold">{{ t('layoutConfigurator.title') }}</h2>
        <button
          type="button"
          class="border-0 bg-transparent p-0 text-2xl leading-none text-text-secondary hover:text-foreground"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="attemptClose"
        >
          ×
        </button>
      </header>

      <main class="grid min-h-[450px] flex-1 grid-cols-[220px_minmax(0,1fr)] gap-6 overflow-y-auto p-6">
        <section class="flex min-w-[200px] flex-col overflow-y-auto border-r border-border pr-6">
          <h3 class="mb-4 mt-0 text-base font-semibold text-text-secondary">
            {{ t('layoutConfigurator.availablePanes') }}
          </h3>
          <draggable
            :list="availablePanes"
            tag="ul"
            class="layout-available-panes m-0 flex-grow list-none p-0"
            :item-key="(pane: WorkspacePaneName) => pane"
            :group="{ name: 'workspace-layout-items', pull: 'clone', put: false }"
            :sort="false"
            :clone="clonePane"
          >
            <template #item="{ element: pane }">
              <li
                :data-testid="`layout-available-pane-${pane}`"
                class="mb-2 flex cursor-grab select-none items-center rounded border border-border bg-background-alt p-2 text-sm transition-colors hover:bg-header active:cursor-grabbing"
              >
                <i class="fas fa-grip-vertical mr-2 text-text-alt" aria-hidden="true"></i>
                <span class="min-w-0 truncate">{{ paneLabel(pane) }}</span>
              </li>
            </template>
            <template #footer>
              <li v-if="!availablePanes.length" class="p-2 text-sm italic text-text-alt">
                {{ t('layoutConfigurator.noAvailablePanes') }}
              </li>
            </template>
          </draggable>
        </section>

        <div class="flex min-w-[350px] flex-col">
          <section class="flex min-h-0 flex-1 flex-col">
            <div class="mb-4 flex items-center justify-between gap-4">
              <h3 class="m-0 text-base font-semibold text-text-secondary">
                {{ t('layoutConfigurator.layoutPreview') }}
              </h3>
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
              data-layout-main-tree
              class="flex min-h-[250px] flex-1 flex-col overflow-auto rounded border-2 border-dashed border-border-alt bg-background-alt p-4"
            >
              <WorkspaceLayoutNodeEditor v-model="draft" :root="true" :used-main-panes="mainPanes" class="flex-grow" />
            </div>
            <div class="mt-4 flex gap-2">
              <button type="button" class="secondary-action" @click="reset">
                {{ t('layoutConfigurator.resetDefault') }}
              </button>
            </div>
          </section>

          <div class="mt-4 grid min-h-[150px] grid-cols-2 gap-6 border-t border-border pt-4">
            <section class="flex min-w-0 flex-col">
              <h3 class="mb-4 mt-0 text-base font-semibold text-text-secondary">
                {{ t('layoutConfigurator.leftSidebar') }}
              </h3>
              <draggable
                v-model="leftSidebar"
                tag="ul"
                data-testid="layout-left-sidebar-list"
                class="layout-sidebar-list m-0 min-h-[120px] flex-1 list-none overflow-y-auto rounded border border-dashed border-border-alt bg-background-alt p-2"
                :item-key="(item: DragItem) => (typeof item === 'string' ? item : (item.component ?? item.id))"
                :group="{ name: 'workspace-layout-items' }"
                :move="canMoveToSidebar"
              >
                <template #item="{ element: pane, index }">
                  <li
                    class="mb-2 flex cursor-grab select-none items-center rounded border border-border bg-header p-2 text-sm active:cursor-grabbing"
                  >
                    <i class="fas fa-grip-vertical mr-2 shrink-0 text-text-alt" aria-hidden="true"></i>
                    <span class="min-w-0 flex-1 truncate">{{
                      paneLabel(typeof pane === 'string' ? pane : pane.component)
                    }}</span>
                    <button
                      type="button"
                      class="sidebar-remove"
                      :title="t('common.remove')"
                      :aria-label="t('common.remove')"
                      @click.stop="removeSidebarPane('left', index)"
                    >
                      ×
                    </button>
                  </li>
                </template>
                <template #footer>
                  <li
                    v-if="!sidebar.left.length"
                    class="flex min-h-[50px] items-center justify-center p-4 text-center text-sm italic text-text-alt"
                  >
                    {{ t('layoutConfigurator.dropHere') }}
                  </li>
                </template>
              </draggable>
            </section>

            <section class="flex min-w-0 flex-col">
              <h3 class="mb-4 mt-0 text-base font-semibold text-text-secondary">
                {{ t('layoutConfigurator.rightSidebar') }}
              </h3>
              <draggable
                v-model="rightSidebar"
                tag="ul"
                data-testid="layout-right-sidebar-list"
                class="layout-sidebar-list m-0 min-h-[120px] flex-1 list-none overflow-y-auto rounded border border-dashed border-border-alt bg-background-alt p-2"
                :item-key="(item: DragItem) => (typeof item === 'string' ? item : (item.component ?? item.id))"
                :group="{ name: 'workspace-layout-items' }"
                :move="canMoveToSidebar"
              >
                <template #item="{ element: pane, index }">
                  <li
                    class="mb-2 flex cursor-grab select-none items-center rounded border border-border bg-header p-2 text-sm active:cursor-grabbing"
                  >
                    <i class="fas fa-grip-vertical mr-2 shrink-0 text-text-alt" aria-hidden="true"></i>
                    <span class="min-w-0 flex-1 truncate">{{
                      paneLabel(typeof pane === 'string' ? pane : pane.component)
                    }}</span>
                    <button
                      type="button"
                      class="sidebar-remove"
                      :title="t('common.remove')"
                      :aria-label="t('common.remove')"
                      @click.stop="removeSidebarPane('right', index)"
                    >
                      ×
                    </button>
                  </li>
                </template>
                <template #footer>
                  <li
                    v-if="!sidebar.right.length"
                    class="flex min-h-[50px] items-center justify-center p-4 text-center text-sm italic text-text-alt"
                  >
                    {{ t('layoutConfigurator.dropHere') }}
                  </li>
                </template>
              </draggable>
            </section>
          </div>
        </div>
      </main>

      <footer class="flex justify-end gap-3 border-t border-border bg-header p-4">
        <button type="button" class="secondary-action" @click="attemptClose">{{ t('common.cancel') }}</button>
        <button type="button" class="primary-action" :disabled="!hasChanges || saving" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}{{ hasChanges ? '*' : '' }}
        </button>
      </footer>
    </div>
  </OverlayPanel>
</template>

<style scoped>
  .secondary-action,
  .primary-action {
    border: 1px solid var(--border-color);
    border-radius: 0.25rem;
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
    background: var(--link-active-color);
    color: white;
  }
  .primary-action:hover:not(:disabled) {
    background: var(--button-hover-bg-color);
  }
  .primary-action:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .sidebar-remove {
    display: inline-flex;
    width: 1.5rem;
    height: 1.5rem;
    flex: 0 0 1.5rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.2rem;
    color: var(--text-color-secondary);
    font-size: 1rem;
    line-height: 1;
  }
  .sidebar-remove:hover {
    background: color-mix(in srgb, var(--status-error-color) 10%, transparent);
    color: var(--status-error-color);
  }
  :deep(.sortable-ghost) {
    border: 1px dashed var(--link-active-color) !important;
    background: color-mix(in srgb, var(--link-active-color) 12%, transparent) !important;
    opacity: 0.45;
  }
</style>
