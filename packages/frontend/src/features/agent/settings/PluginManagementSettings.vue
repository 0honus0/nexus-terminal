<script setup lang="ts">
  import { UiButton, UiEmptyState, UiInfoHint } from '@/foundation/ui';
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { useOperationFeedback } from '@/shared/feedback/public';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummaryDto,
    type AgentSettingsViewDto,
    type AgentPluginInstallationDto,
    type AgentPluginPublisherKeyDto,
    type AgentPluginVerifyResultDto,
    type AgentPluginVersionDto,
    type AgentRemotePluginCatalogDto,
    type AgentRemotePluginPackageDto,
    type AgentRemotePluginPublisherDto,
  } from '../api/agent-api';

  const PLUGIN_STAGING_ARTIFACT_SCOPE = 'nexus.plugin-installer';

  const props = defineProps<{ apps: AgentAppSummaryDto[]; settings: AgentSettingsViewDto; busy: boolean }>();
  const emit = defineEmits<{ refresh: []; settingsUpdated: [AgentSettingsViewDto] }>();
  const { t } = useI18n();
  const operationFeedback = useOperationFeedback('agent.settings.plugins');

  const repositoryUrl = ref('');
  const officialCatalog = ref<AgentRemotePluginCatalogDto | null>(null);
  const remoteCatalogs = ref<AgentRemotePluginCatalogDto[]>([]);
  const publisherLabel = ref('');
  const publisherPem = ref('');
  const publishers = ref<AgentPluginPublisherKeyDto[]>([]);
  const installations = ref<AgentPluginInstallationDto[]>([]);
  const versions = ref<AgentPluginVersionDto[]>([]);
  const candidate = ref<AgentPluginVerifyResultDto | null>(null);
  const candidateArtifactName = ref('');
  const localBusy = ref(false);
  const packageInput = ref<HTMLInputElement | null>(null);
  const drainingUpgradeVersion = ref<number | null>(null);
  const pendingDataDeletionAppId = ref<string | null>(null);
  const copiedSourceUrl = ref<string | null>(null);
  // showAdvancedMaintenance removed
  const showPublishers = ref(false);

  const locked = computed(() => props.busy || localBusy.value);
  const configuredRepositories = computed(() => props.settings.requestedSettings.plugins.repositories);
  const catalogSources = computed(() => [
    ...(officialCatalog.value ? [{ catalog: officialCatalog.value, official: true as const }] : []),
    ...remoteCatalogs.value.map((catalog) => ({ catalog, official: false as const })),
  ]);

  interface PluginSourcePackageItem {
    package: AgentRemotePluginPackageDto;
    catalog: AgentRemotePluginCatalogDto;
    official: boolean;
  }

  interface PluginSourceGroup {
    owner: string;
    official: boolean;
    catalogs: Array<{ catalog: AgentRemotePluginCatalogDto; official: boolean }>;
    packages: PluginSourcePackageItem[];
  }

  const searchQuery = ref('');
  const collapsedGroups = ref<Set<string>>(new Set());

  const extractGithubUser = (rawUrl: string): string => {
    try {
      const url = new URL(rawUrl);
      const parts = url.pathname.split('/').filter(Boolean);
      const host = url.hostname.toLowerCase();
      if (host.includes('github') || host.includes('gitlab') || host.includes('gitee')) {
        if (parts.length > 0 && parts[0] && parts[0] !== 'catalog.json') {
          return parts[0];
        }
      }
      if (parts.length > 1 && parts[0] !== 'catalog.json') {
        return parts[0];
      }
      return url.hostname;
    } catch {
      return rawUrl;
    }
  };

  const groupedCatalogSources = computed<PluginSourceGroup[]>(() => {
    const groups: PluginSourceGroup[] = [];
    const groupMap = new Map<string, PluginSourceGroup>();

    for (const source of catalogSources.value) {
      const owner = extractGithubUser(source.catalog.repositoryUrl);
      let group = groupMap.get(owner);
      if (!group) {
        group = {
          owner,
          official: source.official,
          catalogs: [],
          packages: [],
        };
        groupMap.set(owner, group);
        groups.push(group);
      } else if (source.official) {
        group.official = true;
      }
      group.catalogs.push(source);
      for (const entry of source.catalog.packages) {
        group.packages.push({
          package: entry,
          catalog: source.catalog,
          official: source.official,
        });
      }
    }
    return groups;
  });

  const totalPluginCount = computed(() => groupedCatalogSources.value.reduce((acc, g) => acc + g.packages.length, 0));

  const filteredCatalogGroups = computed<PluginSourceGroup[]>(() => {
    const query = searchQuery.value.trim().toLowerCase();
    if (!query) return groupedCatalogSources.value;

    return groupedCatalogSources.value
      .map((group) => {
        const ownerMatches = group.owner.toLowerCase().includes(query);
        const filteredPackages = group.packages.filter((item) => {
          if (ownerMatches) return true;
          const nameMatch = item.package.displayName?.toLowerCase().includes(query);
          const idMatch = item.package.appId?.toLowerCase().includes(query);
          const descMatch = item.package.description?.toLowerCase().includes(query);
          return Boolean(nameMatch || idMatch || descMatch);
        });
        return {
          ...group,
          packages: filteredPackages,
        };
      })
      .filter((group) => group.packages.length > 0);
  });

  const isGroupExpanded = (owner: string): boolean => {
    if (searchQuery.value.trim()) return true;
    return !collapsedGroups.value.has(owner);
  };

  const toggleGroup = (owner: string): void => {
    const next = new Set(collapsedGroups.value);
    if (next.has(owner)) {
      next.delete(owner);
    } else {
      next.add(owner);
    }
    collapsedGroups.value = next;
  };
  const noticeMessage = (notice: string): string => {
    switch (notice) {
      case 'PUBLISHER_TRUSTED':
        return t('agent.settings.plugins.notices.publisherTrusted');
      case 'PUBLISHER_REVOKED':
        return t('agent.settings.plugins.notices.publisherRevoked');
      case 'PACKAGE_VERIFIED':
        return t('agent.settings.plugins.notices.packageVerified');
      case 'PLUGIN_INSTALLED':
        return t('agent.settings.plugins.notices.pluginInstalled');
      case 'PLUGIN_DRAINING':
        return t('agent.settings.plugins.notices.pluginDraining');
      case 'PLUGIN_UPGRADED':
        return t('agent.settings.plugins.notices.pluginUpgraded');
      case 'PLUGIN_UNINSTALLED_DATA_RETAINED':
        return t('agent.settings.plugins.notices.pluginUninstalledDataRetained');
      case 'PLUGIN_DATA_DELETED':
        return t('agent.settings.plugins.notices.pluginDataDeleted');
      default:
        return notice;
    }
  };
  const notifyNotice = (notice: string): void => operationFeedback.notifySuccess(noticeMessage(notice));
  const activeInstallations = computed(() => installations.value.filter((item) => item.status === 'installed'));
  const removedInstallations = computed(() =>
    installations.value.filter((item) => item.status === 'removed' && item.retainedDataEntries > 0),
  );
  const appSummary = (appId: string): AgentAppSummaryDto | undefined => props.apps.find((item) => item.id === appId);

  const isInstalled = (appId: string): boolean => activeInstallations.value.some((item) => item.appId === appId);

  const isInstalledAndEnabled = (appId: string): boolean => {
    const app = props.apps.find((a) => a.id === appId);
    return Boolean(app?.enabled);
  };

  const explain = (cause: unknown): string => formatAgentApiError(cause, t('agent.operations.requestFailed'));

  const copyCatalogUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      copiedSourceUrl.value = url;
      operationFeedback.notifySuccess(t('agent.settings.plugins.copied'));
      setTimeout(() => {
        copiedSourceUrl.value = null;
      }, 1800);
    } catch {
      // ignore
    }
  };

  const loadRemoteCatalogs = async (): Promise<void> => {
    const repositories = configuredRepositories.value;
    const [officialResult, ...results] = await Promise.allSettled([
      agentApi.officialPluginCatalog(),
      ...repositories.map((repository) => agentApi.remotePluginCatalog(repository.url)),
    ]);
    officialCatalog.value = officialResult.status === 'fulfilled' ? officialResult.value : null;
    remoteCatalogs.value = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failures = [
      ...(officialResult.status === 'rejected'
        ? [`${t('agent.settings.plugins.officialRepository')}: ${explain(officialResult.reason)}`]
        : []),
      ...results.flatMap((result, index) =>
        result.status === 'rejected'
          ? [`${repositories[index]?.url ?? t('agent.settings.plugins.remoteRepositories')}: ${explain(result.reason)}`]
          : [],
      ),
    ];
    if (failures.length > 0) {
      operationFeedback.notifyError({ operation: 'load-catalogs', message: failures.join(' · ') });
    }
  };

  const refresh = async (): Promise<void> => {
    const [nextPublishers, nextInstallations, nextVersions] = await Promise.all([
      agentApi.pluginPublishers(),
      agentApi.pluginInstallations(),
      agentApi.pluginVersions(),
    ]);
    publishers.value = nextPublishers;
    installations.value = nextInstallations;
    versions.value = nextVersions;
    await loadRemoteCatalogs();
  };

  const run = async (operation: string, action: () => Promise<void>): Promise<void> => {
    if (locked.value) return;
    localBusy.value = true;
    try {
      await action();
    } catch (cause) {
      operationFeedback.notifyError({ operation, message: explain(cause), cause });
    } finally {
      localBusy.value = false;
    }
  };

  const saveRepositories = async (repositories: { url: string }[]): Promise<void> => {
    const updated = await agentApi.patchSettings({ plugins: { repositories } }, props.settings.revision);
    emit('settingsUpdated', updated);
    await loadRemoteCatalogs();
  };

  const addRepository = (): void => {
    const trimmed = repositoryUrl.value.trim();
    if (!trimmed) return;
    if (configuredRepositories.value.some((candidate) => candidate.url === trimmed)) {
      repositoryUrl.value = '';
      return;
    }
    void run('add-repository', async () => {
      await saveRepositories([...configuredRepositories.value, { url: trimmed }]);
      repositoryUrl.value = '';
    });
  };

  const removeRepository = (url: string): void => {
    void run('remove-repository', async () =>
      saveRepositories(configuredRepositories.value.filter((candidate) => candidate.url !== url)),
    );
  };

  const publisherTrusted = (keyId: string): boolean =>
    publishers.value.some((publisher) => publisher.keyId === keyId && publisher.revokedAt === null);

  const trustRemotePublisher = (publisher: AgentRemotePluginPublisherDto): void => {
    void run('trust-remote-publisher', async () => {
      await agentApi.trustPluginPublisher(publisher.publicKeyPem, publisher.label);
      await refresh();
      notifyNotice('PUBLISHER_TRUSTED');
    });
  };

  const prepareRemotePackage = (
    catalog: AgentRemotePluginCatalogDto,
    entry: AgentRemotePluginPackageDto,
    official: boolean,
  ): void => {
    if (entry.compatible !== true || (!official && !publisherTrusted(entry.publisherKeyId))) return;
    void run('prepare-remote-package', async () => {
      candidate.value = null;
      drainingUpgradeVersion.value = null;
      candidateArtifactName.value = `${entry.appId}@${entry.version}`;
      const stage = official
        ? await agentApi.stageOfficialPlugin(entry.appId, entry.version)
        : await agentApi.stageRemotePlugin(catalog.repositoryUrl, entry.appId, entry.version);
      candidate.value = await agentApi.verifyPlugin(stage.id);
      notifyNotice('PACKAGE_VERIFIED');
    });
  };

  const trustPublisher = (): void => {
    void run('trust-publisher', async () => {
      await agentApi.trustPluginPublisher(publisherPem.value, publisherLabel.value);
      publisherLabel.value = '';
      publisherPem.value = '';
      await refresh();
      notifyNotice('PUBLISHER_TRUSTED');
    });
  };

  const revokePublisher = (keyId: string): void => {
    void run('revoke-publisher', async () => {
      await agentApi.revokePluginPublisher(keyId);
      await refresh();
      notifyNotice('PUBLISHER_REVOKED');
    });
  };

  const choosePackage = (): void => packageInput.value?.click();

  const preparePackage = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void run('prepare-package', async () => {
      candidate.value = null;
      drainingUpgradeVersion.value = null;
      candidateArtifactName.value = file.name;
      const artifact = await agentApi.uploadArtifact(PLUGIN_STAGING_ARTIFACT_SCOPE, file);
      const stage = await agentApi.stagePlugin(artifact);
      candidate.value = await agentApi.verifyPlugin(stage.id);
      notifyNotice('PACKAGE_VERIFIED');
    });
  };

  const applyCandidate = (): void => {
    const current = candidate.value;
    if (!current) return;
    void run('apply-candidate', async () => {
      const installation = installations.value.find(
        (item) => item.appId === current.plugin.appId && item.status === 'installed',
      );
      if (!installation) {
        await agentApi.installPlugin(current.stage.id);
        candidate.value = null;
        candidateArtifactName.value = '';
        await refresh();
        emit('refresh');
        notifyNotice('PLUGIN_INSTALLED');
        return;
      }
      const app = appSummary(current.plugin.appId);
      const expectedVersion = drainingUpgradeVersion.value ?? app?.stateVersion;
      if (!expectedVersion) throw new Error('PLUGIN_APP_STATE_UNAVAILABLE');
      const result = await agentApi.upgradePlugin(current.plugin.appId, current.stage.id, expectedVersion);
      if (result.state === 'draining') {
        drainingUpgradeVersion.value = result.app.version;
        emit('refresh');
        notifyNotice('PLUGIN_DRAINING');
        return;
      }
      drainingUpgradeVersion.value = null;
      candidate.value = null;
      candidateArtifactName.value = '';
      await refresh();
      emit('refresh');
      notifyNotice('PLUGIN_UPGRADED');
    });
  };

  const requestDeleteData = (installation: AgentPluginInstallationDto): void => {
    if (locked.value) return;
    pendingDataDeletionAppId.value = installation.appId;
  };

  const cancelDeleteData = (): void => {
    if (locked.value) return;
    pendingDataDeletionAppId.value = null;
  };

  const deleteData = (installation: AgentPluginInstallationDto): void => {
    if (pendingDataDeletionAppId.value !== installation.appId) return;
    void run('delete-plugin-data', async () => {
      await agentApi.deletePluginData(installation.appId, true);
      await refresh();
      emit('refresh');
      pendingDataDeletionAppId.value = null;
      notifyNotice('PLUGIN_DATA_DELETED');
    });
  };

  onMounted(() => void run('refresh', refresh));
