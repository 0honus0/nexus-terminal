<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    agentApi,
    formatAgentApiError,
    type AgentAppSummary,
    type AgentSettingsView,
    type PluginInstallation,
    type PluginPublisherKey,
    type PluginVerifyResult,
    type PluginVersionView,
    type RemotePluginCatalog,
    type RemotePluginPackageEntry,
    type RemotePluginPublisher,
  } from '../api/agent-api';

  const props = defineProps<{ apps: AgentAppSummary[]; settings: AgentSettingsView; busy: boolean }>();
  const emit = defineEmits<{ refresh: []; settingsUpdated: [AgentSettingsView] }>();
  const { t } = useI18n();

  const repositoryUrl = ref('');
  const repositoryExceptions = ref('');
  const remoteCatalogs = ref<RemotePluginCatalog[]>([]);
  const publisherLabel = ref('');
  const publisherPem = ref('');
  const publishers = ref<PluginPublisherKey[]>([]);
  const installations = ref<PluginInstallation[]>([]);
  const versions = ref<PluginVersionView[]>([]);
  const candidate = ref<PluginVerifyResult | null>(null);
  const candidateArtifactName = ref('');
  const localBusy = ref(false);
  const error = ref('');
  const notice = ref('');
  const packageInput = ref<HTMLInputElement | null>(null);
  const drainingUpgradeVersion = ref<number | null>(null);
  const drainingUninstallVersions = ref<Record<string, number>>({});
  const pendingDataDeletionAppId = ref<string | null>(null);

  const locked = computed(() => props.busy || localBusy.value);
  const configuredRepositories = computed(() => props.settings.requestedSettings.plugins.repositories);
  const noticeText = computed(() => {
    switch (notice.value) {
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
        return '';
    }
  });
  const activeInstallations = computed(() => installations.value.filter((item) => item.status === 'installed'));
  const removedInstallations = computed(() => installations.value.filter((item) => item.status === 'removed'));
  const installedVersion = (appId: string): PluginVersionView | undefined =>
    versions.value.find((item) => item.appId === appId);
  const appSummary = (appId: string): AgentAppSummary | undefined => props.apps.find((item) => item.id === appId);

  const explain = (cause: unknown): string => formatAgentApiError(cause, 'AGENT_REQUEST_FAILED');

  const loadRemoteCatalogs = async (): Promise<void> => {
    const repositories = configuredRepositories.value;
    const results = await Promise.allSettled(
      repositories.map((repository) => agentApi.remotePluginCatalog(repository.url)),
    );
    remoteCatalogs.value = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${repositories[index]?.url ?? t('agent.settings.plugins.remoteRepositories')}: ${explain(result.reason)}`]
        : [],
    );
    if (failures.length > 0) error.value = failures.join(' · ');
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

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (locked.value) return;
    localBusy.value = true;
    error.value = '';
    notice.value = '';
    try {
      await action();
    } catch (cause) {
      error.value = explain(cause);
    } finally {
      localBusy.value = false;
    }
  };

  const saveRepositories = async (repositories: AgentSettingsView['requestedSettings']['plugins']['repositories']) => {
    const updated = await agentApi.patchSettings({ plugins: { repositories } }, props.settings.revision);
    emit('settingsUpdated', updated);
    await loadRemoteCatalogs();
  };

  const addRepository = (): void => {
    const url = repositoryUrl.value.trim();
    if (!url) return;
    void run(async () => {
      const exceptions = repositoryExceptions.value
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const next = [
        ...configuredRepositories.value.filter((candidate) => candidate.url !== url),
        { url, privateHostExceptions: exceptions },
      ];
      await saveRepositories(next);
      repositoryUrl.value = '';
      repositoryExceptions.value = '';
    });
  };

  const removeRepository = (url: string): void => {
    void run(async () => saveRepositories(configuredRepositories.value.filter((candidate) => candidate.url !== url)));
  };

  const publisherTrusted = (keyId: string): boolean =>
    publishers.value.some((publisher) => publisher.keyId === keyId && publisher.revokedAt === null);

  const trustRemotePublisher = (publisher: RemotePluginPublisher): void => {
    void run(async () => {
      await agentApi.trustPluginPublisher(publisher.publicKeyPem, publisher.label);
      await refresh();
      notice.value = 'PUBLISHER_TRUSTED';
    });
  };

  const prepareRemotePackage = (catalog: RemotePluginCatalog, entry: RemotePluginPackageEntry): void => {
    if (!publisherTrusted(entry.publisherKeyId)) return;
    void run(async () => {
      candidate.value = null;
      drainingUpgradeVersion.value = null;
      candidateArtifactName.value = `${entry.appId}@${entry.version}`;
      const stage = await agentApi.stageRemotePlugin(catalog.repositoryUrl, entry.appId, entry.version);
      candidate.value = await agentApi.verifyPlugin(stage.id);
      notice.value = 'PACKAGE_VERIFIED';
    });
  };

  const trustPublisher = (): void => {
    void run(async () => {
      await agentApi.trustPluginPublisher(publisherPem.value, publisherLabel.value);
      publisherLabel.value = '';
      publisherPem.value = '';
      await refresh();
      notice.value = 'PUBLISHER_TRUSTED';
    });
  };

  const revokePublisher = (keyId: string): void => {
    void run(async () => {
      await agentApi.revokePluginPublisher(keyId);
      await refresh();
      notice.value = 'PUBLISHER_REVOKED';
    });
  };

  const choosePackage = (): void => packageInput.value?.click();

  const preparePackage = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void run(async () => {
      candidate.value = null;
      drainingUpgradeVersion.value = null;
      candidateArtifactName.value = file.name;
      const artifact = await agentApi.uploadArtifact('nexus.operations', file);
      const stage = await agentApi.stagePlugin(artifact);
      candidate.value = await agentApi.verifyPlugin(stage.id);
      notice.value = 'PACKAGE_VERIFIED';
    });
  };

  const applyCandidate = (): void => {
    const current = candidate.value;
    if (!current) return;
    void run(async () => {
      const installation = installations.value.find(
        (item) => item.appId === current.plugin.appId && item.status === 'installed',
      );
      if (!installation) {
        await agentApi.installPlugin(current.stage.id);
        candidate.value = null;
        candidateArtifactName.value = '';
        await refresh();
        emit('refresh');
        notice.value = 'PLUGIN_INSTALLED';
        return;
      }
      const app = appSummary(current.plugin.appId);
      const expectedVersion = drainingUpgradeVersion.value ?? app?.stateVersion;
      if (!expectedVersion) throw new Error('PLUGIN_APP_STATE_UNAVAILABLE');
      const result = await agentApi.upgradePlugin(current.plugin.appId, current.stage.id, expectedVersion);
      if (result.state === 'draining') {
        drainingUpgradeVersion.value = result.app.version;
        emit('refresh');
        notice.value = 'PLUGIN_DRAINING';
        return;
      }
      drainingUpgradeVersion.value = null;
      candidate.value = null;
      candidateArtifactName.value = '';
      await refresh();
      emit('refresh');
      notice.value = 'PLUGIN_UPGRADED';
    });
  };

  const uninstall = (installation: PluginInstallation): void => {
    void run(async () => {
      const app = appSummary(installation.appId);
      const expectedVersion = drainingUninstallVersions.value[installation.appId] ?? app?.stateVersion;
      if (!expectedVersion) throw new Error('PLUGIN_APP_STATE_UNAVAILABLE');
      const result = await agentApi.uninstallPlugin(installation.appId, expectedVersion);
      if (result.state === 'draining') {
        drainingUninstallVersions.value = {
          ...drainingUninstallVersions.value,
          [installation.appId]: result.app.version,
        };
        emit('refresh');
        notice.value = 'PLUGIN_DRAINING';
        return;
      }
      const next = { ...drainingUninstallVersions.value };
      delete next[installation.appId];
      drainingUninstallVersions.value = next;
      await refresh();
      emit('refresh');
      notice.value = 'PLUGIN_UNINSTALLED_DATA_RETAINED';
    });
  };

  const requestDeleteData = (installation: PluginInstallation): void => {
    if (locked.value) return;
    pendingDataDeletionAppId.value = installation.appId;
    error.value = '';
    notice.value = '';
  };

  const cancelDeleteData = (): void => {
    if (locked.value) return;
    pendingDataDeletionAppId.value = null;
  };

  const deleteData = (installation: PluginInstallation): void => {
    if (pendingDataDeletionAppId.value !== installation.appId) return;
    void run(async () => {
      await agentApi.deletePluginData(installation.appId, true);
      pendingDataDeletionAppId.value = null;
      notice.value = 'PLUGIN_DATA_DELETED';
    });
  };

  onMounted(() => void run(refresh));
</script>

<template>
  <section class="rounded-lg border border-border bg-card p-5">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-base font-semibold">{{ $t('agent.settings.plugins.title') }}</h2>
        <p class="mt-1 text-sm text-text-secondary">{{ $t('agent.settings.plugins.description') }}</p>
      </div>
      <button
        type="button"
        class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-header disabled:opacity-50"
        :disabled="locked"
        @click="choosePackage"
      >
        {{ $t('agent.settings.plugins.choosePackage') }}
      </button>
      <input ref="packageInput" type="file" class="hidden" accept=".tar,application/x-tar" @change="preparePackage" />
    </div>

    <p v-if="error" class="mt-3 rounded-md bg-error/10 px-3 py-2 text-xs text-error">{{ error }}</p>
    <p v-if="noticeText" class="mt-3 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
      {{ noticeText }}
    </p>

    <div class="mt-5 rounded-md bg-background p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold">{{ $t('agent.settings.plugins.remoteRepositories') }}</h3>
          <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.plugins.remoteRepositoriesHint') }}</p>
        </div>
        <button
          type="button"
          class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-header disabled:opacity-50"
          :disabled="locked || configuredRepositories.length === 0"
          @click="run(loadRemoteCatalogs)"
        >
          {{ $t('agent.settings.plugins.refreshRemote') }}
        </button>
      </div>
      <div class="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input
          v-model="repositoryUrl"
          class="rounded-md border border-border bg-card px-3 py-2 text-sm"
          :placeholder="$t('agent.settings.plugins.repositoryUrl')"
          :disabled="locked"
        />
        <input
          v-model="repositoryExceptions"
          class="rounded-md border border-border bg-card px-3 py-2 text-sm"
          :placeholder="$t('agent.settings.plugins.repositoryExceptions')"
          :disabled="locked"
        />
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="locked || !repositoryUrl.trim()"
          @click="addRepository"
        >
          {{ $t('agent.settings.plugins.addRepository') }}
        </button>
      </div>
      <div v-if="configuredRepositories.length" class="mt-3 flex flex-wrap gap-2">
        <div
          v-for="repository in configuredRepositories"
          :key="repository.url"
          class="flex max-w-full items-center gap-2 rounded border border-border bg-card px-2 py-1"
        >
          <span class="max-w-[32rem] truncate font-mono text-[10px]">{{ repository.url }}</span>
          <button
            type="button"
            class="text-xs text-error hover:underline disabled:opacity-50"
            :disabled="locked"
            @click="removeRepository(repository.url)"
          >
            {{ $t('agent.settings.plugins.removeRepository') }}
          </button>
        </div>
      </div>
      <div v-if="remoteCatalogs.length" class="mt-4 space-y-4">
        <div
          v-for="catalog in remoteCatalogs"
          :key="catalog.repositoryUrl"
          class="rounded border border-border bg-card p-3"
        >
          <p class="break-all font-mono text-[10px] text-text-secondary">{{ catalog.repositoryUrl }}</p>
          <div class="mt-3 grid gap-3 lg:grid-cols-2">
            <div
              v-for="entry in catalog.packages"
              :key="`${entry.appId}@${entry.version}`"
              class="rounded border border-border p-3"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-medium">{{ entry.displayName }}</span>
                <span class="rounded bg-header px-2 py-0.5 text-[10px]">v{{ entry.version }}</span>
              </div>
              <p class="mt-1 text-xs text-text-secondary">{{ entry.description }}</p>
              <p class="mt-2 break-all font-mono text-[10px] text-text-secondary">{{ entry.appId }}</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  v-if="!publisherTrusted(entry.publisherKeyId)"
                  type="button"
                  class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-header disabled:opacity-50"
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
                </button>
                <button
                  type="button"
                  class="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  :disabled="locked || !publisherTrusted(entry.publisherKeyId)"
                  @click="prepareRemotePackage(catalog, entry)"
                >
                  {{ $t('agent.settings.plugins.prepareRemote') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-5 grid gap-4 lg:grid-cols-2">
      <div class="rounded-md bg-background p-4">
        <h3 class="text-sm font-semibold">{{ $t('agent.settings.plugins.publishers') }}</h3>
        <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.plugins.publisherHint') }}</p>
        <div class="mt-3 space-y-2">
          <input
            v-model="publisherLabel"
            class="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            :placeholder="$t('agent.settings.plugins.publisherLabel')"
            :disabled="locked"
          />
          <textarea
            v-model="publisherPem"
            class="h-28 w-full resize-y rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
            :placeholder="$t('agent.settings.plugins.publisherPem')"
            :disabled="locked"
          ></textarea>
          <button
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            :disabled="locked || !publisherLabel.trim() || !publisherPem.trim()"
            @click="trustPublisher"
          >
            {{ $t('agent.settings.plugins.trustPublisher') }}
          </button>
        </div>
        <div class="mt-4 space-y-2">
          <div v-for="publisher in publishers" :key="publisher.keyId" class="rounded border border-border p-2">
            <div class="flex items-center justify-between gap-2">
              <span class="min-w-0 truncate text-sm font-medium">{{ publisher.label }}</span>
              <button
                v-if="publisher.revokedAt === null"
                type="button"
                class="rounded px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50"
                :disabled="locked"
                @click="revokePublisher(publisher.keyId)"
              >
                {{ $t('agent.settings.plugins.revokePublisher') }}
              </button>
            </div>
            <p class="mt-1 break-all font-mono text-[10px] text-text-secondary">{{ publisher.keyId }}</p>
            <p v-if="publisher.revokedAt !== null" class="mt-1 text-xs text-text-secondary">
              {{ $t('agent.settings.plugins.revoked') }}
            </p>
          </div>
          <p v-if="publishers.length === 0" class="text-xs text-text-secondary">
            {{ $t('agent.settings.plugins.noPublishers') }}
          </p>
        </div>
      </div>

      <div class="rounded-md bg-background p-4">
        <h3 class="text-sm font-semibold">{{ $t('agent.settings.plugins.package') }}</h3>
        <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.plugins.packageHint') }}</p>
        <div v-if="candidate" class="mt-3 rounded border border-border bg-card p-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ candidate.plugin.manifest.displayName }}</span>
            <span class="rounded bg-header px-2 py-0.5 text-xs">v{{ candidate.plugin.version }}</span>
          </div>
          <p class="mt-2 text-xs text-text-secondary">{{ candidate.plugin.appId }}</p>
          <p class="mt-1 break-all font-mono text-[10px] text-text-secondary">{{ candidate.plugin.publisherKeyId }}</p>
          <p class="mt-2 text-xs text-text-secondary">
            {{
              $t('agent.settings.plugins.packageContents', {
                skills: candidate.plugin.skillFiles.length,
                ui: candidate.plugin.frontendEntry
                  ? $t('agent.settings.plugins.present')
                  : $t('agent.settings.plugins.absent'),
                backend: candidate.plugin.backendEntry
                  ? $t('agent.settings.plugins.present')
                  : $t('agent.settings.plugins.absent'),
                runner: candidate.plugin.runnerEntry
                  ? $t('agent.settings.plugins.present')
                  : $t('agent.settings.plugins.absent'),
              })
            }}
          </p>
          <p v-if="candidateArtifactName" class="mt-1 truncate text-xs text-text-secondary">
            {{ candidateArtifactName }}
          </p>
          <button
            type="button"
            class="mt-3 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            :disabled="locked"
            @click="applyCandidate"
          >
            {{
              activeInstallations.some((item) => item.appId === candidate?.plugin.appId)
                ? drainingUpgradeVersion
                  ? $t('agent.settings.plugins.continueUpgrade')
                  : $t('agent.settings.plugins.upgrade')
                : $t('agent.settings.plugins.install')
            }}
          </button>
        </div>
        <p v-else class="mt-3 text-xs text-text-secondary">{{ $t('agent.settings.plugins.noCandidate') }}</p>
      </div>
    </div>

    <div class="mt-5">
      <h3 class="text-sm font-semibold">{{ $t('agent.settings.plugins.installed') }}</h3>
      <div class="mt-2 space-y-2">
        <div
          v-for="installation in activeInstallations"
          :key="installation.appId"
          class="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background p-3"
        >
          <div>
            <p class="text-sm font-medium">
              {{ installedVersion(installation.appId)?.manifest.displayName || installation.appId }}
            </p>
            <p class="mt-1 text-xs text-text-secondary">{{ installation.appId }} · v{{ installation.version }}</p>
          </div>
          <button
            type="button"
            class="rounded-md border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10 disabled:opacity-50"
            :disabled="locked"
            @click="uninstall(installation)"
          >
            {{
              drainingUninstallVersions[installation.appId]
                ? $t('agent.settings.plugins.continueUninstall')
                : $t('agent.settings.plugins.uninstall')
            }}
          </button>
        </div>
        <p v-if="activeInstallations.length === 0" class="text-xs text-text-secondary">
          {{ $t('agent.settings.plugins.noneInstalled') }}
        </p>
      </div>
    </div>

    <div v-if="removedInstallations.length" class="mt-5 border-t border-border pt-4">
      <h3 class="text-sm font-semibold">{{ $t('agent.settings.plugins.retainedData') }}</h3>
      <p class="mt-1 text-xs text-text-secondary">{{ $t('agent.settings.plugins.retainedDataHint') }}</p>
      <div class="mt-2 space-y-2">
        <div
          v-for="installation in removedInstallations"
          :key="installation.appId"
          class="rounded-md bg-background p-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-xs">{{ installation.appId }}</span>
            <button
              v-if="pendingDataDeletionAppId !== installation.appId"
              type="button"
              class="rounded-md border border-error/40 px-3 py-1.5 text-xs text-error hover:bg-error/10 disabled:opacity-50"
              :disabled="locked"
              @click="requestDeleteData(installation)"
            >
              {{ $t('agent.settings.plugins.deleteData') }}
            </button>
          </div>
          <div
            v-if="pendingDataDeletionAppId === installation.appId"
            class="mt-3 rounded-md border border-error/40 bg-error/10 p-3"
          >
            <p class="text-xs text-error">{{ $t('agent.settings.plugins.deleteDataWarning') }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-md bg-error px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                :disabled="locked"
                @click="deleteData(installation)"
              >
                {{ $t('agent.settings.plugins.confirmDeleteData') }}
              </button>
              <button
                type="button"
                class="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-header disabled:opacity-50"
                :disabled="locked"
                @click="cancelDeleteData"
              >
                {{ $t('agent.settings.plugins.cancelDeleteData') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
