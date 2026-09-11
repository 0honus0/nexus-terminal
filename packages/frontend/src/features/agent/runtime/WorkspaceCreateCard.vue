<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { WorkspaceRuntimeCatalog } from '../api/agent-api';

  interface RunnerCandidate {
    pluginId: string;
    version: string;
    displayName: string;
  }

  const props = defineProps<{
    catalog: WorkspaceRuntimeCatalog;
    runnerCandidates: RunnerCandidate[];
    locked: boolean;
  }>();

  const emit = defineEmits<{
    create: [
      input: { recipeId: string; versions: Record<string, string>; runnerPluginIds: string[]; retained: boolean },
    ];
  }>();

  const selectedRecipeId = ref('');
  const toolVersions = ref<Record<string, string>>({});
  const selectedRunnerPluginIds = ref<string[]>([]);
  const retained = ref(false);

  const selectedRecipe = computed(
    () => props.catalog.recipes.find((recipe) => recipe.id === selectedRecipeId.value) ?? null,
  );
  const packsForFamily = (familyId: string) =>
    props.catalog.packs
      .filter((pack) => pack.familyId === familyId && pack.status === 'supported')
      .sort((a, b) => b.versionId.localeCompare(a.versionId, undefined, { numeric: true }));
  const toolFamilies = computed(() => {
    const recipe = selectedRecipe.value;
    if (!recipe) return [];
    return recipe.allowedFamilies.filter(
      (familyId) => !recipe.defaultFamilies.includes(familyId) && packsForFamily(familyId).length > 0,
    );
  });

  const normalize = (): void => {
    if (!props.catalog.recipes.some((recipe) => recipe.id === selectedRecipeId.value)) {
      selectedRecipeId.value = props.catalog.recipes[0]?.id ?? '';
    }
    toolVersions.value = Object.fromEntries(
      Object.entries(toolVersions.value).filter(
        ([familyId, versionId]) =>
          toolFamilies.value.includes(familyId) &&
          packsForFamily(familyId).some((pack) => pack.versionId === versionId),
      ),
    );
    selectedRunnerPluginIds.value = selectedRunnerPluginIds.value.filter((pluginId) =>
      props.runnerCandidates.some((candidate) => candidate.pluginId === pluginId),
    );
  };

  watch(() => [props.catalog, props.runnerCandidates] as const, normalize, { immediate: true, deep: true });
  watch(selectedRecipeId, () => {
    toolVersions.value = {};
  });

  const submit = (): void => {
    if (!selectedRecipeId.value || props.locked) return;
    emit('create', {
      recipeId: selectedRecipeId.value,
      versions: Object.fromEntries(Object.entries(toolVersions.value).filter(([, versionId]) => Boolean(versionId))),
      runnerPluginIds: [...selectedRunnerPluginIds.value],
      retained: retained.value,
    });
  };
</script>

<template>
  <div class="mt-3 rounded bg-background p-2">
    <div class="grid gap-2 sm:grid-cols-2">
      <label class="text-[10px] text-text-secondary">
        {{ $t('agent.workspaceRuntime.recipe') }}
        <select v-model="selectedRecipeId" class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs">
          <option v-for="recipe in catalog.recipes" :key="recipe.id" :value="recipe.id">
            {{ recipe.displayName }}
          </option>
        </select>
      </label>
      <label class="flex items-end gap-2 pb-1 text-[10px]">
        <input v-model="retained" type="checkbox" />
        {{ $t('agent.workspaceRuntime.retained') }}
      </label>
    </div>
    <div v-if="toolFamilies.length" class="mt-2 rounded border border-border p-2">
      <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.toolVersions') }}</div>
      <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.toolVersionsHint') }}</p>
      <div class="mt-2 grid gap-2 sm:grid-cols-3">
        <label v-for="familyId in toolFamilies" :key="familyId" class="text-[10px] text-text-secondary">
          {{ familyId }}
          <select
            v-model="toolVersions[familyId]"
            class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-xs"
          >
            <option value="">{{ $t('agent.workspaceRuntime.toolNotSelected') }}</option>
            <option v-for="pack in packsForFamily(familyId)" :key="pack.versionId" :value="pack.versionId">
              {{ pack.versionId }}
            </option>
          </select>
        </label>
      </div>
    </div>
    <div class="mt-2">
      <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.runnerPlugins') }}</div>
      <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.runnerPluginsHint') }}</p>
      <label v-for="plugin in runnerCandidates" :key="plugin.pluginId" class="mt-1 flex items-center gap-2 text-[10px]">
        <input v-model="selectedRunnerPluginIds" type="checkbox" :value="plugin.pluginId" />
        <span>{{ plugin.displayName }} · {{ plugin.pluginId }} · v{{ plugin.version }}</span>
      </label>
      <p v-if="runnerCandidates.length === 0" class="mt-1 text-[9px] text-text-secondary">
        {{ $t('agent.workspaceRuntime.noRunnerPlugins') }}
      </p>
    </div>
    <button
      type="button"
      class="mt-3 rounded bg-primary px-2 py-1 text-[11px] text-white disabled:opacity-50"
      :disabled="locked || !selectedRecipeId"
      @click="submit"
    >
      {{ $t('agent.workspaceRuntime.create') }}
    </button>
  </div>
</template>
