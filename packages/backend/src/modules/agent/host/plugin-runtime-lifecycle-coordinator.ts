import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { Scope } from '../agent.types';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AppStorageSnapshot } from './app-storage-snapshot.port';
import type { AgentAppDefinition, AppRecord, AppStatePatch, AppView } from './app.types';
import type { PluginBackendRuntimePort } from './plugin-backend-runtime.port';
import type { PluginInstallRepositoryPort, PluginVersionRecord } from './plugin-install.repository.port';
import {
  PLUGIN_FRONTEND_PROTOCOL_VERSION,
  type PluginFrontendDescriptor,
  type PluginInstallHooks,
} from './plugin-install.types';
import { PLUGIN_RUNNER_PROTOCOL_VERSION, type PluginRunnerTarget } from './plugin-runner-target.port';

export class PluginRuntimeLifecycleCoordinator {
  constructor(
    private readonly repository: PluginInstallRepositoryPort,
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly runtime: PluginBackendRuntimePort,
    private readonly hooks: PluginInstallHooks,
    private readonly onHostStateCommitted: (userId: number) => void,
    private readonly publicOrigin?: string,
  ) {}

  registerVersion(plugin: PluginVersionRecord): void {
    this.registry.registerVersion(this.definition(plugin));
    this.hooks.versionInstalled(plugin);
  }

  removeVersion(appId: string, version: string): void {
    this.registry.removeVersion(appId, version);
    this.hooks.versionRemoved(appId, version);
  }

  appView(record: AppRecord, plugin: PluginVersionRecord): AppView {
    return {
      ...record,
      displayName: plugin.manifest.displayName,
      capabilities: [...plugin.manifest.capabilities],
      surface: plugin.frontendEntry ? 'custom' : plugin.manifest.agents?.length ? 'agent' : 'none',
      defaultApprovalMode: plugin.manifest.agentSurface?.defaultApprovalMode ?? 'ask',
    };
  }

  activate(scope: Scope, plugin: PluginVersionRecord): Promise<void> {
    return this.runtime.activate(scope, plugin);
  }

  quiesce(scope: Scope, plugin: PluginVersionRecord, deadlineUnixSeconds: number): Promise<void> {
    return this.runtime.quiesce(scope, plugin, deadlineUnixSeconds);
  }

  dispose(scope: Scope, plugin: PluginVersionRecord): Promise<void> {
    return this.runtime.dispose(scope, plugin);
  }

  async migrate(
    scope: Scope,
    fromVersion: string | null,
    plugin: PluginVersionRecord,
    storage: AppStorageSnapshot,
  ): Promise<AppStorageSnapshot> {
    return (await this.runtime.migrate?.(scope, fromVersion, plugin, storage)) ?? storage;
  }

  async assertHealthy(scope: Scope, plugin: PluginVersionRecord): Promise<void> {
    if (!plugin.backendEntry) return;
    const health = await this.runtime.health(scope, plugin);
    if (!health.available) throw new Error(health.reason ?? 'PLUGIN_RUNTIME_UNAVAILABLE');
  }

  async frontendDescriptor(userId: number, appId: string): Promise<PluginFrontendDescriptor | null> {
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed') return null;
    const state = await this.states.get({ userId, appId });
    if (
      !state ||
      state.activeVersion !== installation.version ||
      state.desiredState !== 'enabled' ||
      !['running', 'degraded'].includes(state.observedState)
    ) {
      return null;
    }
    const plugin = await this.repository.getVersion(appId, installation.version);
    if (!plugin || plugin.status !== 'installed' || !plugin.frontendEntry) return null;
    if (!this.publicOrigin) throw new Error('PLUGIN_FRONTEND_ORIGIN_UNAVAILABLE');
    const relativeEntry = plugin.frontendEntry
      .slice('frontend/'.length)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return {
      appId,
      version: plugin.version,
      sdkVersion: plugin.manifest.sdkVersion,
      protocolVersion: PLUGIN_FRONTEND_PROTOCOL_VERSION,
      url: `${this.publicOrigin}/plugins/${encodeURIComponent(appId)}/${encodeURIComponent(plugin.version)}/${relativeEntry}`,
      sandbox: 'allow-scripts',
      maxMessageBytes: 256_000,
      requestTimeoutMs: 15_000,
    };
  }

