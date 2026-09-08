<script setup lang="ts">
  import { computed } from 'vue';
  import draggable from 'vuedraggable';
  import { useI18n } from 'vue-i18n';
  import {
    normalizeWorkspaceLayout,
    rebalanceWorkspaceLayoutChildren,
    type WorkspaceLayoutNode,
    type WorkspacePaneName,
  } from '../layout/workspaceLayout';

  type DragItem = WorkspaceLayoutNode | WorkspacePaneName;

  const props = withDefaults(
    defineProps<{
      modelValue: WorkspaceLayoutNode;
      root?: boolean;
      usedMainPanes?: ReadonlySet<WorkspacePaneName>;
    }>(),
    { root: false, usedMainPanes: () => new Set<WorkspacePaneName>() },
  );
  const emit = defineEmits<{ 'update:modelValue': [node: WorkspaceLayoutNode]; remove: [] }>();
  const { t } = useI18n();

  const patch = (value: Partial<WorkspaceLayoutNode>) =>
    emit('update:modelValue', normalizeWorkspaceLayout({ ...props.modelValue, ...value }));

  const asLayoutNode = (item: DragItem): WorkspaceLayoutNode => {
    if (typeof item !== 'string') return item;
    return {
      id: crypto.randomUUID(),
      type: 'pane',
      component: item,
      size: 25,
    };
  };

  const childrenList = computed<DragItem[]>({
    get: () => (props.modelValue.children ?? []) as DragItem[],
    set: (items) => {
      const children = rebalanceWorkspaceLayoutChildren(items.map(asLayoutNode));
      patch({ children });
    },
  });

  const paneLabel = (pane: WorkspacePaneName | undefined): string =>
    pane ? t(`layout.pane.${pane}`) : t('layoutNodeEditor.pane');

  const addContainer = (direction: 'horizontal' | 'vertical') => {
    const children = rebalanceWorkspaceLayoutChildren([
      ...(props.modelValue.children ?? []),
      {
        id: crypto.randomUUID(),
        type: 'container' as const,
        direction,
        children: [],
        size: 25,
      },
    ]);
    patch({ children });
  };

  const canMove = (event: { draggedContext?: { element?: DragItem }; from?: HTMLElement }): boolean => {
    const item = event.draggedContext?.element;
    if (!item) return false;
    const sourceIsMain = Boolean(event.from?.closest('[data-layout-main-tree]'));
    if (sourceIsMain) return true;
    const pane = typeof item === 'string' ? item : item.type === 'pane' ? item.component : undefined;
    return Boolean(pane && !props.usedMainPanes.has(pane));
  };

  const updateChild = (childId: string, updated: WorkspaceLayoutNode): void => {
    const children = [...(props.modelValue.children ?? [])];
    const index = children.findIndex((candidate) => candidate.id === childId);
    if (index < 0) return;
    children[index] = updated;
    patch({ children: rebalanceWorkspaceLayoutChildren(children, index) });
  };

  const removeChild = (childId: string): void => {
    const children = [...(props.modelValue.children ?? [])];
    const index = children.findIndex((candidate) => candidate.id === childId);
    if (index < 0) return;
    children.splice(index, 1);
    patch({ children: rebalanceWorkspaceLayoutChildren(children) });
  };
</script>

