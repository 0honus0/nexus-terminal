<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { UiSelect } from '@/foundation/ui';
  import type { AgentArtifactRefDto } from '../api/agent-api';
  import { NONE_OPTION } from '../common/pick-option';

  const props = defineProps<{
    artifacts: AgentArtifactRefDto[];
    locked: boolean;
  }>();

  const emit = defineEmits<{
    export: [input: { path: string; name: string; mediaType: string }];
    import: [input: { artifactId: string; path: string }];
  }>();

  const exportPath = ref('/');
  const exportName = ref('workspace.bin');
  const exportMediaType = ref('application/octet-stream');
  const importArtifactId = ref('');
  const importPath = ref('/imported.bin');

  watch(
    () => props.artifacts,
    (artifacts) => {
      if (!artifacts.some((artifact) => artifact.id === importArtifactId.value)) {
        importArtifactId.value = artifacts[0]?.id ?? '';
      }
    },
    { immediate: true, deep: true },
  );

  const exportArtifact = (): void => {
    if (!exportPath.value.startsWith('/') || !exportName.value || !exportMediaType.value || props.locked) return;
    emit('export', { path: exportPath.value, name: exportName.value, mediaType: exportMediaType.value });
  };

  const importArtifact = (): void => {
    if (!importArtifactId.value || !importPath.value.startsWith('/') || props.locked) return;
    emit('import', { artifactId: importArtifactId.value, path: importPath.value });
  };
</script>

<template>
  <div class="mt-3 grid gap-3 sm:grid-cols-2">
    <form class="rounded bg-background p-2" @submit.prevent="exportArtifact">
      <div class="text-[11px] font-medium">{{ $t('agent.workspaceRuntime.exportTitle') }}</div>
      <input
        v-model.trim="exportPath"
        class="mt-2 w-full rounded border border-border bg-card px-2 py-1 text-[11px]"
        :placeholder="$t('agent.workspaceRuntime.workspacePath')"
      />
      <input
        v-model.trim="exportName"
        class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[11px]"
        :placeholder="$t('agent.workspaceRuntime.artifactName')"
      />
      <input
        v-model.trim="exportMediaType"
        class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[11px]"
        :placeholder="$t('agent.workspaceRuntime.mediaType')"
      />
      <button type="submit" class="mt-2 rounded border border-border px-2 py-1 text-[11px]" :disabled="locked">
        {{ $t('agent.workspaceRuntime.exportAction') }}
      </button>
    </form>
    <form class="rounded bg-background p-2" @submit.prevent="importArtifact">
      <div class="text-[11px] font-medium">{{ $t('agent.workspaceRuntime.importTitle') }}</div>
      <UiSelect
        class="mt-2 w-full"
        density="compact"
        :aria-label="$t('agent.workspaceRuntime.selectArtifact')"
        :model-value="importArtifactId || NONE_OPTION"
        :options="[
          { value: NONE_OPTION, label: $t('agent.workspaceRuntime.selectArtifact') },
          ...artifacts.map((artifact) => ({
            value: artifact.id,
            label: `${artifact.originalName} · ${artifact.id}`,
          })),
        ]"
        @update:model-value="(value: unknown) => (importArtifactId = value === NONE_OPTION ? '' : String(value))"
      />
      <input
        v-model.trim="importPath"
        class="mt-1 w-full rounded border border-border bg-card px-2 py-1 text-[11px]"
        :placeholder="$t('agent.workspaceRuntime.workspacePath')"
      />
      <button type="submit" class="mt-2 rounded border border-border px-2 py-1 text-[11px]" :disabled="locked">
        {{ $t('agent.workspaceRuntime.importAction') }}
      </button>
    </form>
  </div>
</template>