  async initializeInstalledVersions(): Promise<void> {
    for (const plugin of await this.repository.listVersions()) {
      if (plugin.status === 'installed') this.registerVersion(plugin);
    }
    const userIds = new Set(
      (await this.repository.listActiveInstallations()).map((installation) => installation.userId),
    );
    for (const userId of userIds) await this.reconcileUserRuntime(userId);
  }

  async reconcileUserRuntime(userId: number): Promise<void> {
    const entries: Array<{ scope: { userId: number; appId: string }; plugin: PluginVersionRecord; enabled: boolean }> =
      [];
    for (const installation of await this.repository.listInstallations(userId)) {
      if (installation.status !== 'installed') continue;
      const plugin = await this.repository.getVersion(installation.appId, installation.version);
      if (!plugin || plugin.status !== 'installed') continue;
      const state = await this.states.get({ userId, appId: plugin.appId });
      if (plugin.backendEntry && state?.activeVersion === plugin.version) {
        entries.push({
          scope: { userId, appId: plugin.appId },
          plugin,
          enabled: state.desiredState === 'enabled',
        });
      }
    }
    await this.runtime
      .reconcileUser(userId, entries)
      .catch((error) =>
        logger.warn(
          { err: error, userId, pluginCount: entries.length },
          'Agent plugin runtime user reconciliation failed',
        ),
      );
    for (const entry of entries) await this.reconcileRuntime(userId, entry.plugin);
  }

