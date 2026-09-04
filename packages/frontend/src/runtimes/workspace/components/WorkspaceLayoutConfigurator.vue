<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseCheckbox, BaseModal } from '@/foundation/ui';
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
  const sidebarCandidates = (side: 'left' | 'right') => {
    const other = side === 'left' ? 'right' : 'left';
    return workspaceLayout.paneNames.filter(
      (name) =>
        name !== 'terminal' ||
        (!mainPanes.value.includes('terminal') &&
          (!sidebar.value[other].includes('terminal') || sidebar.value[side].includes('terminal'))),
    );
  };
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
    panel-class="h-[min(880px,94vh)] w-[min(1100px,96vw)]"
    @close="attemptClose"
  >
    <div class="flex h-full min-h-0 flex-col gap-3">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm text-text-secondary">{{ t('layoutConfigurator.layoutPreview') }}</p>
        <div class="flex items-center gap-2">
          <label class="flex items-center gap-1 text-sm text-text-secondary">
            <BaseCheckbox :model-value="Boolean(layoutLocked)" @update:model-value="emit('layoutLocked', $event)" />{{
              t('layoutConfigurator.lockLayout')
            }}
          </label>
          <BaseButton size="sm" @click="reset">{{ t('layoutConfigurator.resetDefault') }}</BaseButton
          ><BaseButton size="sm" variant="primary" :loading="saving" @click="save">{{ t('common.save') }}</BaseButton>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-auto">
        <WorkspaceLayoutNodeEditor v-model="draft" :panes="workspaceLayout.paneNames" :root="true" />
      </div>
      <div class="grid gap-3 border-t border-border pt-3 md:grid-cols-2">
        <section>
          <h3 class="mb-2 text-sm font-semibold">{{ t('layoutConfigurator.leftSidebar') }}</h3>
          <div class="flex flex-wrap gap-3">
            <label v-for="pane in sidebarCandidates('left')" :key="`l-${pane}`" class="flex items-center gap-1 text-sm"
              ><BaseCheckbox
                :model-value="sidebar.left.includes(pane)"
                @update:model-value="setSidebar('left', pane, $event)"
              />{{ pane }}</label
            >
          </div>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-semibold">{{ t('layoutConfigurator.rightSidebar') }}</h3>
          <div class="flex flex-wrap gap-3">
            <label v-for="pane in sidebarCandidates('right')" :key="`r-${pane}`" class="flex items-center gap-1 text-sm"
              ><BaseCheckbox
                :model-value="sidebar.right.includes(pane)"
                @update:model-value="setSidebar('right', pane, $event)"
              />{{ pane }}</label
            >
          </div>
        </section>
      </div>
    </div>
  </BaseModal>
</template>
