import { randomUUID } from 'node:crypto';
import { compare, major, valid as validSemver } from 'semver';
import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { ClockPort, Scope } from '../agent.types';
import { validateManifest } from './app-manifest-validator';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AppRecord, AppStatePatch } from './app.types';
import type { AgentSettingsService } from './agent-settings.service';
import type { PackageVerifierPort, VerifiedPluginPackage } from './package-verifier.port';
import type { PluginPackageSourcePort } from './plugin-package-source.port';
import type { PluginDataManager } from './plugin-data-manager';
import type {
  PluginInstallRepositoryPort,
  PluginStageRecord,
  PluginVersionRecord,
  TrustedPublisherKey,
} from './plugin-install.repository.port';
import type {
  PluginInstallResult,
  PluginStageInput,
  PluginUninstallResult,
  PluginUpgradeResult,
  RemotePluginStageInput,
} from './plugin-install.types';
import type { OfficialAgentPluginSource } from './official-plugin-source';
import type {
  RemotePluginCatalog,
  RemotePluginPackageEntry,
  RemotePluginRepositoryConfig,
  RemotePluginRepositoryPort,
} from './remote-plugin-repository.port';
import type { PluginRuntimeLifecycleCoordinator } from './plugin-runtime-lifecycle-coordinator';

const MAX_PUBLISHER_LABEL_BYTES = 256;
const SUPPORTED_PLUGIN_SDK_MAJOR = 1;

