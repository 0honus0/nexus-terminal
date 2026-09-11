import { randomUUID } from 'node:crypto';
import type { ClockPort, JsonValue, Scope } from '../agent.types';
import { validateManifest } from './app-manifest-validator';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AppStoragePort, AppStorageRecord } from './app-storage.port';
import type { AppCapabilityBroker } from './app-capability-broker';
import type { AppStorageSnapshotPort } from './app-storage-snapshot.port';
import type { AgentAppDefinition, AppRecord, AppStatePatch, AppView } from './app.types';
import type { PackageVerifierPort, VerifiedPluginPackage } from './package-verifier.port';
import type { PluginPackageSourcePort } from './plugin-package-source.port';
import type {
  PluginInstallRepositoryPort,
  PluginStageRecord,
  PluginVersionRecord,
  TrustedPublisherKey,
} from './plugin-install.repository.port';
import type { PluginBackendRuntimePort } from './plugin-backend-runtime.port';
import { PLUGIN_RUNNER_PROTOCOL_VERSION, type PluginRunnerTarget } from './plugin-runner-target.port';

const MAX_PUBLISHER_LABEL_BYTES = 256;
const MAX_FRONTEND_RPC_BYTES = 64_000;
const PLUGIN_FRONTEND_PROTOCOL_VERSION = 1 as const;

const asRecord = (value: JsonValue, code = 'PLUGIN_FRONTEND_RPC_INVALID'): Record<string, JsonValue> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, JsonValue>;
};

const requireOnlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const set = new Set(allowed);
  if (Object.keys(value).some((key) => !set.has(key))) throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
};

const requireStorageKey = (value: JsonValue | undefined): string => {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > 256) {
    throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
  }
  return value;
};

const storageRecordJson = (record: AppStorageRecord | null): JsonValue =>
  record
    ? {
        key: record.key,
        value: record.value,
        bytes: record.bytes,
        version: record.version,
        updatedAt: record.updatedAt,
      }
    : null;

export interface PluginStageInput {
  artifactAppId: string;
  artifactId: string;
}

export interface PluginInstallResult {
  stage: PluginStageRecord;
  plugin: PluginVersionRecord;
  app: AppView;
}

export interface PluginUpgradeResult {
  state: 'draining' | 'completed';
  targetVersion: string;
  app: AppView;
  plugin: PluginVersionRecord;
}

export interface PluginUninstallResult {
  state: 'draining' | 'removed';
  app: AppView;
}

export interface PluginFrontendDescriptor {
  appId: string;
  version: string;
  sdkVersion: string;
  protocolVersion: typeof PLUGIN_FRONTEND_PROTOCOL_VERSION;
  url: string;
  sandbox: 'allow-scripts';
  maxMessageBytes: 64_000;
  requestTimeoutMs: 10_000;
}

export interface PluginFrontendRpcRequest {
  method: 'host.appInfo' | 'storage.get' | 'storage.put' | 'storage.delete';
  params: JsonValue;
}

export class PluginInstallService {
  constructor(
    private readonly repository: PluginInstallRepositoryPort,
    private readonly verifier: PackageVerifierPort,
    private readonly packages: PluginPackageSourcePort,
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly storage: AppStoragePort & AppStorageSnapshotPort,
    private readonly capabilities: AppCapabilityBroker,
    private readonly runtime: PluginBackendRuntimePort,
    private readonly clock: ClockPort,
    private readonly nexusVersion: string,
    private readonly onHostStateCommitted: (userId: number) => void = () => undefined,
    private readonly publicOrigin?: string,
    private readonly pluginFrontendOrigin?: string,
  ) {}

  listPublisherKeys(userId: number): Promise<TrustedPublisherKey[]> {
    return this.repository.listPublisherKeys(userId);
  }

  async trustPublisherKey(userId: number, publicKeyPem: string, label: string): Promise<TrustedPublisherKey> {
    const normalizedLabel = label.trim();
    if (!normalizedLabel || Buffer.byteLength(normalizedLabel, 'utf8') > MAX_PUBLISHER_LABEL_BYTES) {
      throw new Error('PUBLISHER_KEY_LABEL_INVALID');
    }
    const key = await this.verifier.normalizePublisherKey(publicKeyPem);
    const record: TrustedPublisherKey = {
      userId,
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      label: normalizedLabel,
      createdAt: this.clock.nowUnixSeconds(),
      revokedAt: null,
    };
    await this.repository.putPublisherKey(record);
    return record;
  }

