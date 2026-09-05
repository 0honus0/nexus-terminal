<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { BaseInput, BaseSelect } from '@/foundation/ui';
  import type { WorkspaceLayoutNode, WorkspacePaneName } from '../layout/workspaceLayout';

  const { t } = useI18n();
  const props = defineProps<{ modelValue: WorkspaceLayoutNode; panes: readonly WorkspacePaneName[]; root?: boolean }>();
  const emit = defineEmits<{ 'update:modelValue': [node: WorkspaceLayoutNode]; remove: [] }>();

  const patch = (value: Partial<WorkspaceLayoutNode>) => emit('update:modelValue', { ...props.modelValue, ...value });
  const updateChild = (index: number, child: WorkspaceLayoutNode) => {
    const children = [...(props.modelValue.children ?? [])];
    children[index] = child;
    patch({ children });
  };
  const removeChild = (index: number) => {
    const children = [...(props.modelValue.children ?? [])];
    children.splice(index, 1);
    patch({ children });
  };
  const addPane = () => {
    const pane = props.panes[0];
    if (!pane) return;
    patch({
      children: [
        ...(props.modelValue.children ?? []),
        { id: crypto.randomUUID(), type: 'pane', component: pane, size: 25 },
      ],
    });
  };
  const addContainer = (direction: 'horizontal' | 'vertical') =>
    patch({
      children: [
        ...(props.modelValue.children ?? []),
        { id: crypto.randomUUID(), type: 'container', direction, children: [], size: 25 },
      ],
    });
  const paneLabel = (pane: WorkspacePaneName | undefined): string =>
    pane ? t(`layout.pane.${pane}`) : t('layoutNodeEditor.pane');
  const move = (index: number, delta: number) => {
    const children = [...(props.modelValue.children ?? [])];
    const target = index + delta;
    if (target < 0 || target >= children.length) return;
    [children[index], children[target]] = [children[target]!, children[index]!];
    patch({ children });
  };
</script>

<template>
  <div class="layout-node-editor rounded border border-border bg-background p-2">
    <div class="flex min-h-8 flex-wrap items-center gap-2">
      <template v-if="modelValue.type === 'pane'">
        <span class="text-xs font-semibold uppercase text-text-secondary">{{ t('layoutNodeEditor.pane') }}</span>
        <i class="fas fa-window-maximize text-xs text-text-alt" aria-hidden="true"></i>
        <BaseSelect
          :model-value="modelValue.component"
          class="min-w-44"
          @update:model-value="patch({ component: $event as WorkspacePaneName })"
        >
          <option v-for="pane in panes" :key="pane" :value="pane">{{ paneLabel(pane) }}</option>
        </BaseSelect>
      </template>

      <template v-else>
        <span class="text-xs font-semibold uppercase text-text-secondary">
          {{
            t('layoutNodeEditor.containerLabel', {
              direction: t(`layoutNodeEditor.${modelValue.direction ?? 'horizontal'}`),
            })
          }}
        </span>
        <button
          type="button"
          class="node-action"
          :title="t('layoutNodeEditor.toggleDirection')"
          @click="patch({ direction: modelValue.direction === 'horizontal' ? 'vertical' : 'horizontal' })"
        >
          <i class="fas fa-sync-alt" aria-hidden="true"></i>
        </button>
        <button type="button" class="node-action gap-1 px-2" :title="t('layoutNodeEditor.addPane')" @click="addPane">
          <i class="fas fa-window-maximize" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          class="node-action gap-1 px-2"
          :title="t('layoutNodeEditor.addHorizontalContainer')"
          @click="addContainer('horizontal')"
        >
          <i class="fas fa-columns" aria-hidden="true"></i><span class="text-[10px]">H</span>
        </button>
        <button
          type="button"
          class="node-action gap-1 px-2"
          :title="t('layoutNodeEditor.addVerticalContainer')"
          @click="addContainer('vertical')"
        >
          <i class="fas fa-bars" aria-hidden="true"></i><span class="text-[10px]">V</span>
        </button>
      </template>

      <label v-if="!root" class="ml-auto flex items-center gap-1 text-xs text-text-secondary">
        {{ t('layoutNodeEditor.size') }}
        <BaseInput
          :model-value="String(modelValue.size ?? 25)"
          class="w-20"
          type="number"
          min="1"
          max="100"
          @update:model-value="patch({ size: Number($event) || 1 })"
        />
      </label>
      <button
        v-if="!root"
        type="button"
        class="node-action node-action--danger"
        :title="t('layoutNodeEditor.removeNode')"
        @click="emit('remove')"
      >
        <i class="fas fa-trash-alt" aria-hidden="true"></i>
      </button>
    </div>

    <div v-if="modelValue.type === 'container'" class="mt-2 space-y-2 border-l-2 border-border pl-3">
      <div v-for="(child, index) in modelValue.children ?? []" :key="child.id" class="relative pt-1">
        <div class="absolute right-2 top-2 z-10 flex gap-1">
          <button
            type="button"
            class="node-action"
            :disabled="index === 0"
            :title="t('layoutNodeEditor.dragHandle')"
            @click="move(index, -1)"
          >
            <i class="fas fa-arrow-up" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            class="node-action"
            :disabled="index === (modelValue.children?.length ?? 0) - 1"
            :title="t('layoutNodeEditor.dragHandle')"
            @click="move(index, 1)"
          >
            <i class="fas fa-arrow-down" aria-hidden="true"></i>
          </button>
        </div>
        <WorkspaceLayoutNodeEditor
          :model-value="child"
          :panes="panes"
          @update:model-value="updateChild(index, $event)"
          @remove="removeChild(index)"
        />
      </div>
      <p v-if="!modelValue.children?.length" class="py-3 text-center text-xs italic text-text-secondary">
        {{ t('layoutNodeEditor.dropHere') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
  .node-action {
    display: inline-flex;
    min-width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    border-radius: 0.25rem;
    color: var(--text-secondary-color);
    transition:
      background-color 0.15s ease,
      color 0.15s ease;
  }
  .node-action:hover:not(:disabled) {
    background: var(--border-color);
    color: var(--text-color);
  }
  .node-action:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }
  .node-action--danger {
    color: var(--error-color);
  }
  .node-action--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--error-color) 12%, transparent);
    color: var(--error-color);
  }
</style>
