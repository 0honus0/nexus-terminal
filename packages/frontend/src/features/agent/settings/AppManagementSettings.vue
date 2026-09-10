<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { agentApi, type AgentAppGrantView, type AgentAppSummary } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; busy: boolean }>();
  const emit = defineEmits<{
    toggle: [app: AgentAppSummary, enabled: boolean];
    grantsUpdated: [app: AgentAppSummary];
  }>();

  const grantViews = ref<Record<string, AgentAppGrantView>>({});
  const drafts = ref<Record<string, string[]>>({});
  const grantBusy = ref<Record<string, boolean>>({});
  const grantErrors = ref<Record<string, string>>({});

  const explain = (cause: unknown): string => {
    if (cause && typeof cause === 'object' && 'response' in cause) {
      const response = (cause as { response?: { data?: { error?: { message?: string; code?: string } } } }).response;
      return response?.data?.error?.message || response?.data?.error?.code || 'AGENT_REQUEST_FAILED';
    }
    return cause instanceof Error ? cause.message : 'AGENT_REQUEST_FAILED';
  };

  const loadGrant = async (appId: string): Promise<void> => {
    try {
      const view = await agentApi.appGrants(appId);
      grantViews.value = { ...grantViews.value, [appId]: view };
      drafts.value = { ...drafts.value, [appId]: view.grants.map((grant) => grant.capability) };
      const next = { ...grantErrors.value };
      delete next[appId];
      grantErrors.value = next;
    } catch (cause) {
      grantErrors.value = { ...grantErrors.value, [appId]: explain(cause) };
    }
  };

  watch(
    () => props.apps.map((app) => `${app.id}@${app.version}#${app.stateVersion}`).join('|'),
    () => {
      for (const app of props.apps) void loadGrant(app.id);
    },
    { immediate: true },
  );

  const checked = (appId: string, capability: string): boolean => (drafts.value[appId] ?? []).includes(capability);

  const grantChanged = (appId: string): boolean => {
    const view = grantViews.value[appId];
    if (!view) return false;
    const current = [...new Set(view.grants.map((grant) => grant.capability))].sort();
    const draft = [...new Set(drafts.value[appId] ?? [])].sort();
    return current.length !== draft.length || current.some((capability, index) => capability !== draft[index]);
  };

  const toggleCapability = (appId: string, capability: string, enabled: boolean): void => {
    const current = new Set(drafts.value[appId] ?? []);
    if (enabled) current.add(capability);
    else current.delete(capability);
    drafts.value = { ...drafts.value, [appId]: [...current] };
  };

  const onCapabilityChange = (appId: string, capability: string, event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    toggleCapability(appId, capability, target.checked);
  };

  const saveGrants = async (appId: string): Promise<void> => {
    const view = grantViews.value[appId];
    if (!view || grantBusy.value[appId] || props.busy) return;
    grantBusy.value = { ...grantBusy.value, [appId]: true };
    try {
      const updated = await agentApi.replaceAppGrants(appId, drafts.value[appId] ?? [], view.policyRevision);
      grantViews.value = { ...grantViews.value, [appId]: updated };
      drafts.value = { ...drafts.value, [appId]: updated.grants.map((grant) => grant.capability) };
      const next = { ...grantErrors.value };
      delete next[appId];
      grantErrors.value = next;
      emit('grantsUpdated', updated.app);
    } catch (cause) {
      grantErrors.value = { ...grantErrors.value, [appId]: explain(cause) };
      await loadGrant(appId);
    } finally {
      grantBusy.value = { ...grantBusy.value, [appId]: false };
    }
  };
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <h2 class="text-base font-semibold">{{ $t('agent.settings.apps.title') }}</h2>
    <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.apps.description') }}</p>
    <div class="mt-4 space-y-3">
      <div v-for="app in apps" :key="app.id" class="rounded-md bg-background p-3">
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ app.displayName }}</span>
              <span class="rounded bg-header px-2 py-0.5 text-xs text-text-secondary">{{ app.health }}</span>
            </div>
            <p class="mt-1 truncate text-xs text-text-secondary">{{ app.id }} · v{{ app.version }}</p>
            <p class="mt-1 text-xs text-text-secondary">
              {{
                $t('agent.settings.apps.activity', {
                  runs: app.runningRuns,
                  approvals: app.pendingApprovals,
                  budget: app.pendingBudgetRequests,
                })
              }}
            </p>
          </div>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            :class="app.enabled ? 'bg-header text-foreground' : 'bg-primary text-white'"
            :disabled="busy"
            @click="emit('toggle', app, !app.enabled)"
          >
            {{ app.enabled ? $t('agent.settings.apps.disable') : $t('agent.settings.apps.enable') }}
          </button>
        </div>

        <div class="mt-3 border-t border-border pt-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs font-medium">{{ $t('agent.settings.apps.permissions') }}</p>
              <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.apps.permissionsHint') }}</p>
            </div>
            <button
              v-if="grantViews[app.id]"
              type="button"
              class="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-header disabled:opacity-50"
              :disabled="busy || grantBusy[app.id] || !grantChanged(app.id)"
              @click="saveGrants(app.id)"
            >
              {{
                grantBusy[app.id]
                  ? $t('agent.settings.apps.savingPermissions')
                  : $t('agent.settings.apps.savePermissions')
              }}
            </button>
          </div>

          <div v-if="grantViews[app.id]" class="mt-2">
            <div v-if="grantViews[app.id].declaredCapabilities.length" class="grid gap-2 sm:grid-cols-2">
              <label
                v-for="capability in grantViews[app.id].declaredCapabilities"
                :key="capability"
                class="flex items-center gap-2 rounded border border-border bg-card px-2.5 py-2 text-xs"
              >
                <input
                  type="checkbox"
                  class="h-4 w-4 accent-primary"
                  :checked="checked(app.id, capability)"
                  :disabled="busy || grantBusy[app.id]"
                  @change="onCapabilityChange(app.id, capability, $event)"
                />
                <span class="break-all font-mono">{{ capability }}</span>
              </label>
            </div>
            <p v-else class="text-xs text-text-secondary">{{ $t('agent.settings.apps.noCapabilities') }}</p>
          </div>
          <p v-else-if="!grantErrors[app.id]" class="mt-2 text-xs text-text-secondary">
            {{ $t('agent.settings.apps.permissionsLoading') }}
          </p>
          <p v-if="grantErrors[app.id]" class="mt-2 text-xs text-error">{{ grantErrors[app.id] }}</p>
        </div>
      </div>
      <p v-if="apps.length === 0" class="text-sm text-text-secondary">{{ $t('agent.settings.apps.empty') }}</p>
    </div>
  </section>
</template>
