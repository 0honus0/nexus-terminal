<script setup lang="ts">
  import { UiButton, UiCheckbox, UiInfoHint } from '@/foundation/ui';
  import { computed, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import QuantityInput from './QuantityInput.vue';
  import {
    agentApi,
    type AgentAppSummaryDto,
    type AgentProviderViewDto,
    type AgentSettingsViewDto,
    type AgentSubagentProfileDto,
    type AgentSubagentProfileTemplateDto,
    type AgentSubagentSettingsViewDto,
  } from '../api/agent-api';

  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.subagents');

  const props = defineProps<{
    settings: AgentSettingsViewDto;
    apps: AgentAppSummaryDto[];
    providers: AgentProviderViewDto[];
    busy: boolean;
  }>();
  const emit = defineEmits<{ save: [patch: Record<string, unknown>] }>();
  const draft = ref<Record<string, number | null>>({});
  const selectedAppId = ref('');
  const profileSettings = ref<AgentSubagentSettingsViewDto | null>(null);
  const profileBusy = ref(false);
  const selectedTemplateId = ref<AgentSubagentProfileTemplateDto['id']>('explore');

  type CapabilityId = AgentSubagentProfileDto['capabilities'][number];
  const capabilityOptions = ref<CapabilityId[]>([]);

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

  const modelKey = (model: AgentSubagentProfileDto['defaultModel']): string =>
    model ? `${model.providerId}\u0000${model.modelId}\u0000${model.configurationVersion}` : '';
  const preferredModel = computed(() => {
    const requested = props.settings.requestedSettings.model;
    return (
      modelOptions.value.find(
        (candidate) =>
          candidate.ref.providerId === requested.defaultProviderId &&
          candidate.ref.modelId === requested.defaultModelId,
      ) ?? modelOptions.value[0]
    );
  });

  const cloneProfiles = (profiles: AgentSubagentProfileDto[]): AgentSubagentProfileDto[] =>
    JSON.parse(JSON.stringify(profiles)) as AgentSubagentProfileDto[];

  const loadProfiles = async (): Promise<void> => {
    if (!selectedAppId.value) {
      profileSettings.value = null;
      return;
    }
    profileBusy.value = true;
    try {
      const [loaded, grantView] = await Promise.all([
        agentApi.subagentSettings(selectedAppId.value),
        agentApi.appGrants(selectedAppId.value),
      ]);
      capabilityOptions.value = grantView.grants.map((grant) => grant.capability);
      profileSettings.value = {
        ...loaded,
        policy: { ...loaded.policy, profiles: cloneProfiles(loaded.policy.profiles) },
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'SUBAGENT_SETTINGS_FAILED';
      operationFeedback.notifyError({ operation: 'load-profiles', message, cause });
    } finally {
      profileBusy.value = false;
    }
  };

  const addProfile = (): void => {
    if (!profileSettings.value || !preferredModel.value) return;
    const first = preferredModel.value;
    const nextIndex = profileSettings.value.policy.profiles.length + 1;
    profileSettings.value.policy.profiles.push({
      id: `worker-${nextIndex}`,
      role: 'Bounded child agent',
      defaultModel: { ...first.ref },
      allowedModels: [{ ...first.ref }],
      capabilities: [],
      peerMessaging: 'parent-child',
      mutationMode: 'read-only',
      maxSteps: Math.min(12, props.settings.hardLimits.maxRunSteps),
      failureMode: 'isolate',
    });
  };

  const availableProfileId = (base: string): string => {
    const used = new Set(profileSettings.value?.policy.profiles.map((profile) => profile.id) ?? []);
    if (!used.has(base)) return base;
    for (let suffix = 2; suffix <= 99; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${base}-copy`;
  };

  const addTemplateProfile = (): void => {
    if (!profileSettings.value || !preferredModel.value) return;
    const template = profileSettings.value.templates.find((candidate) => candidate.id === selectedTemplateId.value);
    if (!template) return;
    const model = preferredModel.value.ref;
    profileSettings.value.policy.profiles.push({
      id: availableProfileId(template.id),
      role: template.role,
      defaultModel: { ...model },
      allowedModels: [{ ...model }],
      capabilities: [...template.capabilities],
      peerMessaging: template.peerMessaging,
      mutationMode: template.mutationMode,
      maxSteps: Math.min(template.maxSteps, props.settings.hardLimits.maxRunSteps),
      failureMode: template.failureMode,
    });
  };

  const removeProfile = (index: number): void => {
    profileSettings.value?.policy.profiles.splice(index, 1);
  };

  const setDefaultModel = (profile: AgentSubagentProfileDto, key: string): void => {
    const selected = modelOptions.value.find((candidate) => candidate.key === key);
    if (!selected) return;
    profile.defaultModel = { ...selected.ref };
    if (!profile.allowedModels.some((model) => modelKey(model) === key))
      profile.allowedModels.push({ ...selected.ref });
  };

  const toggleAllowedModel = (profile: AgentSubagentProfileDto, key: string, checked: boolean): void => {
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

  const toggleCapability = (profile: AgentSubagentProfileDto, capability: CapabilityId, checked: boolean): void => {
    if (checked) {
      if (!profile.capabilities.includes(capability)) profile.capabilities.push(capability);
    } else {
      profile.capabilities = profile.capabilities.filter((item) => item !== capability);
    }
  };

  const saveProfiles = async (): Promise<void> => {
    if (!profileSettings.value || !selectedAppId.value || profileBusy.value || invalidProfileLimits.value) return;
    profileBusy.value = true;
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
      operationFeedback.notifySuccess(t('agent.ui.saved'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'SUBAGENT_SETTINGS_FAILED';
      operationFeedback.notifyError({ operation: 'save-profiles', message, cause });
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
        (profile) => !Number.isSafeInteger(profile.maxSteps) || profile.maxSteps < 1,
      ),
    ),
  );

  const saveGlobalLimits = (): void => {
    if (invalidGlobalLimits.value) return;
    emit('save', draft.value);
  };

  const subagentLabels = computed<Record<string, string>>(() => ({
    maxDelegationDepth: t('agent.settings.subagents.labels.maxDelegationDepth'),
    maxSubagentMessagesPerRun: t('agent.settings.subagents.labels.maxSubagentMessagesPerRun'),
    maxSubagentMessageBytesPerRun: t('agent.settings.subagents.labels.maxSubagentMessageBytesPerRun'),
  }));
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/35">
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-header/40 px-4 py-3 sm:px-5 sm:py-3.5"
    >
      <div class="flex items-center gap-1.5">
        <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.subagents.title') }}</h3>
        <UiInfoHint :text="$t('agent.settings.subagents.description')" />
      </div>
      <span class="rounded-full border border-border/80 bg-background px-2.5 py-0.5 text-xs text-text-secondary">
        {{ $t('agent.settings.subagents.phase') }}
      </span>
    </div>
    <div class="space-y-4 p-4 sm:p-5">
      <div
        class="flex items-start gap-2.5 rounded-lg bg-header/30 px-3 py-2.5 text-[11px] leading-relaxed text-text-secondary"
      >
        <i class="fa-solid fa-diagram-project mt-0.5 shrink-0 text-[10px] text-primary/75" aria-hidden="true"></i>
        <span>{{ $t('agent.settings.subagents.concurrencyHint') }}</span>
      </div>
      <div class="grid gap-3 md:grid-cols-3">
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
        <UiButton
          appearance="solid"
          tone="primary"
          type="button"
          :disabled="busy || invalidGlobalLimits"
          @click="saveGlobalLimits"
        >
          {{ $t('common.save') }}
        </UiButton>
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
          <div class="flex flex-wrap items-end gap-2">
            <label v-if="profileSettings?.templates.length" class="min-w-40">
              <span class="mb-1 block text-xs font-medium text-text-secondary">{{
                $t('agent.settings.subagents.templatePreset')
              }}</span>
              <select
                v-model="selectedTemplateId"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-xs"
                :disabled="profileBusy"
              >
                <option v-for="template in profileSettings.templates" :key="template.id" :value="template.id">
                  {{ $t(`agent.settings.subagents.template${template.id[0]!.toUpperCase()}${template.id.slice(1)}`) }}
                </option>
              </select>
            </label>
            <UiButton
              appearance="soft"
              tone="neutral"
              v-if="profileSettings?.templates.length"
              type="button"
              :disabled="profileBusy || !preferredModel"
              @click="addTemplateProfile"
            >
              {{ $t('agent.settings.subagents.addTemplate') }}
            </UiButton>
            <UiButton
              appearance="soft"
              tone="neutral"
              type="button"
              :disabled="profileBusy || !preferredModel"
              @click="addProfile"
            >
              {{ $t('agent.settings.subagents.addProfile') }}
            </UiButton>
          </div>
        </div>
        <p class="mt-2 text-xs text-text-secondary">{{ $t('agent.settings.subagents.profileHint') }}</p>
        <p v-if="profileSettings?.templates.length" class="mt-1 text-xs text-text-secondary">
          {{ $t('agent.settings.subagents.templateHint') }}
        </p>

        <div v-if="profileSettings" class="mt-3 space-y-3">
          <article
            v-for="(profile, index) in profileSettings.policy.profiles"
            :key="`${profile.id}:${index}`"
            class="rounded-lg bg-header/25 p-4"
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
                  $t('agent.settings.subagents.mutationMode')
                }}</span>
                <select
                  v-model="profile.mutationMode"
                  class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                >
                  <option value="read-only">{{ $t('agent.settings.subagents.mutationReadOnly') }}</option>
                  <option value="governed">{{ $t('agent.settings.subagents.mutationGoverned') }}</option>
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
            <p v-if="profile.mutationMode === 'governed'" class="mt-2 text-[11px] leading-relaxed text-text-secondary">
              {{ $t('agent.settings.subagents.mutationHint') }}
            </p>

            <div class="mt-3">
              <div class="text-xs text-text-secondary">{{ $t('agent.settings.subagents.allowedModels') }}</div>
              <div class="mt-1 flex flex-wrap gap-2">
                <label v-for="model in modelOptions" :key="model.key" class="flex items-center gap-1 text-xs">
                  <UiCheckbox
                    :model-value="profile.allowedModels.some((item) => modelKey(item) === model.key)"
                    @update:model-value="(value: boolean) => toggleAllowedModel(profile, model.key, value)"
                  />
                  <span>{{ model.label }}</span>
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
                  <UiCheckbox
                    :model-value="profile.capabilities.includes(capability)"
                    @update:model-value="(value: boolean) => toggleCapability(profile, capability, value)"
                  />
                  <span>{{ capability }}</span>
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
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="profileBusy || !profileSettings || invalidProfileLimits"
            @click="saveProfiles"
          >
            {{ $t('agent.settings.subagents.saveProfiles') }}
          </UiButton>
        </div>
      </div>
    </div>
  </section>
</template>
