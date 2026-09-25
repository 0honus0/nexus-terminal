<script setup lang="ts">
  import { BaseModal, UiButton, UiCheckbox, UiInfoHint, UiSelect } from '@/foundation/ui';
  import { computed, reactive, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useFeedback, useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAcpIntegrationConfigurationDto,
    type AgentIntegrationViewDto,
    type AgentSettingsViewDto,
  } from '../api/agent-api';
  import { parseAcpCommandToArgv } from './acp-command-argv';

  type Profile = AgentSettingsViewDto['requestedSettings']['workspaceRuntime']['acpProfiles'][number];
  interface ProfileDraft {
    id: string;
    argvText: string;
    cwd: string;
  }

  const DEFAULT_AGENT_APP_ID = 'nexus.agent';
  const props = defineProps<{
    settings: AgentSettingsViewDto;
    busy: boolean;
    agentAvailable: boolean;
    saveProfiles: (profiles: Profile[], success?: string | null) => Promise<boolean>;
  }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const operationFeedback = useOperationFeedback('agent.settings.acp-runtime');

  const draftProfilesFromProps = (): ProfileDraft[] =>
    props.settings.requestedSettings.workspaceRuntime.acpProfiles.map((profile) => ({
      id: profile.id,
      argvText: JSON.stringify(profile.argv),
      cwd: profile.cwd,
    }));

  const profileBaseline = ref<ProfileDraft[]>(draftProfilesFromProps());
  const profiles = ref<ProfileDraft[]>(profileBaseline.value.map((profile) => ({ ...profile })));
  const integrations = ref<AgentIntegrationViewDto[]>([]);
  const localBusy = ref(false);
  const loading = ref(false);
  const disabled = computed(() => props.busy || localBusy.value);
  const integrationDisabled = computed(() => disabled.value || !props.agentAvailable);
  let integrationsGeneration = 0;
  const configuredProfiles = computed(() => props.settings.effectiveSettings.workspaceRuntime.acpProfiles);
  const profileOptions = computed(() =>
    configuredProfiles.value.map((profile) => ({ value: profile.id, label: profile.id })),
  );

  const acpConfiguration = (integration: AgentIntegrationViewDto): AgentAcpIntegrationConfigurationDto => {
    if (integration.kind !== 'acp' || integration.configuration.transport !== 'workspace-profile') {
      throw new Error('ACP_INTEGRATION_INVALID');
    }
    return integration.configuration as AgentAcpIntegrationConfigurationDto;
  };

  const syncProfiles = (): void => {
    const next = draftProfilesFromProps();
    profileBaseline.value = next.map((profile) => ({ ...profile }));
    profiles.value = next;
  };
  const profilesDirty = computed(() => JSON.stringify(profiles.value) !== JSON.stringify(profileBaseline.value));
  const remoteMatchesProfiles = computed(
    () => JSON.stringify(profiles.value) === JSON.stringify(draftProfilesFromProps()),
  );

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'), t);

  const loadIntegrations = async (): Promise<void> => {
    const generation = ++integrationsGeneration;
    if (!props.agentAvailable) {
      integrations.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const next = await agentApi.integrations(DEFAULT_AGENT_APP_ID, 'acp');
      if (generation !== integrationsGeneration || !props.agentAvailable) return;
      integrations.value = next;
    } catch (cause) {
      if (generation !== integrationsGeneration || !props.agentAvailable) return;
      operationFeedback.notifyError({ operation: 'load-integrations', message: explain(cause), cause });
    } finally {
      if (generation === integrationsGeneration) loading.value = false;
    }
  };

  const run = async (operation: string, action: () => Promise<void>, success = ''): Promise<void> => {
    if (integrationDisabled.value) return;
    localBusy.value = true;
    try {
      await action();
      if (success) operationFeedback.notifySuccess(success);
    } catch (cause) {
      operationFeedback.notifyError({ operation, message: explain(cause), cause });
    } finally {
      localBusy.value = false;
    }
  };

  const normalizeProfiles = (draftList: ProfileDraft[]): Profile[] => {
    const normalized: Profile[] = draftList.map((profile) => {
      const id = profile.id.trim();
      if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(id)) throw new Error('ACP_PROFILE_ID_INVALID');
      let parsed: unknown;
      try {
        parsed = JSON.parse(profile.argvText);
      } catch {
        throw new Error('ACP_PROFILE_ARGV_INVALID');
      }
      if (
        !Array.isArray(parsed) ||
        parsed.length < 1 ||
        parsed.length > 64 ||
        parsed.some((item) => typeof item !== 'string' || item.includes('\u0000'))
      ) {
        throw new Error('ACP_PROFILE_ARGV_INVALID');
      }
      const cwd = profile.cwd.trim();
      if (cwd !== '/workspace' && !cwd.startsWith('/workspace/')) throw new Error('ACP_PROFILE_CWD_INVALID');
      return { id, argv: parsed as string[], cwd };
    });
    if (new Set(normalized.map((profile) => profile.id)).size !== normalized.length) {
      throw new Error('ACP_PROFILE_ID_DUPLICATE');
    }
    return normalized;
  };

  // 模态弹窗 1：添加配置档 (Profile)
  const profileModalOpen = ref(false);
  const profileModalError = ref('');
  const editingProfileId = ref<string | null>(null);
  const editingProfileIdLocked = ref(false);
  const profileForm = reactive({
    id: '',
    cwd: '/workspace/work',
    commandInput: 'acp-agent',
  });

  const isProfileIdValid = computed(() => /^[a-z][a-z0-9_.-]{0,127}$/.test(profileForm.id.trim()));
  const isProfileIdDuplicate = computed(() =>
    profiles.value.some(
      (candidate) => candidate.id === profileForm.id.trim() && candidate.id !== editingProfileId.value,
    ),
  );
  const isCwdValid = computed(() => {
    const cwd = profileForm.cwd.trim();
    return cwd === '/workspace' || cwd.startsWith('/workspace/');
  });
  const parsedModalArgv = computed(() => parseAcpCommandToArgv(profileForm.commandInput));
  const isArgvValid = computed(
    () => parsedModalArgv.value !== null && parsedModalArgv.value.length >= 1 && parsedModalArgv.value.length <= 64,
  );
  const canSubmitProfile = computed(
    () =>
      isProfileIdValid.value && !isProfileIdDuplicate.value && isCwdValid.value && isArgvValid.value && !disabled.value,
  );

  const openAddProfileModal = (): void => {
    editingProfileId.value = null;
    editingProfileIdLocked.value = false;
    let index = profiles.value.length + 1;
    let defaultId = `acp-profile-${index}`;
    while (profiles.value.some((candidate) => candidate.id === defaultId)) defaultId = `acp-profile-${++index}`;

    profileForm.id = defaultId;
    profileForm.cwd = '/workspace/work';
    profileForm.commandInput = 'acp-agent';
    profileModalError.value = '';
    profileModalOpen.value = true;
  };

  const openEditProfileModal = (profile: ProfileDraft): void => {
    editingProfileId.value = profile.id;
    editingProfileIdLocked.value = integrations.value.some(
      (integration) => integration.kind === 'acp' && acpConfiguration(integration).profileId === profile.id,
    );
    profileForm.id = profile.id;
    profileForm.cwd = profile.cwd;
    profileForm.commandInput = profile.argvText;
    profileModalError.value = '';
    profileModalOpen.value = true;
  };

  const submitAddProfile = async (): Promise<void> => {
    profileModalError.value = '';
    const id = profileForm.id.trim();
    const cwd = profileForm.cwd.trim();
    const argv = parsedModalArgv.value;

    if (!id || !cwd || !argv || argv.length === 0) {
      profileModalError.value = t('agent.settings.disabledReason.incompleteForm');
      return;
    }

    const nextDraft: ProfileDraft = { id, argvText: JSON.stringify(argv), cwd };
    const nextProfiles: ProfileDraft[] = editingProfileId.value
      ? profiles.value.map((profile) => (profile.id === editingProfileId.value ? nextDraft : profile))
      : [...profiles.value, nextDraft];

    try {
      const normalized = normalizeProfiles(nextProfiles);
      const saved = await props.saveProfiles(normalized, t('agent.settings.acpRuntime.profileSaved'));
      if (!saved) return;
      profiles.value = nextProfiles;
      profileModalOpen.value = false;
      editingProfileId.value = null;
      editingProfileIdLocked.value = false;
    } catch (cause) {
      profileModalError.value = explain(cause);
    }
  };

  const removeProfile = async (index: number): Promise<void> => {
    const nextProfiles = [...profiles.value];
    nextProfiles.splice(index, 1);
    try {
      const normalized = normalizeProfiles(nextProfiles);
      const saved = await props.saveProfiles(normalized, t('agent.settings.acpRuntime.profileRemoved'));
      if (saved) profiles.value = nextProfiles;
    } catch (cause) {
      operationFeedback.notifyError({ operation: 'remove-profile', message: explain(cause), cause });
    }
  };

  const parsedArgv = (profile: ProfileDraft): string[] => {
    try {
      const parsed = JSON.parse(profile.argvText);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // 模态弹窗 2：添加集成 (Integration)
  const integrationModalOpen = ref(false);
  const integrationModalError = ref('');
  const integrationForm = reactive({
    displayName: '',
    profileId: '',
    enabled: true,
  });
  let pendingIntegrationCreateIdentity: { fingerprint: string; idempotencyKey: string } | null = null;

  const openAddIntegrationModal = (): void => {
    pendingIntegrationCreateIdentity = null;
    integrationForm.displayName = '';
    integrationForm.profileId = configuredProfiles.value[0]?.id ?? '';
    integrationForm.enabled = true;
    integrationModalError.value = '';
    integrationModalOpen.value = true;
  };

  const submitAddIntegration = async (): Promise<void> => {
    const name = integrationForm.displayName.trim();
    const pid = integrationForm.profileId.trim();
    if (!name || !pid) return;

    await run(
      'create-integration',
      async () => {
        const input = {
          kind: 'acp' as const,
          configuration: {
            displayName: name,
            transport: 'workspace-profile' as const,
            profileId: pid,
            protocolVersion: '1' as const,
          },
          enabled: integrationForm.enabled,
        };
        const fingerprint = JSON.stringify(input);
        if (!pendingIntegrationCreateIdentity || pendingIntegrationCreateIdentity.fingerprint !== fingerprint) {
          pendingIntegrationCreateIdentity = { fingerprint, idempotencyKey: crypto.randomUUID() };
        }
        await agentApi.createIntegration(DEFAULT_AGENT_APP_ID, input, pendingIntegrationCreateIdentity.idempotencyKey);
        pendingIntegrationCreateIdentity = null;
        integrationModalOpen.value = false;
        await loadIntegrations();
      },
      t('agent.settings.acpRuntime.integrationCreated'),
    );
  };

  const changeIntegrationProfile = (integration: AgentIntegrationViewDto, nextProfileId: string): void => {
    const configuration = acpConfiguration(integration);
    if (!nextProfileId || nextProfileId === configuration.profileId) return;
    void run(
      'update-integration-profile',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'acp',
          configuration: { ...configuration, profileId: nextProfileId },
          enabled: integration.enabled,
        });
        await loadIntegrations();
      },
      t('agent.settings.acpRuntime.integrationUpdated'),
    );
  };

  const toggleIntegration = (integration: AgentIntegrationViewDto, nextEnabled: boolean): void => {
    const configuration = acpConfiguration(integration);
    void run(
      'toggle-integration',
      async () => {
        await agentApi.updateIntegration(DEFAULT_AGENT_APP_ID, integration, {
          kind: 'acp',
          configuration,
          enabled: nextEnabled,
        });
        await loadIntegrations();
      },
      t('agent.settings.acpRuntime.integrationUpdated'),
    );
  };

  const removeIntegration = async (integration: AgentIntegrationViewDto): Promise<void> => {
    const configuration = acpConfiguration(integration);
    const confirmed = await feedback.confirm({
      title: t('agent.settings.acpRuntime.deleteIntegration'),
      message: t('agent.settings.acpRuntime.confirmDeleteIntegration', {
        name: configuration.displayName,
        profile: configuration.profileId,
      }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
    });
    if (!confirmed) return;
    void run(
      'remove-integration',
      async () => {
        await agentApi.deleteIntegration(DEFAULT_AGENT_APP_ID, integration);
        await loadIntegrations();
      },
      t('agent.settings.acpRuntime.integrationDeleted'),
    );
  };

  watch(
    () => props.settings.requestedSettings.workspaceRuntime.acpProfiles,
    () => {
      if (!profilesDirty.value || remoteMatchesProfiles.value) syncProfiles();
    },
    { immediate: true },
  );

  watch(
    () => props.agentAvailable,
    () => {
      void loadIntegrations();
    },
    { immediate: true },
  );
</script>

<template>
  <div class="space-y-5">
    <!-- 模块 1：ACP 运行时 (配置档管理) -->
    <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all">
      <div
        class="flex flex-wrap items-center justify-between gap-3 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl agent-settings-head"
        :class="{ 'border-b border-border': profiles.length > 0 }"
      >
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.acpRuntime.title') }}</h3>
          <span
            v-if="profiles.length > 0"
            class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
          >
            {{ profiles.length }}
          </span>
          <UiInfoHint :text="$t('agent.settings.acpRuntime.description')" />
        </div>
        <UiButton
          appearance="soft"
          tone="neutral"
          type="button"
          :disabled="disabled"
          class="w-[88px]"
          @click="openAddProfileModal"
        >
          <span class="inline-flex items-center gap-1.5 text-xs">
            <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.acpRuntime.addProfile') }}</span>
          </span>
        </UiButton>
      </div>

      <!-- 已添加列表：没有的话完全不显示任何占位 -->
      <div v-if="profiles.length > 0" class="space-y-3 p-4 sm:p-5">
        <article
          v-for="(profile, index) in profiles"
          :key="profile.id"
          class="rounded-2xl border border-border/85 bg-card/80 transition-all hover:bg-card/95 hover:border-primary/50 shadow-2xs overflow-hidden"
        >
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5">
            <div class="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/25 text-primary shadow-2xs"
              >
                <i class="fa-solid fa-terminal text-sm" aria-hidden="true"></i>
              </div>
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-xl border border-border/90 bg-background/90 px-3 py-1 font-mono text-sm sm:text-base font-bold tracking-tight text-foreground shadow-2xs"
                  >
                    {{ profile.id }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/50 px-2.5 py-0.5 font-mono text-[11px] text-text-secondary"
                  >
                    <i class="fa-solid fa-folder text-[10px] text-text-secondary/60"></i>
                    <span>{{ profile.cwd }}</span>
                  </span>
                </div>
                <div class="flex items-center gap-1.5 text-xs text-text-secondary font-mono">
                  <i class="fa-solid fa-chevron-right text-[10px] text-primary shrink-0"></i>
                  <span class="truncate text-foreground font-medium max-w-[500px]">{{
                    parsedArgv(profile).join(' ')
                  }}</span>
                </div>
              </div>
            </div>

            <div
              class="flex items-center justify-end gap-1.5 shrink-0 pt-2 sm:pt-0 border-t border-border/40 sm:border-0"
            >
              <UiButton
                appearance="ghost"
                tone="neutral"
                density="compact"
                icon-only
                type="button"
                :disabled="disabled"
                :title="$t('common.edit')"
                :aria-label="$t('common.edit')"
                @click="openEditProfileModal(profile)"
              >
                <i class="fa-solid fa-pen text-xs" aria-hidden="true"></i>
              </UiButton>
              <UiButton
                appearance="ghost"
                tone="danger"
                density="compact"
                icon-only
                type="button"
                :disabled="disabled"
                :title="$t('agent.settings.acpRuntime.remove')"
                :aria-label="$t('agent.settings.acpRuntime.remove')"
                @click="removeProfile(index)"
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
              </UiButton>
            </div>
          </div>
        </article>

        <!-- 底部轻量新增按钮 -->
        <button
          type="button"
          :disabled="disabled"
          class="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-header/10 hover:bg-primary/5 hover:border-primary/45 py-2.5 text-xs text-text-secondary hover:text-primary transition-all duration-200 cursor-pointer select-none active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
          @click="openAddProfileModal"
        >
          <i
            class="fa-solid fa-plus text-[11px] text-primary/70 group-hover:text-primary transition-colors"
            aria-hidden="true"
          ></i>
          <span class="font-medium">{{ $t('agent.settings.acpRuntime.addProfile') }}</span>
        </button>
      </div>
    </section>

    <!-- 模块 2：ACP 集成 (ACP Integrations) -->
    <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs transition-all">
      <div
        class="flex flex-wrap items-center justify-between gap-3 bg-header/35 px-4 py-3 sm:px-5 sm:py-3.5 rounded-t-2xl agent-settings-head"
        :class="{ 'border-b border-border': integrations.length > 0 }"
      >
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.acpRuntime.integrations') }}</h3>
          <span
            v-if="integrations.length > 0"
            class="rounded-full border border-border/70 bg-background/80 px-2 py-0.5 text-[11px] font-medium text-text-secondary"
          >
            {{ integrations.length }}
          </span>
          <UiInfoHint :text="$t('agent.settings.acpRuntime.integrationsHint')" />
        </div>
        <div class="flex items-center gap-2">
          <UiButton
            appearance="soft"
            tone="neutral"
            density="default"
            icon-only
            type="button"
            :disabled="integrationDisabled || loading"
            :title="$t('agent.settings.acpRuntime.refresh')"
            :aria-label="$t('agent.settings.acpRuntime.refresh')"
            @click="loadIntegrations"
          >
            <i class="fa-solid fa-arrows-rotate text-xs" :class="{ 'fa-spin': loading }" aria-hidden="true"></i>
          </UiButton>
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="integrationDisabled || configuredProfiles.length === 0"
            :title="configuredProfiles.length === 0 ? $t('agent.settings.acpRuntime.saveProfileFirst') : undefined"
            class="w-[88px]"
            @click="openAddIntegrationModal"
          >
            <span class="inline-flex items-center gap-1.5 text-xs">
              <i class="fa-solid fa-plus text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.acpRuntime.createIntegration') }}</span>
            </span>
          </UiButton>
        </div>
      </div>

      <!-- 已添加列表：没有的话完全不显示任何占位 -->
      <div v-if="integrations.length > 0" class="space-y-3 p-4 sm:p-5">
        <article
          v-for="integration in integrations"
          :key="integration.id"
          class="rounded-2xl border bg-card/80 transition-all hover:bg-card/95 shadow-2xs overflow-hidden"
          :class="integration.enabled ? 'border-border/85 hover:border-primary/50' : 'border-border/60 opacity-80'"
        >
          <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-4 py-3.5">
            <div class="flex items-start sm:items-center gap-3 min-w-0 flex-1">
              <div
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-primary/10 to-primary/5 border border-primary/25 text-primary shadow-2xs"
              >
                <i class="fa-solid fa-diagram-project text-sm" aria-hidden="true"></i>
              </div>
              <div class="min-w-0 flex-1 space-y-1.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    class="inline-flex items-center rounded-xl border border-border/90 bg-background/90 px-3 py-1 font-mono text-sm sm:text-base font-bold tracking-tight text-foreground shadow-2xs"
                  >
                    {{ acpConfiguration(integration).displayName }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    :class="
                      integration.enabled
                        ? 'border border-success/30 bg-success/10 text-success'
                        : 'border border-border/70 bg-header/40 text-text-secondary'
                    "
                  >
                    <span
                      class="h-1.5 w-1.5 rounded-full"
                      :class="integration.enabled ? 'bg-success' : 'bg-text-secondary/50'"
                    ></span>
                    {{
                      integration.enabled
                        ? $t('agent.settings.acpRuntime.enabled')
                        : $t('agent.settings.acpRuntime.disabled')
                    }}
                  </span>
                  <span
                    class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/50 px-2.5 py-0.5 font-mono text-[11px] text-text-secondary"
                  >
                    <i class="fa-solid fa-terminal text-[10px] text-text-secondary/60"></i>
                    <span>{{ acpConfiguration(integration).profileId }}</span>
                  </span>
                </div>
                <div class="font-mono text-xs text-text-secondary truncate max-w-[500px]">
                  {{ integration.id }}
                </div>
              </div>
            </div>

            <!-- 右侧操作区：配置档选择器、启用开关、删除按钮 -->
            <div
              class="flex flex-wrap items-center justify-end gap-2 pt-2 lg:pt-0 border-t border-border/40 lg:border-0"
            >
              <UiSelect
                density="compact"
                :disabled="integrationDisabled"
                :model-value="acpConfiguration(integration).profileId"
                :options="profileOptions"
                class="w-36"
                @update:model-value="(value: unknown) => changeIntegrationProfile(integration, String(value))"
              />
              <div
                class="flex items-center gap-2 rounded-xl border border-border/70 bg-header/25 px-2.5 py-1 text-xs text-foreground select-none"
              >
                <UiCheckbox
                  :model-value="integration.enabled"
                  :disabled="integrationDisabled"
                  @update:model-value="(value: boolean) => toggleIntegration(integration, value)"
                />
              </div>
              <UiButton
                appearance="ghost"
                tone="danger"
                density="compact"
                icon-only
                type="button"
                :disabled="integrationDisabled"
                :title="$t('agent.settings.acpRuntime.deleteIntegration')"
                :aria-label="$t('agent.settings.acpRuntime.deleteIntegration')"
                @click="removeIntegration(integration)"
              >
                <i class="fa-regular fa-trash-can text-xs" aria-hidden="true"></i>
              </UiButton>
            </div>
          </div>
        </article>

        <!-- 底部轻量新增按钮 -->
        <button
          type="button"
          :disabled="integrationDisabled || configuredProfiles.length === 0"
          class="group flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-header/10 hover:bg-primary/5 hover:border-primary/45 py-2.5 text-xs text-text-secondary hover:text-primary transition-all duration-200 cursor-pointer select-none active:scale-[0.99] disabled:pointer-events-none disabled:opacity-40"
          @click="openAddIntegrationModal"
        >
          <i
            class="fa-solid fa-plus text-[11px] text-primary/70 group-hover:text-primary transition-colors"
            aria-hidden="true"
          ></i>
          <span class="font-medium">{{ $t('agent.settings.acpRuntime.createIntegration') }}</span>
        </button>
      </div>
    </section>

    <!-- 弹窗 1：添加 ACP 配置档模态弹窗 -->
    <BaseModal
      :visible="profileModalOpen"
      :title="editingProfileId ? $t('common.edit') : $t('agent.settings.acpRuntime.modalProfileTitle')"
      :aria-label="editingProfileId ? $t('common.edit') : $t('agent.settings.acpRuntime.modalProfileTitle')"
      :close-on-backdrop="!disabled"
      :close-on-escape="!disabled"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="max-w-xl p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
      @close="profileModalOpen = false"
    >
      <div class="space-y-4">
        <p class="text-xs text-text-secondary leading-relaxed">
          {{ $t('agent.settings.acpRuntime.modalProfileDescription') }}
        </p>

        <div class="space-y-3.5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">
                {{ $t('agent.settings.acpRuntime.profileId') }} <span class="text-error">*</span>
              </span>
              <div class="relative flex items-center">
                <i
                  class="fa-solid fa-fingerprint absolute left-3 text-text-secondary text-xs pointer-events-none"
                  aria-hidden="true"
                ></i>
                <input
                  v-model="profileForm.id"
                  :disabled="editingProfileIdLocked"
                  required
                  data-no-highlight
                  class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover transition-colors"
                  :class="{ 'border-error/70 focus:border-error': !isProfileIdValid || isProfileIdDuplicate }"
                  placeholder="acp-profile-1"
                />
              </div>
            </label>

            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">
                {{ $t('agent.settings.acpRuntime.cwd') }} <span class="text-error">*</span>
              </span>
              <div class="relative flex items-center">
                <i
                  class="fa-solid fa-folder-open absolute left-3 text-text-secondary text-xs pointer-events-none"
                  aria-hidden="true"
                ></i>
                <input
                  v-model="profileForm.cwd"
                  required
                  data-no-highlight
                  class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover transition-colors"
                  :class="{ 'border-error/70 focus:border-error': !isCwdValid }"
                  placeholder="/workspace/work"
                />
              </div>
            </label>
          </div>

          <div class="rounded-xl border border-border/60 bg-header/15 p-3.5 space-y-2">
            <div class="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
              <i class="fa-solid fa-terminal text-primary text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.acpRuntime.argvCommand') }}</span>
              <span class="text-error">*</span>
            </div>

            <label class="block">
              <div class="relative flex items-center">
                <i
                  class="fa-solid fa-terminal absolute left-3 text-text-secondary text-xs pointer-events-none"
                  aria-hidden="true"
                ></i>
                <input
                  v-model="profileForm.commandInput"
                  required
                  data-no-highlight
                  class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 font-mono text-xs text-foreground outline-none focus:border-border-hover transition-colors"
                  :class="{ 'border-error/70 focus:border-error': !isArgvValid }"
                  :placeholder="$t('agent.settings.acpRuntime.argvPlaceholder')"
                />
              </div>
            </label>
            <p class="text-[11px] text-text-secondary leading-relaxed">
              {{ $t('agent.settings.acpRuntime.argvHint') }}
            </p>
          </div>
        </div>

        <div
          v-if="profileModalError"
          class="rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error flex items-center gap-2"
        >
          <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span>{{ profileModalError }}</span>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="disabled"
            @click="profileModalOpen = false"
          >
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="!canSubmitProfile"
            @click="submitAddProfile"
          >
            <i
              :class="editingProfileId ? 'fa-solid fa-floppy-disk' : 'fa-solid fa-plus'"
              class="text-xs"
              aria-hidden="true"
            ></i>
            <span>{{ editingProfileId ? $t('common.save') : $t('agent.settings.providers.saveAndAdd') }}</span>
          </UiButton>
        </div>
      </template>
    </BaseModal>

    <!-- 弹窗 2：添加 ACP 集成模态弹窗 -->
    <BaseModal
      :visible="integrationModalOpen"
      :title="$t('agent.settings.acpRuntime.modalIntegrationTitle')"
      :aria-label="$t('agent.settings.acpRuntime.modalIntegrationTitle')"
      :close-on-backdrop="!disabled"
      :close-on-escape="!disabled"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="max-w-xl p-5 sm:p-6 rounded-2xl shadow-2xl border border-border/80 bg-card"
      @close="integrationModalOpen = false"
    >
      <div class="space-y-4">
        <p class="text-xs text-text-secondary leading-relaxed">
          {{ $t('agent.settings.acpRuntime.modalIntegrationDescription') }}
        </p>

        <div class="space-y-3.5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">
                {{ $t('agent.settings.acpRuntime.displayName') }} <span class="text-error">*</span>
              </span>
              <div class="relative flex items-center">
                <i
                  class="fa-solid fa-cube absolute left-3 text-text-secondary text-xs pointer-events-none"
                  aria-hidden="true"
                ></i>
                <input
                  v-model="integrationForm.displayName"
                  required
                  data-no-highlight
                  class="h-9 w-full rounded-lg border border-border/80 bg-background pl-8 pr-3 text-xs text-foreground outline-none focus:border-border-hover"
                  :placeholder="$t('agent.settings.acpRuntime.displayName')"
                />
              </div>
            </label>

            <label class="block">
              <span class="mb-1 block text-xs font-medium text-foreground">
                {{ $t('agent.settings.acpRuntime.integrationProfile') }} <span class="text-error">*</span>
              </span>
              <UiSelect
                v-model="integrationForm.profileId"
                class="w-full"
                :placeholder="$t('agent.settings.acpRuntime.selectProfile')"
                :options="profileOptions"
              />
            </label>
          </div>

          <div class="rounded-xl border border-border/60 bg-header/15 p-3.5 flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-medium text-foreground">{{ $t('agent.settings.acpRuntime.enabled') }}</div>
              <div class="text-[11px] text-text-secondary">
                {{ $t('agent.settings.acpRuntime.integrationEnabledHint') }}
              </div>
            </div>
            <label class="inline-flex items-center cursor-pointer select-none">
              <UiCheckbox v-model="integrationForm.enabled" />
            </label>
          </div>
        </div>

        <div
          v-if="integrationModalError"
          class="rounded-lg border border-error/30 bg-error/10 p-2.5 text-xs text-error flex items-center gap-2"
        >
          <i class="fa-solid fa-triangle-exclamation shrink-0" aria-hidden="true"></i>
          <span>{{ integrationModalError }}</span>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UiButton
            appearance="soft"
            tone="neutral"
            type="button"
            :disabled="disabled"
            @click="integrationModalOpen = false"
          >
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            appearance="solid"
            tone="primary"
            type="button"
            :disabled="integrationDisabled || !integrationForm.displayName.trim() || !integrationForm.profileId.trim()"
            @click="submitAddIntegration"
          >
            <i class="fa-solid fa-plus text-xs" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.providers.saveAndAdd') }}</span>
          </UiButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