<template>
  <div
    class="layout-node-editor"
    :class="[`node-type-${modelValue.type}`, modelValue.direction ? `direction-${modelValue.direction}` : '']"
    :data-node-id="modelValue.id"
  >
    <div class="node-controls">
      <span class="node-info">
        {{
          modelValue.type === 'pane'
            ? paneLabel(modelValue.component)
            : t('layoutNodeEditor.containerLabel', {
                direction: t(`layoutNodeEditor.${modelValue.direction ?? 'horizontal'}`),
              })
        }}
      </span>
      <div class="node-actions">
        <button
          v-if="modelValue.type === 'container'"
          type="button"
          class="action-button"
          :title="t('layoutNodeEditor.toggleDirection')"
          @click="patch({ direction: modelValue.direction === 'horizontal' ? 'vertical' : 'horizontal' })"
        >
          <i class="fas fa-sync-alt" aria-hidden="true"></i>
        </button>
        <button
          v-if="modelValue.type === 'container'"
          type="button"
          class="action-button"
          :title="t('layoutNodeEditor.addHorizontalContainer')"
          @click="addContainer('horizontal')"
        >
          <i class="fas fa-columns" aria-hidden="true"></i>
          <span>{{ t('layoutNodeEditor.horizontalShort') }}</span>
        </button>
        <button
          v-if="modelValue.type === 'container'"
          type="button"
          class="action-button"
          :title="t('layoutNodeEditor.addVerticalContainer')"
          @click="addContainer('vertical')"
        >
          <i class="fas fa-bars" aria-hidden="true"></i>
          <span>{{ t('layoutNodeEditor.verticalShort') }}</span>
        </button>
        <button
          v-if="!root"
          type="button"
          class="action-button remove-button"
          :title="t('layoutNodeEditor.removeNode')"
          @click="emit('remove')"
        >
          <i class="fas fa-trash-alt" aria-hidden="true"></i>
        </button>
      </div>
    </div>

    <draggable
      v-if="modelValue.type === 'container'"
      v-model="childrenList"
      tag="div"
      class="node-children-container"
      :class="[`children-direction-${modelValue.direction ?? 'horizontal'}`]"
      :data-testid="`workspace-layout-children-${modelValue.id}`"
      :data-layout-direction="modelValue.direction ?? 'horizontal'"
      item-key="id"
      :group="{ name: 'workspace-layout-items' }"
      handle=".drag-handle-node"
      :move="canMove"
    >
      <template #item="{ element: childNode }">
        <div class="child-node-wrapper" :data-layout-child-id="childNode.id">
          <i
            class="fas fa-grip-vertical drag-handle-node"
            :title="t('layoutNodeEditor.dragHandle')"
            aria-hidden="true"
          ></i>
          <WorkspaceLayoutNodeEditor
            :model-value="childNode"
            :used-main-panes="usedMainPanes"
            @update:model-value="updateChild(childNode.id, $event)"
            @remove="removeChild(childNode.id)"
          />
        </div>
      </template>
      <template #footer>
        <div v-if="!modelValue.children?.length" class="empty-container-placeholder">
          {{ t('layoutNodeEditor.dropHere') }}
        </div>
      </template>
    </draggable>

    <div v-else class="pane-node-content"></div>
  </div>
</template>

<style scoped>
  .layout-node-editor {
    min-width: 0;
  }

  .node-controls {
    display: flex;
    min-height: 24px;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
    margin-bottom: 0.35rem;
    padding: 3px 0.4rem;
    background: var(--header-bg-color);
    font-size: 0.8rem;
  }

  .node-info {
    min-width: 0;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node-actions {
    display: flex;
    flex: none;
    gap: 3px;
  }

  .action-button {
    display: inline-flex;
    min-width: 1.45rem;
    height: 1.45rem;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    border: 1px solid var(--border-color);
    border-radius: 3px;
    color: var(--text-color-secondary);
    font-size: 0.72rem;
    line-height: 1;
  }

  .action-button:hover {
    background: var(--border-color);
    color: var(--text-color);
  }

  .remove-button {
    border-color: color-mix(in srgb, var(--status-error-color) 65%, var(--border-color));
    color: var(--status-error-color);
  }

  .remove-button:hover {
    background: var(--status-error-color);
    color: white;
  }

  .node-children-container {
    display: flex;
    min-height: 40px;
    flex: 1 1 auto;
    gap: 2px;
    padding: 0.35rem;
    border: 1px dashed var(--border-color);
  }

  .children-direction-horizontal {
    flex-direction: row;
  }

  .children-direction-vertical {
    flex-direction: column;
  }

  .child-node-wrapper {
    position: relative;
    display: flex;
    min-width: 0;
    border: 1px solid transparent;
  }

  .children-direction-horizontal > .child-node-wrapper {
    flex: 1 1 auto;
    flex-direction: column;
  }

  .children-direction-vertical > .child-node-wrapper {
    width: 100%;
    flex-direction: row;
    align-items: stretch;
  }

  .drag-handle-node {
    display: flex;
    flex: none;
    align-items: center;
    padding: 0.35rem 3px;
    border-right: 1px solid var(--border-color);
    background: var(--header-bg-color);
    color: var(--text-color-secondary);
    cursor: grab;
  }

  .children-direction-vertical > .child-node-wrapper > .drag-handle-node {
    border-right: 0;
    border-bottom: 1px solid var(--border-color);
    writing-mode: vertical-rl;
  }

  .child-node-wrapper > .layout-node-editor {
    min-width: 0;
    flex: 1 1 auto;
  }

  .pane-node-content {
    min-height: 30px;
    padding-top: 0.35rem;
    color: var(--text-color-secondary);
    font-size: 0.8rem;
    text-align: center;
  }

  .empty-container-placeholder {
    display: flex;
    min-height: 30px;
    flex: 1 1 auto;
    align-items: center;
    justify-content: center;
    margin: 0.25rem;
    padding: 0.5rem;
    border: 1px dashed var(--border-color);
    color: var(--text-color-secondary);
    font-size: 0.8rem;
    font-style: italic;
    text-align: center;
  }

  :deep(.sortable-ghost) {
    border: 1px dashed var(--link-active-color) !important;
    background: color-mix(in srgb, var(--link-active-color) 12%, transparent) !important;
    opacity: 0.45;
  }
</style>
