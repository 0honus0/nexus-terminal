<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import { UiSelect } from '@/foundation/ui';
  import type { AgentWorkspaceDto, AgentWorkspaceRuntimeCatalogDto } from '../api/agent-api';
  import { NONE_OPTION } from '../settings/pick-option';

  const props = defineProps<{
    workspace: AgentWorkspaceDto;
    catalog: AgentWorkspaceRuntimeCatalogDto;
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
    <div class="text-[11px] font-medium">{{ $t('agent.workspaceRuntime.workspaceToolVersions') }}</div>
    <p class="mt-0.5 text-[11px] text-text-secondary">
      {{ $t('agent.workspaceRuntime.workspaceToolVersionsHint') }}
    </p>
    <div class="mt-2 grid gap-2 sm:grid-cols-3">
      <label v-for="familyId in selectableFamilies" :key="familyId" class="text-[11px] text-text-secondary">
        {{ familyId }}
        <UiSelect
          class="mt-1 w-full"
          density="compact"
          :disabled="locked"
          :model-value="draft[familyId] || NONE_OPTION"
          :options="[
            ...(pinnedVersion(familyId)
              ? []
              : [{ value: NONE_OPTION, label: $t('agent.workspaceRuntime.toolNotSelected') }]),
            ...packsForFamily(familyId).map((pack) => ({ value: pack.versionId, label: pack.versionId })),
          ]"
          @update:model-value="(value: unknown) => (draft[familyId] = value === NONE_OPTION ? '' : String(value))"
        />
      </label>
    </div>
    <button
      type="button"
      class="mt-2 rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"
      :disabled="locked || Object.keys(changes).length === 0"
      @click="emit('switch', changes)"
    >
      {{ $t('agent.workspaceRuntime.switchToolVersions') }}
    </button>
  </div>
</template>
