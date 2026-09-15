<script setup lang="ts">
  import { computed, ref, watch } from 'vue';
  import QuantityInput from './QuantityInput.vue';
  import {
    agentApi,
    type AgentAppSummary,
    type AgentProviderView,
    type AgentSettingsView,
    type AgentSubagentProfile,
    type AgentSubagentSettingsView,
  } from '../api/agent-api';

  const props = defineProps<{
    settings: AgentSettingsView;
    apps: AgentAppSummary[];
    providers: AgentProviderView[];
    busy: boolean;
  }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const draft = ref<Record<string, number | null>>({});
  const selectedAppId = ref('');
  const profileSettings = ref<AgentSubagentSettingsView | null>(null);
  const profileBusy = ref(false);
  const profileError = ref('');

  const capabilityOptions = [
    'runs.execute',
    'machine.diagnostics.read',
    'machine.files.read',
    'workspace.runtime.execute',
    'integration.mcp.invoke',
    'artifacts.read',
    'artifacts.write',
    'storage.app',
  ];

  const modelOptions = computed(() =>
    props.providers
      .filter((provider) => provider.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          key: `${provider.id}\u0000${model.id}\u0000${provider.version}`,
          label: `${provider.displayName} · ${model.id}`,
          ref: { providerId: provider.id, modelId: model.id, configurationVersion: provider.version },
        })),
      ),
  );

  const modelKey = (model: AgentSubagentProfile['defaultModel']): string =>
    model ? `${model.providerId}\u0000${model.modelId}\u0000${model.configurationVersion}` : '';

  const cloneProfiles = (profiles: AgentSubagentProfile[]): AgentSubagentProfile[] =>
    JSON.parse(JSON.stringify(profiles)) as AgentSubagentProfile[];

  const loadProfiles = async (): Promise<void> => {
    if (!selectedAppId.value) {
      profileSettings.value = null;
      return;
    }
    profileBusy.value = true;
    profileError.value = '';
    try {
      const loaded = await agentApi.subagentSettings(selectedAppId.value);
      profileSettings.value = {
        ...loaded,
        policy: { ...loaded.policy, profiles: cloneProfiles(loaded.policy.profiles) },
      };
    } catch (cause) {
      profileError.value = cause instanceof Error ? cause.message : 'SUBAGENT_SETTINGS_FAILED';
    } finally {
      profileBusy.value = false;
    }
  };

  const addProfile = (): void => {
    if (!profileSettings.value || modelOptions.value.length === 0) return;
    const first = modelOptions.value[0]!;
    const nextIndex = profileSettings.value.policy.profiles.length + 1;
    profileSettings.value.policy.profiles.push({
      id: `worker-${nextIndex}`,
      role: 'Bounded child agent',
      defaultModel: { ...first.ref },
      allowedModels: [{ ...first.ref }],
      capabilities: ['runs.execute'],
      peerMessaging: 'parent-child',
      maxTokens: Math.min(8192, props.settings.hardLimits.maxRunTokens),
      maxSteps: Math.min(12, props.settings.hardLimits.maxRunSteps),
      failureMode: 'isolate',
    });
  };

  const removeProfile = (index: number): void => {
    profileSettings.value?.policy.profiles.splice(index, 1);
  };

  const setDefaultModel = (profile: AgentSubagentProfile, key: string): void => {
    const selected = modelOptions.value.find((candidate) => candidate.key === key);
    if (!selected) return;
    profile.defaultModel = { ...selected.ref };
    if (!profile.allowedModels.some((model) => modelKey(model) === key))
      profile.allowedModels.push({ ...selected.ref });
  };

  const toggleAllowedModel = (profile: AgentSubagentProfile, key: string, checked: boolean): void => {
    const selected = modelOptions.value.find((candidate) => candidate.key === key);
    if (!selected) return;
    if (checked) {
      if (!profile.allowedModels.some((model) => modelKey(model) === key))
        profile.allowedModels.push({ ...selected.ref });
      if (!profile.defaultModel) profile.defaultModel = { ...selected.ref };
      return;
    }
    if (profile.allowedModels.length <= 1 || modelKey(profile.defaultModel) === key) return;
    profile.allowedModels = profile.allowedModels.filter((model) => modelKey(model) !== key);
  };

  const toggleCapability = (profile: AgentSubagentProfile, capability: string, checked: boolean): void => {
    if (checked) {
      if (!profile.capabilities.includes(capability)) profile.capabilities.push(capability);
    } else {
      profile.capabilities = profile.capabilities.filter((item) => item !== capability);
    }
  };

  const saveProfiles = async (): Promise<void> => {
    if (!profileSettings.value || !selectedAppId.value || profileBusy.value || invalidProfileLimits.value) return;
    profileBusy.value = true;
    profileError.value = '';
    try {
      const updated = await agentApi.replaceSubagentProfiles(
        selectedAppId.value,
        profileSettings.value.policy.profiles,
        profileSettings.value.version,
      );
      profileSettings.value = {
        ...updated,
        policy: { ...updated.policy, profiles: cloneProfiles(updated.policy.profiles) },
      };
    } catch (cause) {
      profileError.value = cause instanceof Error ? cause.message : 'SUBAGENT_SETTINGS_FAILED';
    } finally {
      profileBusy.value = false;
    }
  };

  watch(
    () => props.settings.revision,
    () => {
      draft.value = { ...props.settings.requestedSettings.subagents };
    },
    { immediate: true },
  );

  watch(
    () => props.apps.map((app) => app.id).join('\u0000'),
    () => {
      if (!props.apps.some((app) => app.id === selectedAppId.value)) selectedAppId.value = props.apps[0]?.id ?? '';
    },
    { immediate: true },
  );
  watch(selectedAppId, loadProfiles, { immediate: true });

  const invalidGlobalLimits = computed(() => Object.values(draft.value).some((value) => value === null || value < 1));
  const invalidProfileLimits = computed(() =>
    Boolean(
      profileSettings.value?.policy.profiles.some(
        (profile) =>
          !Number.isSafeInteger(profile.maxTokens) ||
          profile.maxTokens < 1 ||
          !Number.isSafeInteger(profile.maxSteps) ||
          profile.maxSteps < 1,
      ),
    ),
  );

  const saveGlobalLimits = (): void => {
    if (invalidGlobalLimits.value) return;
    emit('save', draft.value);
  };

  const subagentLabels: Record<string, string> = {
    maxDelegationDepth: '最大委派深度',
    maxSubagentMessagesPerRun: '最大公开消息数/Run',
    maxSubagentMessageBytesPerRun: '最大公开消息字节/Run',
  };
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div>
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.subagents.title') }}</h3>
        <p class="mt-0.5 text-xs text-text-secondary">{{ $t('agent.settings.subagents.description') }}</p>
      </div>
      <span class="rounded-full border border-border/80 bg-background px-2.5 py-0.5 text-xs text-text-secondary">
        {{ $t('agent.settings.subagents.phase') }}
      </span>
    </div>
    <div class="space-y-4 p-4 sm:p-5">
      <div class="mt-4 grid gap-3 md:grid-cols-3">
        <label v-for="(_, key) in settings.requestedSettings.subagents" :key="key" class="block">
          <span class="mb-1 block text-xs font-medium text-foreground">{{ subagentLabels[key] || key }}</span>
          <QuantityInput
            v-model="draft[String(key)]"
            :type="key === 'maxSubagentMessageBytesPerRun' ? 'bytes' : 'number'"
            :placeholder="
              key === 'maxSubagentMessageBytesPerRun'
                ? $t('agent.settings.subagents.messageBytesPlaceholder')
                : $t('agent.settings.quantity.placeholderNumber')
            "
            :min="1"
            :disabled="busy"
          />
        </label>
      </div>
      <div class="mt-4 flex justify-end">
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="busy || invalidGlobalLimits"
          @click="saveGlobalLimits"
        >
          {{ $t('common.save') }}
        </button>
      </div>

      <div class="mt-5 border-t border-border pt-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
          <label class="min-w-52">
            <span class="mb-1 block text-xs font-medium text-text-secondary">{{
              $t('agent.settings.subagents.appProfiles')
            }}</span>
            <select
              v-model="selectedAppId"
              class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option v-for="app in apps" :key="app.id" :value="app.id">{{ app.displayName }}</option>
            </select>
          </label>
          <button
            type="button"
            class="rounded-md border border-border px-3 py-2 text-xs disabled:opacity-50"
            :disabled="profileBusy || modelOptions.length === 0"
            @click="addProfile"
          >
            {{ $t('agent.settings.subagents.addProfile') }}
          </button>
        </div>
        <p class="mt-2 text-xs text-text-secondary">{{ $t('agent.settings.subagents.profileHint') }}</p>
        <p v-if="profileError" class="mt-2 text-xs text-error">{{ profileError }}</p>

        <div v-if="profileSettings" class="mt-3 space-y-3">
          <article
            v-for="(profile, index) in profileSettings.policy.profiles"
            :key="`${profile.id}:${index}`"
            class="rounded-md border border-border bg-background p-4"
          >
            <div class="grid gap-3 lg:grid-cols-3">
              <label>
                <span class="mb-1 block text-xs text-text-secondary">{{
                  $t('agent.settings.subagents.profileId')
                }}</span>
                <input v-model="profile.id" class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm" />
              </label>
              <label class="lg:col-span-2">
                <span class="mb-1 block text-xs text-text-secondary">{{ $t('agent.settings.subagents.role') }}</span>
                <input v-model="profile.role" class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm" />
              </label>
              <label>
                <span class="mb-1 block text-xs text-text-secondary">{{
                  $t('agent.settings.subagents.defaultModel')
                }}</span>
                <select
                  :value="modelKey(profile.defaultModel)"
                  class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                  @change="setDefaultModel(profile, ($event.target as HTMLSelectElement).value)"
                >
                  <option v-for="model in modelOptions" :key="model.key" :value="model.key">{{ model.label }}</option>
                </select>
              </label>
              <label>
                <span class="mb-1 block text-xs text-text-secondary">{{
                  $t('agent.settings.subagents.maxTokens')
                }}</span>
                <QuantityInput
                  v-model="profile.maxTokens"
                  type="tokens"
                  :placeholder="$t('agent.settings.subagents.maxTokensPlaceholder')"
                  :min="1"
                  :disabled="busy || profileBusy"
                />
              </label>
              <label>
                <span class="mb-1 block text-xs text-text-secondary">{{
                  $t('agent.settings.subagents.maxSteps')
                }}</span>
                <input
                  v-model.number="profile.maxSteps"
                  type="number"
                  min="1"
                  class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                />
              </label>
              <label>
                <span class="mb-1 block text-xs text-text-secondary">{{
                  $t('agent.settings.subagents.peerMessaging')
                }}</span>
                <select
                  v-model="profile.peerMessaging"
                  class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                >
                  <option value="parent-child">{{ $t('agent.settings.subagents.peerParentChild') }}</option>
                  <option value="same-run">{{ $t('agent.settings.subagents.peerSameRun') }}</option>
                </select>
              </label>
              <label>
                <span class="mb-1 block text-xs text-text-secondary">{{
                  $t('agent.settings.subagents.failureMode')
                }}</span>
                <select
                  v-model="profile.failureMode"
                  class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                >
                  <option value="isolate">{{ $t('agent.settings.subagents.failureIsolate') }}</option>
                  <option value="failFast">{{ $t('agent.settings.subagents.failureFailFast') }}</option>
                </select>
              </label>
            </div>

            <div class="mt-3">
              <div class="text-xs text-text-secondary">{{ $t('agent.settings.subagents.allowedModels') }}</div>
              <div class="mt-1 flex flex-wrap gap-2">
                <label v-for="model in modelOptions" :key="model.key" class="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    :checked="profile.allowedModels.some((item) => modelKey(item) === model.key)"
                    @change="toggleAllowedModel(profile, model.key, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ model.label }}
                </label>
              </div>
            </div>

            <div class="mt-3">
              <div class="text-xs text-text-secondary">{{ $t('agent.settings.subagents.capabilities') }}</div>
              <div class="mt-1 flex flex-wrap gap-2">
                <label
                  v-for="capability in capabilityOptions"
                  :key="capability"
                  class="flex items-center gap-1 text-xs"
                >
                  <input
                    type="checkbox"
                    :checked="profile.capabilities.includes(capability)"
                    @change="toggleCapability(profile, capability, ($event.target as HTMLInputElement).checked)"
                  />
                  {{ capability }}
                </label>
              </div>
            </div>

            <div class="mt-3 flex justify-end">
              <button type="button" class="text-xs text-error" :disabled="profileBusy" @click="removeProfile(index)">
                {{ $t('agent.settings.subagents.removeProfile') }}
              </button>
            </div>
          </article>
          <p v-if="profileSettings.policy.profiles.length === 0" class="text-xs text-text-secondary">
            {{ $t('agent.settings.subagents.noProfiles') }}
          </p>
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            :disabled="profileBusy || !profileSettings || invalidProfileLimits"
            @click="saveProfiles"
          >
            {{ $t('agent.settings.subagents.saveProfiles') }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