export class PluginPackageInstallCoordinator {
  constructor(
    private readonly repository: PluginInstallRepositoryPort,
    private readonly verifier: PackageVerifierPort,
    private readonly packages: PluginPackageSourcePort,
    private readonly remotePackages: RemotePluginRepositoryPort,
    private readonly settings: AgentSettingsService,
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly data: PluginDataManager,
    private readonly runtimeLifecycle: PluginRuntimeLifecycleCoordinator,
    private readonly clock: ClockPort,
    private readonly nexusVersion: string,
    private readonly onHostStateCommitted: (userId: number) => void = () => undefined,
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
      source: { kind: 'artifact', appId: input.artifactAppId, id: input.artifactId },
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
      logger.info(
        {
          userId,
          stageId,
          artifactAppId: input.artifactAppId,
          artifactId: input.artifactId,
          packageHash: staged.packageHash,
          sizeBytes: staged.sizeBytes,
        },
        'Agent local plugin staged',
      );
      return record;
    } catch (error) {
      logger.warn(
        {
          err: error,
          errorCode: logErrorCode(error, 'PLUGIN_STAGE_FAILED'),
          userId,
          stageId,
          artifactAppId: input.artifactAppId,
          artifactId: input.artifactId,
        },
        'Agent local plugin staging failed',
      );
      await this.verifier
        .discardStage(stageId)
        .catch((cleanupError) =>
          logger.warn({ err: cleanupError, stageId, userId }, 'Agent failed local plugin stage cleanup failed'),
        );
      throw error;
    }
  }

  async remoteCatalog(userId: number, repositoryUrl: string, signal?: AbortSignal): Promise<RemotePluginCatalog> {
    const catalog = await this.remotePackages.catalog(await this.remoteRepositoryConfig(userId, repositoryUrl), signal);
    return this.catalogWithCompatibility(catalog);
  }

  async officialCatalog(source: OfficialAgentPluginSource, signal?: AbortSignal): Promise<RemotePluginCatalog> {
    const catalog = await this.remotePackages.catalog(this.officialRepositoryConfig(source), signal);
    const publisher = catalog.publishers.find((candidate) => candidate.keyId === source.publisherKeyId);
    if (
      !publisher ||
      publisher.publicKeyPem.trim() !== source.publisherPublicKeyPem.trim() ||
      catalog.packages.some((candidate) => candidate.publisherKeyId !== source.publisherKeyId)
    ) {
      throw new Error('OFFICIAL_PLUGIN_PUBLISHER_MISMATCH');
    }
    return this.catalogWithCompatibility(catalog);
  }

  async stageRemote(userId: number, input: RemotePluginStageInput, signal?: AbortSignal): Promise<PluginStageRecord> {
    if (!input.appId || !input.version || !input.repositoryUrl) throw new Error('VALIDATION_FAILED');
    return this.stageRemoteWithConfig(
      userId,
      input,
      await this.remoteRepositoryConfig(userId, input.repositoryUrl),
      signal,
    );
  }

  async stageOfficial(
    userId: number,
    source: OfficialAgentPluginSource,
    appId: string,
    version: string,
    signal?: AbortSignal,
  ): Promise<PluginStageRecord> {
    if (!appId || !version) throw new Error('VALIDATION_FAILED');
    const catalog = await this.officialCatalog(source, signal);
    const entry = catalog.packages.find((candidate) => candidate.appId === appId && candidate.version === version);
    if (!entry) throw new Error('PLUGIN_REMOTE_PACKAGE_NOT_FOUND');
    if (entry.compatible !== true) throw new Error('PLUGIN_REMOTE_PACKAGE_INCOMPATIBLE');
    await this.trustPublisherKey(userId, source.publisherPublicKeyPem, source.publisherLabel);
    return this.stageRemoteWithConfig(
      userId,
      { repositoryUrl: source.catalogUrl, appId, version },
      this.officialRepositoryConfig(source),
      signal,
      source.publisherKeyId,
      catalog,
    );
  }

  async verify(userId: number, stageId: string): Promise<{ stage: PluginStageRecord; plugin: PluginVersionRecord }> {
    const stage = await this.requireStage(userId, stageId);
    logger.debug(
      { userId, stageId, appId: stage.appId, version: stage.version, stageStatus: stage.status },
      'Agent plugin verification started',
    );
    if (stage.status === 'installed') throw new Error('PLUGIN_STAGE_ALREADY_INSTALLED');
    try {
      const verified = await this.verifyPackage(userId, stage);
      this.assertStageIdentity(stage, verified);
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
      logger.info(
        {
          userId,
          stageId,
          appId: verified.manifest.id,
          version: verified.manifest.version,
          publisherKeyId: verified.publisherKeyId,
          packageHash: verified.packageHash,
        },
        'Agent plugin verification completed',
      );
      return { stage: updated, plugin };
    } catch (error) {
      const errorCode = logErrorCode(error, 'PLUGIN_VERIFY_FAILED').slice(0, 128);
      logger.warn(
        { err: error, errorCode, userId, stageId, appId: stage.appId, version: stage.version },
        'Agent plugin verification failed',
      );
      await this.repository
        .updateStage(userId, stageId, stage.versionNumber, {
          status: 'failed',
          errorCode,
          updatedAt: this.clock.nowUnixSeconds(),
        })
        .catch((stageError) =>
          logger.warn(
            { err: stageError, userId, stageId, errorCode },
            'Agent plugin verification failure state could not be persisted',
          ),
        );
      throw error;
    }
  }

  async install(userId: number, stageId: string): Promise<PluginInstallResult> {
    let stage = await this.requireStage(userId, stageId);
    logger.debug(
      { userId, stageId, appId: stage.appId, version: stage.version, stageStatus: stage.status },
      'Agent plugin installation started',
    );
    if (!['verified', 'failed'].includes(stage.status)) throw new Error('PLUGIN_STAGE_NOT_VERIFIED');
    const verified = await this.verifyPackage(userId, stage);
    this.assertStageIdentity(stage, verified);
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
    this.runtimeLifecycle.registerVersion(plugin);

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
    try {
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
    } catch (error) {
      logger.warn(
        { err: error, userId, stageId, appId: plugin.appId, version: plugin.version },
        'Agent plugin install stage finalization failed after installation commit',
      );
      // Installation/app state is already authoritative. Preserve the stage for reconciliation instead of reporting install failure.
    }
    logger.info(
      {
        userId,
        stageId,
        appId: plugin.appId,
        version: plugin.version,
        desiredState: current.desiredState,
        observedState: current.observedState,
      },
      'Agent plugin installation completed',
    );
    return { stage, plugin, app: this.runtimeLifecycle.appView(current, plugin) };
  }

  async upgrade(userId: number, appId: string, stageId: string, expectedVersion: number): Promise<PluginUpgradeResult> {
    logger.debug({ userId, appId, stageId, expectedVersion }, 'Agent plugin upgrade started');
    if (this.registry.isBuiltin(appId)) throw new Error('PLUGIN_APP_ID_RESERVED');
    let stage = await this.requireStage(userId, stageId);
    const verified = await this.verifyPackage(userId, stage);
    this.assertStageIdentity(stage, verified);
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
    this.runtimeLifecycle.registerVersion(nextPlugin);

    const draining = state.acceptNewRuns
      ? await this.compareAndSetState(scope, state.version, { acceptNewRuns: false })
      : state;
    if (draining.runningCount > 0) {
      logger.info(
        {
          userId,
          appId,
          fromVersion: oldPlugin.version,
          targetVersion: verified.manifest.version,
          runningCount: draining.runningCount,
        },
        'Agent plugin upgrade waiting for active Runs to drain',
      );
      return {
        state: 'draining',
        targetVersion: verified.manifest.version,
        app: this.runtimeLifecycle.appView(draining, oldPlugin),
        plugin: nextPlugin,
      };
    }

    const snapshot = await this.data.capture(scope);
    let updated: AppRecord;
    try {
      if (draining.desiredState === 'enabled') await this.runtimeLifecycle.quiesce(scope, oldPlugin, now + 10);
      await this.runtimeLifecycle.dispose(scope, oldPlugin);
      const migrated = await this.runtimeLifecycle.migrate(scope, oldPlugin.version, nextPlugin, snapshot);
      await this.data.restore(scope, migrated);
      if (draining.desiredState === 'enabled') await this.runtimeLifecycle.activate(scope, nextPlugin);
      await this.runtimeLifecycle.assertHealthy(scope, nextPlugin);
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
      logger.error(
        {
          err: error,
          errorCode: logErrorCode(error, 'PLUGIN_UPGRADE_FAILED'),
          userId,
          appId,
          fromVersion: oldPlugin.version,
          targetVersion: nextPlugin.version,
          stageId,
        },
        'Agent plugin upgrade failed; rollback started',
      );
      await this.data
        .restore(scope, snapshot)
        .catch((rollbackError) =>
          logger.error(
            { err: rollbackError, userId, appId, fromVersion: oldPlugin.version, targetVersion: nextPlugin.version },
            'Agent plugin upgrade storage rollback failed',
          ),
        );
      await this.runtimeLifecycle
        .dispose(scope, nextPlugin)
        .catch((rollbackError) =>
          logger.error(
            { err: rollbackError, userId, appId, targetVersion: nextPlugin.version },
            'Agent plugin upgrade new runtime disposal during rollback failed',
          ),
        );
      if (draining.desiredState === 'enabled') {
        await this.runtimeLifecycle
          .activate(scope, oldPlugin)
          .catch((rollbackError) =>
            logger.error(
              { err: rollbackError, userId, appId, restoredVersion: oldPlugin.version },
              'Agent plugin upgrade old runtime reactivation during rollback failed',
            ),
          );
      }
      const current = await this.states.get(scope).catch((stateError) => {
        logger.error(
          { err: stateError, userId, appId, targetVersion: nextPlugin.version },
          'Agent plugin upgrade rollback could not read App state',
        );
        return null;
      });
      if (current && current.activeVersion === oldPlugin.version && !current.acceptNewRuns) {
        await this.compareAndSetState(scope, current.version, {
          acceptNewRuns: true,
          observedState: draining.observedState,
          healthReason: draining.healthReason,
        }).catch((stateError) =>
          logger.error(
            { err: stateError, userId, appId, restoredVersion: oldPlugin.version },
            'Agent plugin upgrade rollback could not reopen App for new Runs',
          ),
        );
      }
      if (
        (await this.repository.countInstalled(appId, nextPlugin.version).catch((countError) => {
          logger.warn(
            { err: countError, userId, appId, targetVersion: nextPlugin.version },
            'Agent plugin upgrade rollback could not count installed target versions',
          );
          return 1;
        })) === 0
      ) {
        await this.verifier
          .removeInstalled(appId, nextPlugin.version)
          .catch((cleanupError) =>
            logger.warn(
              { err: cleanupError, userId, appId, targetVersion: nextPlugin.version },
              'Agent plugin upgrade rollback could not remove staged target package',
            ),
          );
        await this.repository
          .updateVersionStatus(appId, nextPlugin.version, 'failed', null, this.clock.nowUnixSeconds())
          .catch((statusError) =>
            logger.warn(
              { err: statusError, userId, appId, targetVersion: nextPlugin.version },
              'Agent plugin upgrade rollback could not persist failed target version status',
            ),
          );
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
    } catch (error) {
      logger.warn(
        { err: error, userId, appId, stageId, activeVersion: nextPlugin.version },
        'Agent plugin upgrade stage finalization failed after active version commit',
      );
      // The active version is already atomically committed. Preserve the staged package for reconciliation/retry.
    }
    logger.info(
      { userId, appId, fromVersion: oldPlugin.version, targetVersion: nextPlugin.version, stageId },
      'Agent plugin upgrade completed',
    );
    return {
      state: 'completed',
      targetVersion: nextPlugin.version,
      app: this.runtimeLifecycle.appView(updated, nextPlugin),
      plugin: nextPlugin,
    };
  }

  async uninstall(userId: number, appId: string, expectedVersion: number): Promise<PluginUninstallResult> {
    logger.debug({ userId, appId, expectedVersion }, 'Agent plugin uninstall started');
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
    if (draining.runningCount > 0) {
      logger.info(
        { userId, appId, version: plugin.version, runningCount: draining.runningCount },
        'Agent plugin uninstall waiting for active Runs to drain',
      );
      return { state: 'draining', app: this.runtimeLifecycle.appView(draining, plugin) };
    }

    let updated: AppRecord;
    try {
      if (draining.desiredState === 'enabled') {
        await this.runtimeLifecycle.quiesce(scope, plugin, this.clock.nowUnixSeconds() + 10);
      }
      await this.runtimeLifecycle.dispose(scope, plugin);
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
      logger.error(
        {
          err: error,
          errorCode: logErrorCode(error, 'PLUGIN_UNINSTALL_FAILED'),
          userId,
          appId,
          version: plugin.version,
        },
        'Agent plugin uninstall failed; state restoration started',
      );
      if (draining.desiredState === 'enabled') {
        await this.runtimeLifecycle
          .activate(scope, plugin)
          .catch((restoreError) =>
            logger.error(
              { err: restoreError, userId, appId, version: plugin.version },
              'Agent plugin runtime restoration after uninstall failure failed',
            ),
          );
      }
      const current = await this.states.get(scope).catch((stateError) => {
        logger.error(
          { err: stateError, userId, appId, version: plugin.version },
          'Agent plugin uninstall rollback could not read App state',
        );
        return null;
      });
      if (current && current.activeVersion === plugin.version && !current.acceptNewRuns) {
        await this.compareAndSetState(scope, current.version, {
          acceptNewRuns: true,
          observedState: draining.observedState,
          healthReason: draining.healthReason,
        }).catch((stateError) =>
          logger.error(
            { err: stateError, userId, appId, version: plugin.version },
            'Agent plugin uninstall rollback could not reopen App for new Runs',
          ),
        );
      }
      throw error;
    }
    if ((await this.repository.countInstalled(appId, plugin.version)) === 0) {
      try {
        await this.verifier.removeInstalled(appId, plugin.version);
        await this.repository.updateVersionStatus(appId, plugin.version, 'removed', null, this.clock.nowUnixSeconds());
        this.runtimeLifecycle.removeVersion(appId, plugin.version);
      } catch (error) {
        logger.warn(
          { err: error, userId, appId, version: plugin.version },
          'Agent plugin installed package cleanup failed after uninstall',
        );
        await this.repository
          .updateVersionStatus(appId, plugin.version, 'failed', null, this.clock.nowUnixSeconds())
          .catch((statusError) =>
            logger.warn(
              { err: statusError, userId, appId, version: plugin.version },
              'Agent plugin uninstall cleanup could not persist failed package status',
            ),
          );
      }
    }
    logger.info({ userId, appId, version: plugin.version }, 'Agent plugin uninstall completed');
    return { state: 'removed', app: this.runtimeLifecycle.appView(updated, plugin) };
  }

  async reconcileStages(): Promise<void> {
    const stages = await this.repository.listStages();
    await this.verifier
      .reconcileStages(stages.map((stage) => ({ stageId: stage.id, appId: stage.appId })))
      .catch((error) =>
        logger.warn(
          { err: error, stageCount: stages.length },
          'Agent plugin staged package reconciliation failed during startup',
        ),
      );
  }

  listVersions(userId: number, appId?: string): Promise<PluginVersionRecord[]> {
    return this.repository.listVersionsForUser(userId, appId);
  }

  private async compareAndSetState(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord> {
    const updated = await this.states.compareAndSet(scope, expectedVersion, patch);
    this.onHostStateCommitted(scope.userId);
    return updated;
  }

  private catalogEntryCompatible(entry: RemotePluginPackageEntry): boolean {
    const nexusVersion = validSemver(this.nexusVersion);
    const sdkVersion = validSemver(entry.sdkVersion);
    const minVersion = validSemver(entry.nexus.minVersion);
    const maxVersion = validSemver(entry.nexus.maxVersion);
    if (!nexusVersion || !sdkVersion || !minVersion || !maxVersion) return false;
    return (
      major(sdkVersion) === SUPPORTED_PLUGIN_SDK_MAJOR &&
      compare(nexusVersion, minVersion) >= 0 &&
      compare(nexusVersion, maxVersion) <= 0
    );
  }

  private catalogWithCompatibility(catalog: RemotePluginCatalog): RemotePluginCatalog {
    return {
      ...catalog,
      packages: catalog.packages.map((entry) => ({ ...entry, compatible: this.catalogEntryCompatible(entry) })),
    };
  }

  private officialRepositoryConfig(source: OfficialAgentPluginSource): RemotePluginRepositoryConfig {
    let normalized: string;
    try {
      normalized = new URL(source.catalogUrl).toString();
    } catch {
      throw new Error('PLUGIN_REMOTE_REPOSITORY_INVALID');
    }
    return { url: normalized };
  }

  private async stageRemoteWithConfig(
    userId: number,
    input: RemotePluginStageInput,
    config: RemotePluginRepositoryConfig,
    signal?: AbortSignal,
    expectedPublisherKeyId?: string,
    validatedCatalog?: RemotePluginCatalog,
  ): Promise<PluginStageRecord> {
    logger.debug(
      { userId, appId: input.appId, version: input.version, repositoryUrl: config.url },
      'Agent remote plugin staging started',
    );
    const catalog = validatedCatalog ?? (await this.remotePackages.catalog(config, signal));
    const entry = catalog.packages.find(
      (candidate) => candidate.appId === input.appId && candidate.version === input.version,
    );
    if (!entry) throw new Error('PLUGIN_REMOTE_PACKAGE_NOT_FOUND');
    if (!this.catalogEntryCompatible(entry)) throw new Error('PLUGIN_REMOTE_PACKAGE_INCOMPATIBLE');
    if (expectedPublisherKeyId && entry.publisherKeyId !== expectedPublisherKeyId) {
      throw new Error('OFFICIAL_PLUGIN_PUBLISHER_MISMATCH');
    }
    const source = await this.remotePackages.openPackage(config, entry, signal);
    const stageId = randomUUID();
    try {
      const staged = await this.verifier.stage({ stageId, sizeBytes: source.sizeBytes, source: source.source });
      if (staged.sizeBytes !== entry.sizeBytes) throw new Error('PLUGIN_REMOTE_SIZE_MISMATCH');
      if (staged.packageHash !== entry.sha256) throw new Error('PLUGIN_REMOTE_HASH_MISMATCH');
      const now = this.clock.nowUnixSeconds();
      const record: PluginStageRecord = {
        id: stageId,
        userId,
        source: { kind: 'remote', repositoryUrl: config.url, appId: entry.appId, version: entry.version },
        packageHash: staged.packageHash,
        sizeBytes: staged.sizeBytes,
        publisherKeyId: entry.publisherKeyId,
        appId: entry.appId,
        version: entry.version,
        manifest: null,
        status: 'staged',
        errorCode: null,
        createdAt: now,
        updatedAt: now,
        versionNumber: 1,
      };
      await this.repository.createStage(record);
      logger.info(
        {
          userId,
          stageId,
          appId: entry.appId,
          version: entry.version,
          publisherKeyId: entry.publisherKeyId,
          packageHash: staged.packageHash,
          sizeBytes: staged.sizeBytes,
          repositoryUrl: config.url,
        },
        'Agent remote plugin staged',
      );
      return record;
    } catch (error) {
      logger.warn(
        {
          err: error,
          errorCode: logErrorCode(error, 'PLUGIN_STAGE_FAILED'),
          userId,
          stageId,
          appId: input.appId,
          version: input.version,
          repositoryUrl: config.url,
        },
        'Agent remote plugin staging failed',
      );
      await this.verifier
        .discardStage(stageId)
        .catch((cleanupError) =>
          logger.warn({ err: cleanupError, stageId, userId }, 'Agent failed remote plugin stage cleanup failed'),
        );
      throw error;
    }
  }

  private async remoteRepositoryConfig(userId: number, rawUrl: string): Promise<RemotePluginRepositoryConfig> {
    let normalized: string;
    try {
      normalized = new URL(rawUrl).toString();
    } catch {
      throw new Error('PLUGIN_REMOTE_REPOSITORY_INVALID');
    }
    const view = await this.settings.get(userId);
    const config = view.effectiveSettings.plugins.repositories.find((candidate) => candidate.url === normalized);
    if (!config) throw new Error('PLUGIN_REMOTE_REPOSITORY_NOT_CONFIGURED');
    return { url: config.url };
  }

  private assertStageIdentity(stage: PluginStageRecord, verified: VerifiedPluginPackage): void {
    if (stage.source.kind !== 'remote') return;
    if (verified.manifest.id !== stage.source.appId || verified.manifest.version !== stage.source.version) {
      throw new Error('PLUGIN_REMOTE_IDENTITY_MISMATCH');
    }
    if (stage.publisherKeyId && verified.publisherKeyId !== stage.publisherKeyId) {
      throw new Error('PLUGIN_REMOTE_PUBLISHER_MISMATCH');
    }
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
}
