import type { ClockPort, JsonValue } from '../agent.types';
import type { AgentSettingsService } from './agent-settings.service';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AppStoragePort } from './app-storage.port';
import type { AppStorageSnapshotPort } from './app-storage-snapshot.port';
import type { AppIntentService } from './app-intent.service';
import type { PackageVerifierPort } from './package-verifier.port';
import type { PluginBackendRuntimePort } from './plugin-backend-runtime.port';
import { PluginDataManager } from './plugin-data-manager';
import type { PluginPackageSourcePort } from './plugin-package-source.port';
import { PluginPackageInstallCoordinator } from './plugin-package-install-coordinator';
import type {
  PluginInstallRepositoryPort,
  PluginStageRecord,
  PluginVersionRecord,
  TrustedPublisherKey,
} from './plugin-install.repository.port';
import {
  NOOP_PLUGIN_INSTALL_HOOKS,
  type PluginFrontendDescriptor,
  type PluginFrontendRpcRequest,
  type PluginInstallationView,
  type PluginInstallHooks,
  type PluginInstallResult,
  type PluginStageInput,
  type PluginUninstallResult,
  type PluginUpgradeResult,
  type RemotePluginStageInput,
} from './plugin-install.types';
import type { OfficialAgentPluginSource } from './official-plugin-source';
import type { RemotePluginCatalog, RemotePluginRepositoryPort } from './remote-plugin-repository.port';
import { PluginRuntimeLifecycleCoordinator } from './plugin-runtime-lifecycle-coordinator';
import type { PluginRunnerTarget } from './plugin-runner-target.port';

export type {
  PluginFrontendDescriptor,
  PluginFrontendRpcRequest,
  PluginInstallationView,
  PluginInstallHooks,
  PluginInstallResult,
  PluginStageInput,
  PluginUninstallResult,
  PluginUpgradeResult,
  RemotePluginStageInput,
} from './plugin-install.types';

/** Public Plugin Host facade. Durable/runtime ownership lives in the explicit collaborators. */
export class PluginInstallService {
  private readonly data: PluginDataManager;
  private readonly runtimeLifecycle: PluginRuntimeLifecycleCoordinator;
  private readonly packageInstall: PluginPackageInstallCoordinator;

  constructor(
    repository: PluginInstallRepositoryPort,
    verifier: PackageVerifierPort,
    packages: PluginPackageSourcePort,
    remotePackages: RemotePluginRepositoryPort,
    settings: AgentSettingsService,
    registry: AppRegistryService,
    states: AppStateRepositoryPort,
    storage: AppStoragePort & AppStorageSnapshotPort,
    appIntents: AppIntentService,
    runtime: PluginBackendRuntimePort,
    clock: ClockPort,
    nexusVersion: string,
    hooks: PluginInstallHooks = NOOP_PLUGIN_INSTALL_HOOKS,
    onHostStateCommitted: (userId: number) => void = () => undefined,
    publicOrigin?: string,
  ) {
    this.data = new PluginDataManager(repository, states, storage, appIntents);
    this.runtimeLifecycle = new PluginRuntimeLifecycleCoordinator(
      repository,
      registry,
      states,
      runtime,
      hooks,
      onHostStateCommitted,
      publicOrigin,
    );
    this.packageInstall = new PluginPackageInstallCoordinator(
      repository,
      verifier,
      packages,
      remotePackages,
      settings,
      registry,
      states,
      this.data,
      this.runtimeLifecycle,
      clock,
      nexusVersion,
      onHostStateCommitted,
    );
  }

  listPublisherKeys(userId: number): Promise<TrustedPublisherKey[]> {
    return this.packageInstall.listPublisherKeys(userId);
  }

  trustPublisherKey(userId: number, publicKeyPem: string, label: string): Promise<TrustedPublisherKey> {
    return this.packageInstall.trustPublisherKey(userId, publicKeyPem, label);
  }

  revokePublisherKey(userId: number, keyId: string): Promise<void> {
    return this.packageInstall.revokePublisherKey(userId, keyId);
  }

  stage(userId: number, input: PluginStageInput): Promise<PluginStageRecord> {
    return this.packageInstall.stage(userId, input);
  }

  remoteCatalog(userId: number, repositoryUrl: string, signal?: AbortSignal): Promise<RemotePluginCatalog> {
    return this.packageInstall.remoteCatalog(userId, repositoryUrl, signal);
  }

  officialCatalog(source: OfficialAgentPluginSource, signal?: AbortSignal): Promise<RemotePluginCatalog> {
    return this.packageInstall.officialCatalog(source, signal);
  }

  stageRemote(userId: number, input: RemotePluginStageInput, signal?: AbortSignal): Promise<PluginStageRecord> {
    return this.packageInstall.stageRemote(userId, input, signal);
  }

  stageOfficial(
    userId: number,
    source: OfficialAgentPluginSource,
    appId: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<PluginStageRecord> {
    return this.packageInstall.stageOfficial(userId, source, appId, version, signal);
  }

  verify(userId: number, stageId: string): Promise<{ stage: PluginStageRecord; plugin: PluginVersionRecord }> {
    return this.packageInstall.verify(userId, stageId);
  }

  install(userId: number, stageId: string): Promise<PluginInstallResult> {
    return this.packageInstall.install(userId, stageId);
  }

  upgrade(userId: number, appId: string, stageId: string, expectedVersion: number): Promise<PluginUpgradeResult> {
    return this.packageInstall.upgrade(userId, appId, stageId, expectedVersion);
  }

  uninstall(userId: number, appId: string, expectedVersion: number): Promise<PluginUninstallResult> {
    return this.packageInstall.uninstall(userId, appId, expectedVersion);
  }

  deleteData(userId: number, appId: string): Promise<void> {
    return this.data.deleteData(userId, appId);
  }

  frontendDescriptor(userId: number, appId: string): Promise<PluginFrontendDescriptor | null> {
    return this.runtimeLifecycle.frontendDescriptor(userId, appId);
  }

  frontendRpc(userId: number, appId: string, request: PluginFrontendRpcRequest): Promise<JsonValue> {
    return this.data.frontendRpc(userId, appId, request);
  }

  async initializeInstalledVersions(): Promise<void> {
    await this.packageInstall.reconcileStages();
    await this.runtimeLifecycle.initializeInstalledVersions();
  }

  reconcileUserRuntime(userId: number): Promise<void> {
    return this.runtimeLifecycle.reconcileUserRuntime(userId);
  }

  resolveRunnerTargets(userId: number, pluginIds: readonly string[]): Promise<PluginRunnerTarget[]> {
    return this.runtimeLifecycle.resolveRunnerTargets(userId, pluginIds);
  }

  listVersions(userId: number, appId?: string): Promise<PluginVersionRecord[]> {
    return this.packageInstall.listVersions(userId, appId);
  }

  listInstallations(userId: number): Promise<PluginInstallationView[]> {
    return this.data.listInstallations(userId);
  }
}