</script>

<template>
  <section class="overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
    <!-- 头部工具栏：现代 App Store 风格 -->
    <div
      class="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-header/50 px-4 py-3.5 sm:px-5 sm:py-4 agent-settings-head"
    >
      <div>
        <div class="flex items-center gap-2">
          <h3 class="text-sm font-semibold text-foreground">{{ $t('agent.settings.plugins.title') }}</h3>
          <span
            class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
          >
            <i class="fa-solid fa-store text-[9px]" aria-hidden="true"></i>
            <span>{{ $t('agent.settings.plugins.ecosystemBadge') }}</span>
          </span>
          <UiInfoHint :text="$t('agent.settings.plugins.remoteRepositoriesHint')" />
        </div>
      </div>

      <div class="flex items-center gap-2">
        <UiButton appearance="soft" tone="neutral" type="button" :disabled="locked" @click="run('refresh', refresh)">
          <i
            :class="
              localBusy
                ? 'fa-solid fa-arrows-rotate fa-spin text-primary'
                : 'fa-solid fa-arrows-rotate text-text-secondary'
            "
            class="text-xs"
            aria-hidden="true"
          ></i>
          <span>{{ $t('agent.settings.plugins.refreshRemote') }}</span>
        </UiButton>

        <UiButton appearance="soft" tone="neutral" type="button" :disabled="locked" @click="choosePackage">
          <i class="fa-solid fa-file-arrow-up text-xs text-primary" aria-hidden="true"></i>
          <span>{{ $t('agent.settings.plugins.choosePackage') }}</span>
        </UiButton>
        <input ref="packageInput" type="file" class="hidden" accept=".tar,application/x-tar" @change="preparePackage" />
      </div>
    </div>

    <div class="space-y-5 p-4 sm:p-5">
      <!-- 待安装包验真就绪卡片 (Candidate Package) -->
      <div
        v-if="candidate"
        class="rounded-xl border border-primary/50 bg-primary/5 p-4 shadow-xs ring-1 ring-primary/20"
      >
        <div class="flex items-center justify-between gap-2 border-b border-border pb-2.5">
          <div class="flex items-center gap-2 text-xs font-semibold text-foreground">
            <div class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/20 text-primary">
              <i class="fa-solid fa-box-open text-xs" aria-hidden="true"></i>
            </div>
            <span>{{ $t('agent.settings.plugins.package') }}</span>
          </div>
          <span
            class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"
          >
            <i class="fa-solid fa-shield-check text-[10px]"></i>
            <span>{{ $t('agent.settings.plugins.signatureVerified') }}</span>
          </span>
        </div>

        <p class="mt-2 text-xs text-text-secondary leading-relaxed">{{ $t('agent.settings.plugins.packageHint') }}</p>

        <div class="mt-3 rounded-lg bg-header/25 p-3.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold text-foreground">{{ candidate.plugin.manifest.displayName }}</span>
              <span
                class="rounded-md border border-border/60 bg-header/40 px-2 py-0.5 font-mono text-xs text-text-secondary"
              >
                v{{ candidate.plugin.version }}
              </span>
            </div>
            <span class="font-mono text-xs text-text-secondary">{{ candidate.plugin.appId }}</span>
          </div>

          <div
            class="mt-2 flex items-center gap-1.5 rounded-lg bg-header/30 px-2.5 py-1 text-[11px] font-mono text-text-secondary"
          >
            <i class="fa-solid fa-key text-[10px] text-primary/70" aria-hidden="true"></i>
            <span class="truncate">{{ candidate.plugin.publisherKeyId }}</span>
          </div>

          <div class="mt-3 flex flex-wrap gap-2 text-xs">
            <span
              class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-header/40 px-2 py-1 text-[11px]"
            >
              <i class="fa-solid fa-screwdriver-wrench text-primary text-[10px]" aria-hidden="true"></i>
              <span>{{ $t('agent.settings.plugins.skillCount', { count: candidate.plugin.skillFiles.length }) }}</span>
            </span>
            <span
              class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-header/40 px-2 py-1 text-[11px]"
            >
              <i class="fa-solid fa-desktop text-text-secondary text-[10px]" aria-hidden="true"></i>
              <span
                >UI:
                {{
                  candidate.plugin.frontendEntry
                    ? $t('agent.settings.plugins.present')
                    : $t('agent.settings.plugins.absent')
                }}</span
              >
            </span>
            <span
              class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-header/40 px-2 py-1 text-[11px]"
            >
              <i class="fa-solid fa-server text-text-secondary text-[10px]" aria-hidden="true"></i>
              <span
                >Backend:
                {{
                  candidate.plugin.backendEntry
                    ? $t('agent.settings.plugins.present')
                    : $t('agent.settings.plugins.absent')
                }}</span
              >
            </span>
            <span
              class="inline-flex items-center gap-1 rounded-md border border-border/60 bg-header/40 px-2 py-1 text-[11px]"
            >
              <i class="fa-solid fa-play text-text-secondary text-[10px]" aria-hidden="true"></i>
              <span
                >Runner:
                {{
                  candidate.plugin.runnerEntry
                    ? $t('agent.settings.plugins.present')
                    : $t('agent.settings.plugins.absent')
                }}</span
              >
            </span>
          </div>

          <div class="mt-3.5 flex items-center justify-between border-t border-border pt-3">
            <span v-if="candidateArtifactName" class="truncate text-[11px] font-mono text-text-secondary">
              {{ candidateArtifactName }}
            </span>
            <span v-else></span>
            <UiButton appearance="solid" tone="primary" type="button" :disabled="locked" @click="applyCandidate">
              <i class="fa-solid fa-download text-xs" aria-hidden="true"></i>
              <span>
                {{
                  activeInstallations.some((item) => item.appId === candidate?.plugin.appId)
                    ? drainingUpgradeVersion
                      ? $t('agent.settings.plugins.continueUpgrade')
                      : $t('agent.settings.plugins.upgrade')
                    : $t('agent.settings.plugins.install')
                }}
              </span>
            </UiButton>
          </div>
        </div>
      </div>

      <!-- 仓库源管理与添加 -->
      <div class="rounded-xl border border-border bg-header/20 p-3.5 sm:p-4 shadow-2xs">
        <div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-boxes-stacked text-xs text-primary" aria-hidden="true"></i>
            <h4 class="text-xs font-semibold text-foreground">
              {{ $t('agent.settings.plugins.remoteRepositories') }}
            </h4>
            <span
              v-if="totalPluginCount > 0"
              class="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary"
            >
              {{ totalPluginCount }}
            </span>
          </div>

          <!-- 添加新仓库输入条：无紫色高亮、中性微质感；窄屏整条换行，输入框独占一行 -->
          <div class="flex flex-wrap items-center gap-2">
            <div class="relative w-full min-w-0 sm:w-auto sm:min-w-[280px]">
              <i
                class="fa-solid fa-link absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-text-secondary"
                aria-hidden="true"
              ></i>
              <input
                v-model="repositoryUrl"
                type="text"
                data-no-highlight
                class="h-8.5 w-full rounded-lg border border-border bg-background pl-7 pr-2.5 shadow-2xs text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none transition-all"
                :placeholder="$t('agent.settings.plugins.repositoryUrl')"
                :disabled="locked"
              />
            </div>
            <UiInfoHint v-if="!repositoryUrl.trim()" :text="$t('agent.settings.disabledReason.repositoryRequired')" />
            <UiButton
              appearance="solid"
              tone="primary"
              type="button"
              :disabled="locked || !repositoryUrl.trim()"
              @click="addRepository"
            >
              {{ $t('agent.settings.plugins.addRepository') }}
            </UiButton>
          </div>
        </div>

        <!-- 搜索输入框 -->
        <div class="mt-3 relative w-full">
          <i
            class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-secondary"
            aria-hidden="true"
          ></i>
          <input
            v-model="searchQuery"
            type="text"
            data-no-highlight
            class="h-8.5 w-full rounded-lg border border-border bg-background pl-8 pr-8 shadow-2xs text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none transition-all"
            :placeholder="$t('agent.settings.plugins.searchPlaceholder')"
          />
          <button
            v-if="searchQuery"
            type="button"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-secondary hover:text-foreground text-xs cursor-pointer p-0.5"
            @click="searchQuery = ''"
          >
            <i class="fa-solid fa-circle-xmark"></i>
          </button>
        </div>

        <!-- 自定义配置的第三方仓库列表 -->
        <div v-if="configuredRepositories.length" class="mt-3 flex flex-wrap gap-2 pt-3 border-t border-border">
          <div
            v-for="repository in configuredRepositories"
            :key="repository.url"
            class="flex max-w-full items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 shadow-2xs text-xs"
          >
            <i class="fa-solid fa-globe text-[10px] text-primary/70" aria-hidden="true"></i>
            <span
              class="max-w-[24rem] sm:max-w-[36rem] truncate font-mono text-[11px] text-foreground"
              :title="repository.url"
              >{{ repository.url }}</span
            >
            <button
              type="button"
              class="inline-flex h-5 w-5 items-center justify-center rounded text-text-secondary hover:bg-error/10 hover:text-error transition-colors disabled:opacity-50 cursor-pointer"
              :title="$t('agent.settings.plugins.removeRepository')"
              :disabled="locked"
              @click="removeRepository(repository.url)"
            >
              <i class="fa-solid fa-xmark text-[10px]" aria-hidden="true"></i>
            </button>
          </div>
        </div>

        <!-- 仓库来源（固定截取 github user）可展开 + 仓库插件列表 -->
        <div v-if="filteredCatalogGroups.length" class="mt-3.5 pt-3.5 border-t border-border space-y-3">
          <div
            v-for="group in filteredCatalogGroups"
            :key="group.owner"
            class="rounded-xl border border-border bg-card shadow-2xs overflow-hidden transition-all duration-200"
          >
            <!-- 仓库来源头部：可展开/折叠 -->
            <div
              role="button"
              tabindex="0"
              class="w-full flex flex-wrap items-center justify-between gap-2.5 px-3.5 sm:px-4 py-2.5 sm:py-3 bg-header/40 hover:bg-header/70 transition-colors select-none cursor-pointer"
              @click="toggleGroup(group.owner)"
              @keydown.enter.space.prevent="toggleGroup(group.owner)"
            >
              <!-- 左侧：展开折叠指示 + 来源标识 (GitHub user) + 官方/第三方标签 + 插件数量 + 来源链接（靠左排列，充裕展示空间） -->
              <div class="flex flex-wrap items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
                <i
                  :class="isGroupExpanded(group.owner) ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'"
                  class="text-[11px] text-text-secondary w-3 text-center transition-transform shrink-0"
                  aria-hidden="true"
                ></i>
                <div
                  class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-header/80 text-foreground/80 border border-border/60"
                >
                  <i class="fa-brands fa-github text-xs" aria-hidden="true"></i>
                </div>
                <div class="flex items-baseline gap-1.5 shrink-0">
                  <span class="text-xs text-text-secondary shrink-0"
                    >{{ $t('agent.settings.plugins.repositorySource') }}:</span
                  >
                  <span class="text-xs sm:text-sm font-bold text-foreground font-mono">{{ group.owner }}</span>
                </div>
                <span
                  v-if="group.official"
                  class="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary shrink-0"
                >
                  <i class="fa-solid fa-certificate text-[8px]" aria-hidden="true"></i>
                  <span>{{ $t('agent.settings.plugins.officialRepository') }}</span>
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1 rounded-full border border-border/70 bg-header/60 px-2 py-0.5 text-[10px] font-medium text-text-secondary shrink-0"
                >
                  <i class="fa-solid fa-network-wired text-[8px]" aria-hidden="true"></i>
                  <span>{{ $t('agent.settings.plugins.thirdPartyRepository') }}</span>
                </span>
                <span
                  class="hidden xs:inline-flex rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 text-[10px] font-mono text-text-secondary shrink-0"
                >
                  {{ $t('agent.settings.plugins.pluginCount', { count: group.packages.length }) }}
                </span>

                <!-- 仓库源链接：靠左放置在来源信息旁，边界明确，展示宽度充裕，点击复制 -->
                <button
                  v-if="group.catalogs[0]?.catalog.repositoryUrl"
                  type="button"
                  class="inline-flex items-center gap-1.5 rounded-lg border border-border/70 bg-header/60 hover:bg-header hover:border-border hover:text-foreground px-2 py-1 text-[11px] font-mono text-text-secondary transition-colors cursor-pointer max-w-full"
                  :title="group.catalogs[0].catalog.repositoryUrl"
                  @click.stop="copyCatalogUrl(group.catalogs[0].catalog.repositoryUrl)"
                >
                  <i
                    :class="
                      copiedSourceUrl === group.catalogs[0].catalog.repositoryUrl
                        ? 'fa-solid fa-check text-success'
                        : 'fa-regular fa-copy'
                    "
                    class="text-[10px] shrink-0"
                    aria-hidden="true"
                  ></i>
                  <span
                    class="truncate max-w-[280px] sm:max-w-[420px] md:max-w-[620px] lg:max-w-[820px] text-[10px] sm:text-[11px]"
                    >{{ group.catalogs[0].catalog.repositoryUrl }}</span
                  >
                </button>
              </div>

              <!-- 右侧：展开/折叠状态提示 -->
              <div class="hidden md:flex items-center gap-1 text-[11px] text-text-secondary/60 shrink-0 select-none">
                <span>{{ isGroupExpanded(group.owner) ? $t('common.collapse') : $t('common.expand') }}</span>
              </div>
            </div>

            <!-- 展开后的仓库插件列表 -->
            <div
              v-if="isGroupExpanded(group.owner)"
              class="p-3 sm:p-4 space-y-2.5 border-t border-border bg-background/40"
            >
              <div class="flex items-center justify-between px-1 text-xs text-text-secondary font-medium">
                <div class="flex items-center gap-1.5">
                  <i class="fa-solid fa-puzzle-piece text-[10px] text-primary" aria-hidden="true"></i>
                  <span>{{ $t('agent.settings.plugins.repositoryPlugins') }}</span>
                </div>
                <span class="font-mono text-[11px]">{{
                  $t('agent.settings.plugins.pluginCount', { count: group.packages.length })
                }}</span>
              </div>

              <!-- 插件列表网格 -->
              <div class="grid grid-cols-1 gap-2.5">
                <div
                  v-for="{ package: entry, catalog, official } in group.packages"
                  :key="`${entry.appId}@${entry.version}`"
                  class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 sm:px-4 sm:py-3 shadow-2xs transition-all duration-200 hover:border-primary/50 hover:shadow-xs"
                >
                  <!-- 左侧：图标 + 标题/版本/状态 + 单行描述 -->
                  <div class="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm shadow-2xs transition-transform"
                      :class="
                        entry.appId === 'nexus.agent'
                          ? 'bg-primary/15 text-primary ring-1 ring-primary/25'
                          : entry.appId === 'nexus.fullstack'
                            ? 'bg-success/15 text-success ring-1 ring-success/25'
                            : 'bg-primary/10 text-primary ring-1 ring-primary/20'
                      "
                    >
                      <i
                        :class="
                          entry.appId === 'nexus.agent'
                            ? 'fa-solid fa-wand-magic-sparkles'
                            : entry.appId === 'nexus.fullstack'
                              ? 'fa-solid fa-layer-group'
                              : 'fa-solid fa-puzzle-piece'
                        "
                        aria-hidden="true"
                      ></i>
                    </div>

                    <div class="min-w-0 flex-1">
                      <!-- 上行：名称 + 版本 + 状态徽章 + appId -->
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="text-xs sm:text-sm font-bold text-foreground truncate">{{
                          entry.displayName
                        }}</span>
                        <span
                          class="rounded-md border border-border/60 bg-header/40 px-1.5 py-0.5 font-mono text-[11px] text-text-secondary"
                        >
                          v{{ entry.version }}
                        </span>
                        <span
                          v-if="!entry.compatible"
                          class="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                        >
                          {{ $t('agent.settings.plugins.incompatible') }}
                        </span>
                        <span
                          v-else-if="isInstalled(entry.appId)"
                          class="inline-flex items-center gap-1 rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success"
                        >
                          <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
                          <span>{{
                            isInstalledAndEnabled(entry.appId)
                              ? $t('agent.settings.plugins.stateEnabled')
                              : $t('agent.settings.plugins.stateInstalled')
                          }}</span>
                        </span>
                        <span
                          v-else
                          class="rounded-full bg-header px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                        >
                          {{ $t('agent.settings.plugins.stateNotInstalled') }}
                        </span>
                        <span class="hidden md:inline font-mono text-[11px] text-text-secondary/60">
                          {{ entry.appId }}
                        </span>
                      </div>

                      <!-- 下行：紧凑单行描述与不兼容警示 -->
                      <div class="mt-0.5 flex items-center gap-2 text-xs text-text-secondary">
                        <p
                          class="truncate text-[11px] leading-relaxed max-w-md lg:max-w-xl"
                          :title="
                            entry.appId === 'nexus.agent'
                              ? $t('agent.settings.plugins.summaryNexusAgent')
                              : entry.appId === 'nexus.fullstack'
                                ? $t('agent.settings.plugins.summaryNexusFullstack')
                                : entry.description
                          "
                        >
                          {{
                            entry.appId === 'nexus.agent'
                              ? $t('agent.settings.plugins.summaryNexusAgent')
                              : entry.appId === 'nexus.fullstack'
                                ? $t('agent.settings.plugins.summaryNexusFullstack')
                                : entry.description
                          }}
                        </p>
                        <span v-if="!entry.compatible" class="shrink-0 text-[11px] text-warning font-mono">
                          {{
                            $t('agent.settings.plugins.compatibilityShort', {
                              min: entry.nexus.minVersion,
                              max: entry.nexus.maxVersion,
                            })
                          }}
                        </span>
                      </div>
                    </div>
                  </div>

                  <!-- 右侧：签名状态与操作按钮 -->
                  <div
                    class="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border"
                  >
                    <span class="hidden sm:inline-flex items-center gap-1 text-[11px] text-text-secondary/70 font-mono">
                      <i class="fa-solid fa-shield-check text-success text-[10px]"></i>
                      <span>Ed25519</span>
                    </span>

                    <div class="flex items-center gap-1.5">
                      <UiButton
                        appearance="soft"
                        tone="neutral"
                        v-if="!official && !publisherTrusted(entry.publisherKeyId)"
                        type="button"
                        :disabled="
                          locked || !catalog.publishers.some((publisher) => publisher.keyId === entry.publisherKeyId)
                        "
                        @click="
                          trustRemotePublisher(
                            catalog.publishers.find((publisher) => publisher.keyId === entry.publisherKeyId)!,
                          )
                        "
                      >
                        {{ $t('agent.settings.plugins.trustRemotePublisher') }}
                      </UiButton>

                      <UiButton
                        type="button"
                        :appearance="isInstalled(entry.appId) ? 'soft' : 'solid'"
                        :tone="isInstalled(entry.appId) ? 'neutral' : 'primary'"
                        :disabled="
                          locked || !entry.compatible || (!official && !publisherTrusted(entry.publisherKeyId))
                        "
                        @click="prepareRemotePackage(catalog, entry, official)"
                      >
                        <i
                          :class="
                            isInstalled(entry.appId)
                              ? 'fa-solid fa-arrows-rotate text-[11px]'
                              : 'fa-solid fa-download text-[11px]'
                          "
                          aria-hidden="true"
                        ></i>
                        <span>{{
                          isInstalled(entry.appId)
                            ? $t('agent.settings.plugins.reverifyPackage')
                            : $t('agent.settings.plugins.prepareRemote')
                        }}</span>
                      </UiButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 搜索无结果时 -->
        <div
          v-else-if="catalogSources.length > 0 && searchQuery"
          class="mt-3.5 pt-6 pb-6 text-center border-t border-border"
        >
          <div
            class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-header/60 text-text-secondary mb-2"
          >
            <i class="fa-solid fa-magnifying-glass text-xs" aria-hidden="true"></i>
          </div>
          <p class="text-xs text-text-secondary">{{ $t('agent.settings.plugins.searchEmpty') }}</p>
          <button
            type="button"
            class="mt-2 text-xs text-primary hover:underline cursor-pointer"
            @click="searchQuery = ''"
          >
            {{ $t('agent.settings.plugins.clearSearch') }}
          </button>
        </div>
      </div>

      <!-- 保留数据清理（仅在有卸载残留时展示，不无谓占位） -->
      <div v-if="removedInstallations.length" class="rounded-xl border border-error/30 bg-error/5 p-4">
        <div class="flex items-center gap-2 text-xs font-semibold text-error">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span>{{ $t('agent.settings.plugins.retainedData') }}</span>
        </div>
        <p class="mt-1 text-[11px] text-text-secondary">{{ $t('agent.settings.plugins.retainedDataHint') }}</p>
        <div class="mt-3 space-y-2">
          <div
            v-for="installation in removedInstallations"
            :key="installation.appId"
            class="rounded-lg bg-header/25 p-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="font-mono text-xs text-foreground">{{ installation.appId }}</span>
              <UiButton
                appearance="soft"
                tone="danger"
                v-if="pendingDataDeletionAppId !== installation.appId"
                type="button"
                :disabled="locked"
                @click="requestDeleteData(installation)"
              >
                {{ $t('agent.settings.plugins.deleteData') }}
              </UiButton>
            </div>
            <div
              v-if="pendingDataDeletionAppId === installation.appId"
              class="mt-3 rounded-lg border border-error/40 bg-error/10 p-3"
            >
              <p class="text-xs text-error">{{ $t('agent.settings.plugins.deleteDataWarning') }}</p>
              <div class="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="rounded-lg bg-error px-3 py-1 text-xs font-medium text-white disabled:opacity-50 cursor-pointer"
                  :disabled="locked"
                  @click="deleteData(installation)"
                >
                  {{ $t('agent.settings.plugins.confirmDeleteData') }}
                </button>
                <UiButton appearance="soft" tone="neutral" type="button" :disabled="locked" @click="cancelDeleteData">
                  {{ $t('agent.settings.plugins.cancelDeleteData') }}
                </UiButton>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 受信任发布者安全抽屉 -->
      <div class="rounded-xl border border-border bg-header/20 overflow-hidden shadow-2xs transition-all">
        <button
          type="button"
          class="flex w-full cursor-pointer items-center justify-between px-4 py-3 text-left select-none hover:bg-header/30"
          @click="showPublishers = !showPublishers"
        >
          <div class="flex items-center gap-2">
            <i class="fa-solid fa-key text-xs text-primary"></i>
            <span class="text-xs font-medium text-foreground">{{ $t('agent.settings.plugins.publishers') }}</span>
            <span
              class="rounded-md border border-border/60 bg-card px-2 py-0.5 font-mono text-[11px] text-text-secondary"
            >
              {{ $t('agent.settings.plugins.publisherCount', { count: publishers.length }) }}
            </span>
          </div>
          <i
            :class="showPublishers ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'"
            class="text-[11px] text-text-secondary"
          ></i>
        </button>

        <div v-if="showPublishers" class="border-t border-border bg-background/60 p-4 space-y-3">
          <p class="text-[11px] text-text-secondary">{{ $t('agent.settings.plugins.publisherHint') }}</p>
          <div class="space-y-2.5">
            <input
              v-model="publisherLabel"
              type="text"
              data-no-highlight
              class="h-8 w-full rounded-lg border border-border/80 bg-card px-3 text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none"
              :placeholder="$t('agent.settings.plugins.publisherLabel')"
              :disabled="locked"
            />
            <textarea
              v-model="publisherPem"
              data-no-highlight
              class="h-24 w-full resize-y rounded-lg border border-border/80 bg-card p-2.5 font-mono text-xs text-foreground placeholder:text-text-secondary/60 focus:border-border-hover focus:outline-none"
              :placeholder="$t('agent.settings.plugins.publisherPem')"
              :disabled="locked"
            ></textarea>
            <div class="flex justify-end">
              <UiButton
                appearance="solid"
                tone="primary"
                type="button"
                :disabled="locked || !publisherLabel.trim() || !publisherPem.trim()"
                @click="trustPublisher"
              >
                {{ $t('agent.settings.plugins.trustPublisher') }}
              </UiButton>
            </div>
          </div>

          <div class="mt-4 space-y-2">
            <div v-for="publisher in publishers" :key="publisher.keyId" class="rounded-lg bg-header/25 p-3">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-xs font-semibold text-foreground">{{ publisher.label }}</span>
                <UiButton
                  v-if="publisher.revokedAt === null"
                  type="button"
                  appearance="soft"
                  tone="danger"
                  :disabled="locked"
                  @click="revokePublisher(publisher.keyId)"
                >
                  {{ $t('agent.settings.plugins.revokePublisher') }}
                </UiButton>
              </div>
              <p class="mt-1 break-all font-mono text-[11px] text-text-secondary">{{ publisher.keyId }}</p>
              <p v-if="publisher.revokedAt !== null" class="mt-1 text-[11px] text-error">
                {{ $t('agent.settings.plugins.revoked') }}
              </p>
            </div>
            <UiEmptyState
              v-if="publishers.length === 0"
              dense
              icon="fa-solid fa-key"
              :title="$t('agent.settings.plugins.noPublishers')"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