  async revokePublisherKey(userId: number, keyId: string): Promise<void> {
    if (!(await this.repository.revokePublisherKey(userId, keyId, this.clock.nowUnixSeconds()))) {
      throw new Error('PUBLISHER_KEY_NOT_FOUND');
    }
  }

  async stage(userId: number, input: PluginStageInput): Promise<PluginStageRecord> {
    const source = await this.packages.open(userId, input.artifactAppId, input.artifactId);
    const stageId = randomUUID();
    const staged = await this.verifier.stage({ stageId, sizeBytes: source.sizeBytes, source: source.source });
    const now = this.clock.nowUnixSeconds();
    const record: PluginStageRecord = {
      id: stageId,
      userId,
      artifactAppId: input.artifactAppId,
      artifactId: input.artifactId,
      packageHash: staged.packageHash,
      sizeBytes: staged.sizeBytes,
      publisherKeyId: null,
      appId: null,
      version: null,
      manifest: null,
      status: 'staged',
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      versionNumber: 1,
    };
    try {
      await this.repository.createStage(record);
      return record;
    } catch (error) {
      await this.verifier.discardStage(stageId).catch(() => undefined);
      throw error;
    }
  }

  async verify(userId: number, stageId: string): Promise<{ stage: PluginStageRecord; plugin: PluginVersionRecord }> {
    const stage = await this.requireStage(userId, stageId);
    if (stage.status === 'installed') throw new Error('PLUGIN_STAGE_ALREADY_INSTALLED');
    try {
      const verified = await this.verifyPackage(userId, stage);
      if (this.registry.isBuiltin(verified.manifest.id)) throw new Error('PLUGIN_APP_ID_RESERVED');
      if (verified.packageHash !== stage.packageHash) throw new Error('PLUGIN_STAGE_CHANGED');
      const now = this.clock.nowUnixSeconds();
      const plugin = this.pluginRecord(verified, 'verified', now, null);
      await this.repository.upsertVersion(plugin);
      const updated = await this.repository.updateStage(userId, stageId, stage.versionNumber, {
        publisherKeyId: verified.publisherKeyId,
        appId: verified.manifest.id,
        version: verified.manifest.version,
        manifest: verified.manifest,
        status: 'verified',
        errorCode: null,
        updatedAt: now,
      });
      await this.verifier.adoptStage(stageId, verified.manifest.id);
      return { stage: updated, plugin };
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.slice(0, 128) : 'PLUGIN_VERIFY_FAILED';
      await this.repository
        .updateStage(userId, stageId, stage.versionNumber, {
          status: 'failed',
          errorCode,
          updatedAt: this.clock.nowUnixSeconds(),
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async install(userId: number, stageId: string): Promise<PluginInstallResult> {
    let stage = await this.requireStage(userId, stageId);
    if (!['verified', 'failed'].includes(stage.status)) throw new Error('PLUGIN_STAGE_NOT_VERIFIED');
    const verified = await this.verifyPackage(userId, stage);
    if (verified.packageHash !== stage.packageHash) throw new Error('PLUGIN_STAGE_CHANGED');
    if (this.registry.isBuiltin(verified.manifest.id)) throw new Error('PLUGIN_APP_ID_RESERVED');
    const scope = { userId, appId: verified.manifest.id };
    const existingState = await this.states.get(scope);
    const existingInstallation = await this.repository.getInstallation(userId, verified.manifest.id);
    if (
      existingState &&
      existingInstallation?.status === 'installed' &&
      existingState.activeVersion !== verified.manifest.version
    ) {
      throw new Error('PLUGIN_UPGRADE_REQUIRED');
    }
    if (existingState && existingInstallation && existingInstallation.version !== existingState.activeVersion) {
      throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
    }
    if (existingState && !existingInstallation && existingState.activeVersion !== verified.manifest.version) {
      throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
    }

    const now = this.clock.nowUnixSeconds();
    const plugin = this.pluginRecord(verified, 'installed', now, now);
    await this.verifier.install(stageId, verified);
    await this.repository.upsertVersion(plugin);
    this.registry.registerVersion(this.definition(plugin));

    if (!existingState) {
      const inserted = await this.states.insertDefault({
        ...scope,
        activeVersion: verified.manifest.version,
        desiredState: 'disabled',
        observedState: 'disabled',
        healthReason: null,
        policyRevision: 1,
        runningCount: 0,
        approvalCount: 0,
        budgetRequestCount: 0,
        acceptNewRuns: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      if (inserted) this.onHostStateCommitted(userId);
    }
    let current = await this.states.get(scope);
    if (!current) throw new Error('PLUGIN_APP_STATE_MISSING');
    if (existingInstallation?.status === 'removed') {
      current = await this.repository.activateInstallation(
        userId,
        verified.manifest.id,
        existingInstallation.version,
        verified.manifest.version,
        current.version,
        'disabled',
        now,
      );
      this.onHostStateCommitted(userId);
    } else {
      await this.repository.upsertInstallation({
        userId,
        appId: verified.manifest.id,
        version: verified.manifest.version,
        status: 'installed',
        createdAt: existingInstallation?.createdAt ?? now,
        updatedAt: now,
      });
    }
    stage = await this.repository.updateStage(userId, stageId, stage.versionNumber, {
      publisherKeyId: verified.publisherKeyId,
      appId: verified.manifest.id,
      version: verified.manifest.version,
      manifest: verified.manifest,
      status: 'installed',
      errorCode: null,
      updatedAt: now,
    });
    await this.verifier.discardStage(stageId, stage.appId);
    return { stage, plugin, app: this.appView(current, plugin) };
  }

  async upgrade(userId: number, appId: string, stageId: string, expectedVersion: number): Promise<PluginUpgradeResult> {
    if (this.registry.isBuiltin(appId)) throw new Error('PLUGIN_APP_ID_RESERVED');
    let stage = await this.requireStage(userId, stageId);
    const verified = await this.verifyPackage(userId, stage);
    if (verified.manifest.id !== appId) throw new Error('PLUGIN_APP_ID_MISMATCH');
    if (verified.packageHash !== stage.packageHash) throw new Error('PLUGIN_STAGE_CHANGED');
    const scope = { userId, appId };
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed') throw new Error('PLUGIN_NOT_INSTALLED');
    const state = await this.states.get(scope);
    if (!state) throw new Error('AGENT_APP_NOT_FOUND');
    if (state.version !== expectedVersion) throw new Error('APP_STATE_VERSION_CONFLICT');
    if (installation.version !== state.activeVersion) throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
    if (verified.manifest.version === state.activeVersion) throw new Error('PLUGIN_VERSION_ALREADY_ACTIVE');
    const oldPlugin = await this.repository.getVersion(appId, state.activeVersion);
    if (!oldPlugin || oldPlugin.status === 'removed') throw new Error('PLUGIN_VERSION_NOT_FOUND');

    const now = this.clock.nowUnixSeconds();
    const nextPlugin = this.pluginRecord(verified, 'installed', now, now);
    await this.verifier.install(stageId, verified);
    await this.repository.upsertVersion(nextPlugin);
    this.registry.registerVersion(this.definition(nextPlugin));

    const draining = state.acceptNewRuns
      ? await this.compareAndSetState(scope, state.version, { acceptNewRuns: false })
      : state;
    if (draining.runningCount > 0) {
      return {
        state: 'draining',
        targetVersion: verified.manifest.version,
        app: this.appView(draining, oldPlugin),
        plugin: nextPlugin,
      };
    }

    const snapshot = await this.storage.capture(scope);
    let updated: AppRecord;
    try {
      if (draining.desiredState === 'enabled') await this.runtime.quiesce(scope, oldPlugin, now + 10);
      await this.runtime.dispose(scope, oldPlugin);
      const migrated = (await this.runtime.migrate?.(scope, oldPlugin.version, nextPlugin, snapshot)) ?? snapshot;
      await this.storage.restore(scope, migrated);
      if (draining.desiredState === 'enabled') await this.runtime.activate(scope, nextPlugin);
      if (nextPlugin.backendEntry) {
        const health = await this.runtime.health(scope, nextPlugin);
        if (!health.available) throw new Error(health.reason ?? 'PLUGIN_RUNTIME_UNAVAILABLE');
      }
      const beforeSwitch = await this.states.get(scope);
      if (!beforeSwitch || beforeSwitch.version !== draining.version || beforeSwitch.runningCount !== 0) {
        throw new Error('APP_STATE_VERSION_CONFLICT');
      }
      updated = await this.repository.activateInstallation(
        userId,
        appId,
        oldPlugin.version,
        nextPlugin.version,
        beforeSwitch.version,
        beforeSwitch.desiredState === 'enabled' ? 'running' : 'disabled',
        this.clock.nowUnixSeconds(),
      );
      this.onHostStateCommitted(userId);
    } catch (error) {
      await this.storage.restore(scope, snapshot).catch(() => undefined);
      await this.runtime.dispose(scope, nextPlugin).catch(() => undefined);
      if (draining.desiredState === 'enabled') await this.runtime.activate(scope, oldPlugin).catch(() => undefined);
      const current = await this.states.get(scope).catch(() => null);
      if (current && current.activeVersion === oldPlugin.version && !current.acceptNewRuns) {
        await this.compareAndSetState(scope, current.version, {
          acceptNewRuns: true,
          observedState: draining.observedState,
          healthReason: draining.healthReason,
        }).catch(() => undefined);
      }
      if ((await this.repository.countInstalled(appId, nextPlugin.version).catch(() => 1)) === 0) {
        await this.verifier.removeInstalled(appId, nextPlugin.version).catch(() => undefined);
        await this.repository
          .updateVersionStatus(appId, nextPlugin.version, 'failed', null, this.clock.nowUnixSeconds())
          .catch(() => undefined);
      }
      throw error;
    }

    try {
      stage = await this.repository.updateStage(userId, stageId, stage.versionNumber, {
        publisherKeyId: verified.publisherKeyId,
        appId,
        version: verified.manifest.version,
        manifest: verified.manifest,
        status: 'installed',
        errorCode: null,
        updatedAt: this.clock.nowUnixSeconds(),
      });
      await this.verifier.discardStage(stage.id, appId);
    } catch {
      // The active version is already atomically committed. Preserve the staged package for reconciliation/retry.
    }
    return {
      state: 'completed',
      targetVersion: nextPlugin.version,
      app: this.appView(updated, nextPlugin),
      plugin: nextPlugin,
    };
  }

  async uninstall(userId: number, appId: string, expectedVersion: number): Promise<PluginUninstallResult> {
    if (this.registry.isBuiltin(appId)) throw new Error('PLUGIN_APP_ID_RESERVED');
    const scope = { userId, appId };
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed') throw new Error('PLUGIN_NOT_INSTALLED');
    const state = await this.states.get(scope);
    if (!state) throw new Error('AGENT_APP_NOT_FOUND');
    if (state.version !== expectedVersion) throw new Error('APP_STATE_VERSION_CONFLICT');
    if (installation.version !== state.activeVersion) throw new Error('PLUGIN_INSTALLATION_STATE_CONFLICT');
    const plugin = await this.repository.getVersion(appId, installation.version);
    if (!plugin) throw new Error('PLUGIN_VERSION_NOT_FOUND');
    const draining = state.acceptNewRuns
      ? await this.compareAndSetState(scope, state.version, { acceptNewRuns: false })
      : state;
    if (draining.runningCount > 0) return { state: 'draining', app: this.appView(draining, plugin) };

    let updated: AppRecord;
    try {
      if (draining.desiredState === 'enabled') {
        await this.runtime.quiesce(scope, plugin, this.clock.nowUnixSeconds() + 10);
      }
      await this.runtime.dispose(scope, plugin);
      const beforeRemoval = await this.states.get(scope);
      if (!beforeRemoval || beforeRemoval.version !== draining.version || beforeRemoval.runningCount !== 0) {
        throw new Error('APP_STATE_VERSION_CONFLICT');
      }
      updated = await this.repository.removeInstallation(
        userId,
        appId,
        plugin.version,
        beforeRemoval.version,
        this.clock.nowUnixSeconds(),
      );
      this.onHostStateCommitted(userId);
    } catch (error) {
      if (draining.desiredState === 'enabled') await this.runtime.activate(scope, plugin).catch(() => undefined);
      const current = await this.states.get(scope).catch(() => null);
      if (current && current.activeVersion === plugin.version && !current.acceptNewRuns) {
        await this.compareAndSetState(scope, current.version, {
          acceptNewRuns: true,
          observedState: draining.observedState,
          healthReason: draining.healthReason,
        }).catch(() => undefined);
      }
      throw error;
    }
    if ((await this.repository.countInstalled(appId, plugin.version)) === 0) {
      try {
        await this.verifier.removeInstalled(appId, plugin.version);
        await this.repository.updateVersionStatus(appId, plugin.version, 'removed', null, this.clock.nowUnixSeconds());
      } catch {
        await this.repository
          .updateVersionStatus(appId, plugin.version, 'failed', null, this.clock.nowUnixSeconds())
          .catch(() => undefined);
      }
    }
    return { state: 'removed', app: this.appView(updated, plugin) };
  }

  async deleteData(userId: number, appId: string): Promise<void> {
    const installation = await this.repository.getInstallation(userId, appId);
    if (installation?.status === 'installed') throw new Error('PLUGIN_MUST_BE_UNINSTALLED');
    await this.storage.clear({ userId, appId });
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
    if (!this.publicOrigin || !this.pluginFrontendOrigin) throw new Error('PLUGIN_FRONTEND_ORIGIN_UNAVAILABLE');
    if (this.pluginFrontendOrigin === this.publicOrigin) throw new Error('PLUGIN_FRONTEND_ORIGIN_NOT_ISOLATED');
    const relativeEntry = plugin.frontendEntry
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return {
      appId,
      version: plugin.version,
      sdkVersion: plugin.manifest.sdkVersion,
      protocolVersion: PLUGIN_FRONTEND_PROTOCOL_VERSION,
      url: `${this.pluginFrontendOrigin}/plugins/${encodeURIComponent(appId)}/${encodeURIComponent(plugin.version)}/${relativeEntry}`,
      sandbox: 'allow-scripts',
      maxMessageBytes: 64_000,
      requestTimeoutMs: 10_000,
    };
  }

  async frontendRpc(userId: number, appId: string, request: PluginFrontendRpcRequest): Promise<JsonValue> {
    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded, 'utf8') > MAX_FRONTEND_RPC_BYTES) throw new Error('PLUGIN_FRONTEND_RPC_TOO_LARGE');
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed') throw new Error('PLUGIN_NOT_INSTALLED');
    const scope = { userId, appId };
    const state = await this.states.get(scope);
    if (
      !state ||
      state.activeVersion !== installation.version ||
      state.desiredState !== 'enabled' ||
      !['running', 'degraded'].includes(state.observedState)
    ) {
      throw new Error('AGENT_APP_DISABLED');
    }
    const plugin = await this.repository.getVersion(appId, installation.version);
    if (!plugin || plugin.status !== 'installed') throw new Error('PLUGIN_VERSION_NOT_FOUND');

    switch (request.method) {
      case 'host.appInfo': {
        const params = asRecord(request.params);
        requireOnlyKeys(params, []);
        return {
          appId,
          version: plugin.version,
          sdkVersion: plugin.manifest.sdkVersion,
          protocolVersion: PLUGIN_FRONTEND_PROTOCOL_VERSION,
          displayName: plugin.manifest.displayName,
          declaredCapabilities: [...plugin.manifest.capabilities],
        };
      }
      case 'storage.get': {
        await this.requireCapability(scope, 'storage.app');
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['key']);
        return storageRecordJson(await this.storage.get(scope, requireStorageKey(params.key)));
      }
      case 'storage.put': {
        await this.requireCapability(scope, 'storage.app');
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['key', 'value', 'expectedVersion']);
        const expectedVersion = params.expectedVersion;
        if (expectedVersion !== null && (!Number.isSafeInteger(expectedVersion) || (expectedVersion as number) < 1)) {
          throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        }
        if (!Object.prototype.hasOwnProperty.call(params, 'value')) throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        return storageRecordJson(
          await this.storage.put(
            scope,
            requireStorageKey(params.key),
            params.value as JsonValue,
            expectedVersion as number | null,
          ),
        );
      }
      case 'storage.delete': {
        await this.requireCapability(scope, 'storage.app');
        const params = asRecord(request.params);
        requireOnlyKeys(params, ['key', 'expectedVersion']);
        if (!Number.isSafeInteger(params.expectedVersion) || (params.expectedVersion as number) < 1) {
          throw new Error('PLUGIN_FRONTEND_RPC_INVALID');
        }
        return {
          deleted: await this.storage.delete(scope, requireStorageKey(params.key), params.expectedVersion as number),
        };
      }
      default:
        throw new Error('PLUGIN_FRONTEND_RPC_METHOD_DENIED');
    }
  }

  async initializeInstalledVersions(): Promise<void> {
    const stages = await this.repository.listStages();
    await this.verifier
      .reconcileStages(stages.map((stage) => ({ stageId: stage.id, appId: stage.appId })))
      .catch(() => undefined);
    for (const plugin of await this.repository.listVersions()) {
      if (plugin.status === 'installed') this.registry.registerVersion(this.definition(plugin));
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
    await this.runtime.reconcileUser(userId, entries).catch(() => undefined);
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

  listVersions(userId: number, appId?: string): Promise<PluginVersionRecord[]> {
    return this.repository.listVersionsForUser(userId, appId);
  }

  listInstallations(userId: number) {
    return this.repository.listInstallations(userId);
  }

  private async reconcileRuntime(userId: number, plugin: PluginVersionRecord): Promise<void> {
    const scope = { userId, appId: plugin.appId };
    const current = await this.states.get(scope);
    if (!current || current.activeVersion !== plugin.version) return;

    if (current.desiredState === 'disabled') {
      await this.runtime.dispose(scope, plugin).catch(() => undefined);
      if (current.observedState !== 'disabled') {
        await this.compareAndSetState(scope, current.version, { observedState: 'disabled', healthReason: null }).catch(
          () => undefined,
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
        await this.compareAndSetState(scope, current.version, { observedState, healthReason }).catch(() => undefined);
      }
    } catch (error) {
      const healthReason = error instanceof Error ? error.message.slice(0, 1024) : 'PLUGIN_RUNTIME_UNAVAILABLE';
      await this.compareAndSetState(scope, current.version, { observedState: 'degraded', healthReason }).catch(
        () => undefined,
      );
    }
  }

  private async compareAndSetState(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord> {
    const updated = await this.states.compareAndSet(scope, expectedVersion, patch);
    this.onHostStateCommitted(scope.userId);
    return updated;
  }

  private async requireStage(userId: number, stageId: string): Promise<PluginStageRecord> {
    const stage = await this.repository.getStage(userId, stageId);
    if (!stage) throw new Error('PLUGIN_STAGE_NOT_FOUND');
    return stage;
  }

  private verifyPackage(userId: number, stage: PluginStageRecord): Promise<VerifiedPluginPackage> {
    return this.verifier.verify(
      stage.id,
      stage.appId,
      async (keyId) => {
        const key = await this.repository.getPublisherKey(userId, keyId);
        return key && key.revokedAt === null ? key.publicKeyPem : null;
      },
      (raw) => validateManifest(raw, { nexusVersion: this.nexusVersion, supportedSdkMajor: 1 }),
    );
  }

  private pluginRecord(
    verified: VerifiedPluginPackage,
    status: PluginVersionRecord['status'],
    updatedAt: number,
    installedAt: number | null,
  ): PluginVersionRecord {
    return {
      appId: verified.manifest.id,
      version: verified.manifest.version,
      packageHash: verified.packageHash,
      publisherKeyId: verified.publisherKeyId,
      manifest: verified.manifest,
      frontendEntry: verified.frontendEntry,
      backendEntry: verified.backendEntry,
      runnerEntry: verified.runnerEntry,
      skillFiles: [...verified.skillFiles],
      status,
      installedAt,
      updatedAt,
    };
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

  private async requireCapability(scope: { userId: number; appId: string }, capability: 'storage.app'): Promise<void> {
    const decision = await this.capabilities.authorize(scope, capability);
    if (!decision.allowed) throw new Error(decision.code);
  }

  private async assertInstalled(userId: number, appId: string, version: string): Promise<void> {
    const installation = await this.repository.getInstallation(userId, appId);
    if (!installation || installation.status !== 'installed' || installation.version !== version) {
      throw new Error('PLUGIN_NOT_INSTALLED');
    }
  }

  private appView(record: AppRecord, plugin: PluginVersionRecord): AppView {
    return {
      ...record,
      displayName: plugin.manifest.displayName,
      capabilities: [...plugin.manifest.capabilities],
    };
  }
}
