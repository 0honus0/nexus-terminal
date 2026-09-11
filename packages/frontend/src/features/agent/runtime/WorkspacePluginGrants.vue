<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import type { AgentWorkspaceView, PluginWorkspaceGrant, PluginWorkspacePermission } from '../api/agent-api';

  interface WorkspacePluginTarget {
    key: string;
    workspace: AgentWorkspaceView;
    targetPluginId: string;
    label: string;
  }

  const props = defineProps<{
    targets: WorkspacePluginTarget[];
    modelValue: string;
    grants: PluginWorkspaceGrant[];
    locked: boolean;
  }>();

  const emit = defineEmits<{
    'update:modelValue': [value: string];
    add: [grant: { principalPluginId: string; path: string; permissions: PluginWorkspacePermission[] }];
    remove: [index: number];
  }>();

  const grantPrincipal = ref('');
  const grantPath = ref('/**');
  const grantPermissions = ref<PluginWorkspacePermission[]>(['read', 'list']);

  const selected = computed(() => props.targets.find((item) => item.key === props.modelValue) ?? null);
  const principalCandidates = computed(() => {
    if (!selected.value) return [];
    return selected.value.workspace.profile.runnerPlugins.filter(
      (target) => target.pluginId !== selected.value!.targetPluginId,
    );
  });

  const resetPrincipal = (): void => {
    grantPrincipal.value = principalCandidates.value[0]?.pluginId ?? '';
  };
  watch(() => [props.modelValue, props.targets] as const, resetPrincipal, { immediate: true, deep: true });

  const addGrant = (): void => {
    if (
      !selected.value ||
      !grantPrincipal.value ||
      !grantPath.value.startsWith('/') ||
      grantPermissions.value.length === 0
    )
      return;
    emit('add', {
      principalPluginId: grantPrincipal.value,
      path: grantPath.value,
      permissions: [...grantPermissions.value],
    });
  };
</script>

<template>
  <div v-if="targets.length" class="mt-4 border-t border-border pt-3">
    <h4 class="font-medium">{{ $t('agent.workspaceRuntime.workspaceTitle') }}</h4>
    <p class="mt-0.5 text-[9px] text-text-secondary">{{ $t('agent.workspaceRuntime.workspaceHint') }}</p>
    <select
      :value="modelValue"
      class="mt-2 w-full rounded border border-border bg-background px-2 py-1 text-[10px]"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="workspaceTarget in targets" :key="workspaceTarget.key" :value="workspaceTarget.key">
        {{ workspaceTarget.label }}
      </option>
    </select>

    <div v-if="selected" class="mt-3 rounded bg-background p-2">
      <div class="text-[10px] font-medium">{{ $t('agent.workspaceRuntime.workspaceAcl') }}</div>
      <p v-if="grants.length === 0" class="mt-1 text-[9px] text-text-secondary">
        {{ $t('agent.workspaceRuntime.defaultDeny') }}
      </p>
      <div
        v-for="(grant, index) in grants"
        :key="`${grant.principalPluginId}:${grant.path}`"
        class="mt-2 flex items-start justify-between gap-2 rounded border border-border p-2 text-[9px]"
      >
        <div class="min-w-0 break-words">
          <div class="font-medium">{{ grant.principalPluginId }}</div>
          <div>
            {{ grant.path }} ·
            {{
              grant.permissions.map((permission) => $t(`agent.workspaceRuntime.permission.${permission}`)).join(', ')
            }}
          </div>
        </div>
        <button type="button" class="text-error" :disabled="locked" @click="emit('remove', index)">
          {{ $t('agent.workspaceRuntime.revoke') }}
        </button>
      </div>
      <div v-if="principalCandidates.length" class="mt-3 grid gap-2">
        <select v-model="grantPrincipal" class="rounded border border-border bg-card px-2 py-1 text-[10px]">
          <option v-for="principal in principalCandidates" :key="principal.pluginId" :value="principal.pluginId">
            {{ principal.pluginId }}
          </option>
        </select>
        <input
          v-model.trim="grantPath"
          class="rounded border border-border bg-card px-2 py-1 text-[10px]"
          :placeholder="$t('agent.workspaceRuntime.pathPlaceholder')"
        />
        <div class="flex flex-wrap gap-2 text-[9px]">
          <label
            v-for="permission in ['read', 'write', 'list', 'delete'] as PluginWorkspacePermission[]"
            :key="permission"
            class="flex items-center gap-1"
          >
            <input v-model="grantPermissions" type="checkbox" :value="permission" />
            {{ $t(`agent.workspaceRuntime.permission.${permission}`) }}
          </label>
        </div>
        <button
          type="button"
          class="w-fit rounded border border-border px-2 py-1 text-[10px]"
          :disabled="locked || !grantPrincipal || !grantPath.startsWith('/') || grantPermissions.length === 0"
          @click="addGrant"
        >
          {{ $t('agent.workspaceRuntime.grant') }}
        </button>
      </div>
      <p v-else class="mt-2 text-[9px] text-text-secondary">
        {{ $t('agent.workspaceRuntime.noCrossPluginPrincipal') }}
      </p>
    </div>
  </div>
</template>