  async resolveRunnerTargets(userId: number, pluginIds: readonly string[]): Promise<PluginRunnerTarget[]> {
    if (!Array.isArray(pluginIds) || pluginIds.length > 32 || new Set(pluginIds).size !== pluginIds.length) {
      throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
    }
    const targets: PluginRunnerTarget[] = [];
    for (const pluginId of pluginIds) {
      if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/.test(pluginId)) {
        throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
      }
      const installation = await this.repository.getInstallation(userId, pluginId);
      if (!installation || installation.status !== 'installed') throw new Error('PLUGIN_RUNNER_TARGET_UNAVAILABLE');
      const plugin = await this.repository.getVersion(pluginId, installation.version);
      if (!plugin || plugin.status !== 'installed' || !plugin.runnerEntry) {
        throw new Error('PLUGIN_RUNNER_TARGET_UNAVAILABLE');
      }
      const state = await this.states.get({ userId, appId: plugin.appId });
      if (
        !state ||
        state.activeVersion !== plugin.version ||
        state.desiredState !== 'enabled' ||
        !['running', 'degraded'].includes(state.observedState)
      ) {
        throw new Error('PLUGIN_RUNNER_TARGET_UNAVAILABLE');
      }
      targets.push({
        pluginId: plugin.appId,
        version: plugin.version,
        sdkVersion: plugin.manifest.sdkVersion,
        protocolVersion: PLUGIN_RUNNER_PROTOCOL_VERSION,
        packageHash: plugin.packageHash,
        entry: plugin.runnerEntry,
      });
    }
    return targets;
  }

  private async reconcileRuntime(userId: number, plugin: PluginVersionRecord): Promise<void> {
    const scope = { userId, appId: plugin.appId };
    const current = await this.states.get(scope);
    if (!current || current.activeVersion !== plugin.version) return;

    if (current.desiredState === 'disabled') {
      await this.runtime
        .dispose(scope, plugin)
        .catch((error) =>
          logger.warn(
            { err: error, userId, appId: plugin.appId, version: plugin.version },
            'Agent disabled plugin runtime disposal during reconciliation failed',
          ),
        );
      if (current.observedState !== 'disabled') {
        await this.compareAndSetState(scope, current.version, { observedState: 'disabled', healthReason: null }).catch(
          (error) =>
            logger.warn(
              { err: error, userId, appId: plugin.appId, version: plugin.version },
              'Agent disabled plugin reconciliation state update failed',
            ),
        );
      }
      return;
    }

    if (!plugin.backendEntry) return;
    try {
      let health = await this.runtime.health(scope, plugin);
      if (!health.available) {
        await this.runtime.activate(scope, plugin);
        health = await this.runtime.health(scope, plugin);
      }
      const observedState = health.available ? 'running' : 'degraded';
      const healthReason = health.available ? null : (health.reason ?? 'PLUGIN_RUNTIME_UNAVAILABLE');
      if (current.observedState !== observedState || current.healthReason !== healthReason) {
        await this.compareAndSetState(scope, current.version, { observedState, healthReason }).catch((error) =>
          logger.warn(
            { err: error, userId, appId: plugin.appId, version: plugin.version, observedState, healthReason },
            'Agent plugin reconciliation health state update failed',
          ),
        );
      }
    } catch (error) {
      const healthReason = error instanceof Error ? error.message.slice(0, 1024) : 'PLUGIN_RUNTIME_UNAVAILABLE';
      logger.warn(
        {
          err: error,
          errorCode: logErrorCode(error, 'PLUGIN_RUNTIME_UNAVAILABLE'),
          userId,
          appId: plugin.appId,
          version: plugin.version,
          healthReason,
        },
        'Agent plugin runtime reconciliation failed',
      );
      await this.compareAndSetState(scope, current.version, { observedState: 'degraded', healthReason }).catch(
        (stateError) =>
          logger.warn(
            { err: stateError, userId, appId: plugin.appId, version: plugin.version, healthReason },
            'Agent plugin degraded reconciliation state update failed',
          ),
      );
    }
  }

  private async compareAndSetState(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord> {
    const updated = await this.states.compareAndSet(scope, expectedVersion, patch);
    this.onHostStateCommitted(scope.userId);
    return updated;
  }

  private definition(plugin: PluginVersionRecord): AgentAppDefinition {
    const scopePlugin = plugin;
    return {
      manifest: { ...plugin.manifest, validated: true as const },
      defaultEnabled: false,
      defaultGrants: [],
      initializeForScope: async (scope) => {
        await this.assertInstalled(scope.userId, plugin.appId, plugin.version);
        await this.runtime.activate(scope, scopePlugin);
      },
      quiesceForScope: (scope, deadline) => this.runtime.quiesce(scope, scopePlugin, deadline),
      disposeForScope: (scope) => this.runtime.dispose(scope, scopePlugin),
      availableForScope: async (scope) => {
        const installation = await this.repository.getInstallation(scope.userId, plugin.appId);
        return Boolean(installation && installation.status === 'installed' && installation.version === plugin.version);
      },
      health: async (scope) => {
        const installation = await this.repository.getInstallation(scope.userId, plugin.appId);
        if (!installation || installation.status !== 'installed' || installation.version !== plugin.version) {
          return { status: 'failed' as const, reason: 'PLUGIN_NOT_INSTALLED' };
        }
        if (!plugin.backendEntry) return { status: 'healthy' as const };
        const health = await this.runtime.health(scope, scopePlugin);
        return health.available
          ? { status: 'healthy' as const }
          : { status: 'degraded' as const, reason: health.reason ?? 'PLUGIN_RUNTIME_UNAVAILABLE' };
      },
    };
  }

  private async assertInstalled(userId: number, appId: string, version: string): Promise<void> {
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed' || installation.version !== version) {
      throw new Error('PLUGIN_NOT_INSTALLED');
    }
  }
}
