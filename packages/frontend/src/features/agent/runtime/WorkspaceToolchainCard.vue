<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { AgentWorkspaceView, WorkspaceRuntimeCatalog } from '../api/agent-api';

  const props = defineProps<{
    workspace: AgentWorkspaceView;
    catalog: WorkspaceRuntimeCatalog;
    locked: boolean;
  }>();

  const emit = defineEmits<{
    switch: [versions: Record<string, string>];
  }>();

  const draft = ref<Record<string, string>>({});

  const packsForFamily = (familyId: string) =>
    props.catalog.packs
      .filter((pack) => pack.familyId === familyId && pack.status === 'supported')
      .sort((a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }));
  const selectableFamilies = computed(() => {
    const recipe = props.catalog.recipes.find((candidate) => candidate.id === props.workspace.profile.recipeId);
    if (!recipe) return [];
    return recipe.allowedFamilies.filter(
      (familyId) => !recipe.defaultFamilies.includes(familyId) && packsForFamily(familyId).length > 0,
    );
  });
  const pinnedVersion = (familyId: string): string =>
    props.workspace.profile.toolchain.find((pack) => pack.familyId === familyId)?.versionId ?? '';
  const changes = computed<Record<string, string>>(() =>
    Object.fromEntries(
      selectableFamilies.value
        .filter((familyId) => Boolean(draft.value[familyId]) && draft.value[familyId] !== pinnedVersion(familyId))
        .map((familyId) => [familyId, draft.value[familyId]!]),
    ),
  );

  const resetDraft = (): void => {
    draft.value = Object.fromEntries(props.workspace.profile.toolchain.map((pack) => [pack.familyId, pack.versionId]));
  };
  watch(
    () => [props.workspace.id, props.workspace.generation, props.workspace.profile.toolchain] as const,
    resetDraft,
    {
      immediate: true,
      deep: true,
    },
  );
</script>

<template>
  <div v-if="selectableFamilies.length" class="mt-2 rounded border border-border p-2">
    <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.workspaceToolVersions') }}</div>
    <p class="mt-0.5 text-[9px] text-text-secondary">
      {{ $t('agent.workspaceRuntime.workspaceToolVersionsHint') }}
    </p>
    <div class="mt-2 grid gap-2 sm:grid-cols-3">
      <label v-for="familyId in selectableFamilies" :key="familyId" class="text-[10px] text-text-secondary">
        {{ familyId }}
        <select
          v-model="draft[familyId]"
          class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
          :disabled="locked"
        >
          <option v-if="!pinnedVersion(familyId)" value="">
            {{ $t('agent.workspaceRuntime.toolNotSelected') }}
          </option>
          <option v-for="pack in packsForFamily(familyId)" :key="pack.versionId" :value="pack.versionId">
            {{ pack.versionId }}
          </option>
        </select>
      </label>
    </div>
    <button
      type="button"
      class="mt-2 rounded border border-border px-2 py-1 text-[10px] disabled:opacity-50"
      :disabled="locked || Object.keys(changes).length === 0"
      @click="emit('switch', changes)"
    >
      {{ $t('agent.workspaceRuntime.switchToolVersions') }}
    </button>
  </div>
</template>
