<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseInput, BaseSelect } from '@/foundation/ui';
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
  const addPane = () =>
    patch({
      children: [
        ...(props.modelValue.children ?? []),
        { id: crypto.randomUUID(), type: 'pane', component: props.panes[0], size: 25 },
      ],
    });
  const addContainer = () =>
    patch({
      children: [
        ...(props.modelValue.children ?? []),
        { id: crypto.randomUUID(), type: 'container', direction: 'vertical', children: [], size: 25 },
      ],
    });
  const move = (index: number, delta: number) => {
    const children = [...(props.modelValue.children ?? [])];
    const target = index + delta;
    if (target < 0 || target >= children.length) return;
    [children[index], children[target]] = [children[target]!, children[index]!];
    patch({ children });
  };
</script>

<template>
  <div class="rounded border border-border bg-background p-2">
    <div class="flex flex-wrap items-center gap-2">
      <template v-if="modelValue.type === 'pane'">
        <span class="text-xs font-semibold uppercase text-text-secondary">{{ t('layoutNodeEditor.pane') }}</span>
        <BaseSelect
          :model-value="modelValue.component"
          class="min-w-44"
          @update:model-value="patch({ component: $event as WorkspacePaneName })"
        >
          <option v-for="pane in panes" :key="pane" :value="pane">{{ pane }}</option>
        </BaseSelect>
      </template>
      <template v-else>
        <span class="text-xs font-semibold uppercase text-text-secondary">{{ t('layoutNodeEditor.container') }}</span>
        <BaseSelect
          :model-value="modelValue.direction ?? 'horizontal'"
          class="w-36"
          @update:model-value="patch({ direction: $event as 'horizontal' | 'vertical' })"
        >
          <option value="horizontal">{{ t('layoutNodeEditor.horizontal') }}</option>
          <option value="vertical">{{ t('layoutNodeEditor.vertical') }}</option>
        </BaseSelect>
        <BaseButton size="sm" @click="addPane">+ {{ t('layoutNodeEditor.pane') }}</BaseButton>
        <BaseButton size="sm" @click="addContainer">+ {{ t('layoutNodeEditor.container') }}</BaseButton>
      </template>
      <label v-if="!root" class="ml-auto flex items-center gap-1 text-xs text-text-secondary"
        >{{ t('layoutNodeEditor.size') }}
        <BaseInput
          :model-value="String(modelValue.size ?? 25)"
          class="w-20"
          type="number"
          min="1"
          max="100"
          @update:model-value="patch({ size: Number($event) || 1 })"
      /></label>
      <BaseButton v-if="!root" size="sm" variant="danger" @click="emit('remove')">×</BaseButton>
    </div>
    <div v-if="modelValue.type === 'container'" class="mt-2 space-y-2 border-l-2 border-border pl-3">
      <div v-for="(child, index) in modelValue.children ?? []" :key="child.id" class="relative">
        <div class="absolute right-2 top-2 z-10 flex gap-1">
          <BaseButton size="sm" variant="ghost" :disabled="index === 0" @click="move(index, -1)">↑</BaseButton>
          <BaseButton
            size="sm"
            variant="ghost"
            :disabled="index === (modelValue.children?.length ?? 0) - 1"
            @click="move(index, 1)"
            >↓</BaseButton
          >
        </div>
        <WorkspaceLayoutNodeEditor
          :model-value="child"
          :panes="panes"
          @update:model-value="updateChild(index, $event)"
          @remove="removeChild(index)"
        />
      </div>
      <p v-if="!modelValue.children?.length" class="py-3 text-center text-xs text-text-secondary">
        {{ t('layoutNodeEditor.emptyContainer') }}
      </p>
    </div>
  </div>
</template>
