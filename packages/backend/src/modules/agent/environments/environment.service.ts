import { randomUUID } from 'node:crypto';
import type { AgentSettingsService } from '../host/agent-settings.service';
import type { AppLifecycleService } from '../host/app-lifecycle.service';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import type { JsonValue, Scope } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';
import type {
  EnvironmentControllerPort,
  EnvironmentWorkspaceReadHandle,
  RunnerCommandRequest,
} from './environment-controller.port';
import { PLUGIN_RUNNER_PROTOCOL_VERSION, type PluginRunnerTargetSourcePort } from '../host/plugin-runner-target.port';
import type { EnvironmentRepositoryPort } from './environment.repository.port';
import type {
  EnvironmentCatalog,
  EnvironmentCommandView,
  EnvironmentCreateSpec,
  EnvironmentGroupDetail,
  EnvironmentGroupView,
  EnvironmentNetworkPolicy,
  EnvironmentPackRef,
  EnvironmentResourceLimits,
  EnvironmentWorkspaceGrant,
  EnvironmentWorkspaceGrantInput,
} from './environment.types';

const MAX_ENVIRONMENTS_PER_REQUEST = 8;
const COMMAND_SECONDS = 120;
const ADMIN_SCOPE = { userId: 0, appId: 'nexus.host' } as const;

const cleanHosts = (hosts: readonly string[]): string[] => {
  if (!Array.isArray(hosts) || hosts.length > 64) throw new Error('VALIDATION_FAILED');
  const normalized = [...new Set(hosts.map((host) => host.trim().toLowerCase()))];
  if (normalized.some((host) => !host || host.length > 253 || /[\s/@]/.test(host)))
    throw new Error('VALIDATION_FAILED');
  return normalized.sort();
};

const network = (
  value: EnvironmentNetworkPolicy | undefined,
  fallback: EnvironmentNetworkPolicy,
): EnvironmentNetworkPolicy => {
  const candidate = value ?? fallback;
  if (candidate.mode !== 'none' && candidate.mode !== 'allowlist') throw new Error('VALIDATION_FAILED');
  const hosts = candidate.mode === 'none' ? [] : cleanHosts(candidate.hosts);
  return { mode: candidate.mode, hosts };
};

const finitePositive = (value: unknown, fallback: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('VALIDATION_FAILED');
  return value;
};

const positiveInteger = (value: unknown, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('VALIDATION_FAILED');
  return value as number;
};

const limits = (
  value: Partial<EnvironmentResourceLimits> | undefined,
  defaults: EnvironmentResourceLimits,
): EnvironmentResourceLimits => ({
  cpus: Math.min(32, finitePositive(value?.cpus, defaults.cpus)),
  memoryBytes: Math.min(64 * 1024 * 1024 * 1024, positiveInteger(value?.memoryBytes, defaults.memoryBytes)),
  pids: Math.min(32_768, positiveInteger(value?.pids, defaults.pids)),
  tmpfsBytes: Math.min(16 * 1024 * 1024 * 1024, positiveInteger(value?.tmpfsBytes, defaults.tmpfsBytes)),
});

export const resolveEnvironmentPacks = (
  catalog: EnvironmentCatalog,
  recipeId: string,
  versions: Record<string, string> = {},
): EnvironmentPackRef[] => {
  const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
  if (!recipe) throw new Error('ENVIRONMENT_RECIPE_NOT_FOUND');
  const unexpected = Object.keys(versions).filter((family) => !recipe.allowedFamilies.includes(family));
  if (unexpected.length) throw new Error('ENVIRONMENT_PACK_FORBIDDEN');
  const families = [...new Set([...recipe.defaultFamilies, ...Object.keys(versions)])].sort();
  return families.map((familyId) => {
    const family = catalog.packs.filter((pack) => pack.familyId === familyId && pack.status !== 'unavailable');
    const requested = versions[familyId];
    const pack = requested
      ? family.find((candidate) => candidate.versionId === requested)
      : (family.find((candidate) => candidate.enabled) ?? family.find((candidate) => candidate.installed) ?? family[0]);
    if (!pack) throw new Error('ENVIRONMENT_PACK_UNAVAILABLE');
    return { familyId: pack.familyId, versionId: pack.versionId, contentDigest: pack.contentDigest };
  });
};

export class EnvironmentService {
  constructor(
    private readonly controller: EnvironmentControllerPort,
    private readonly repository: EnvironmentRepositoryPort,
    private readonly pluginTargets: PluginRunnerTargetSourcePort,
    private readonly settings: AgentSettingsService,
    private readonly lifecycle: AppLifecycleService,
    private readonly capabilities: AppCapabilityBroker,
    private readonly cryptoHash: CryptoHashPort,
    private readonly now: () => number,
  ) {}

  availability(signal?: AbortSignal) {
    return this.controller.availability(signal);
  }

  async catalog(signal?: AbortSignal) {
    const availability = await this.controller.availability(signal);
    if (!availability.available) throw new Error('ENVIRONMENT_CONTROLLER_UNAVAILABLE');
    return this.controller.catalog(signal);
  }

  async storage(signal?: AbortSignal) {
    const availability = await this.controller.availability(signal);
    if (!availability.available) throw new Error('ENVIRONMENT_CONTROLLER_UNAVAILABLE');
    return this.controller.storage(signal);
  }

  listGroups(scope: Scope, runId?: string): Promise<EnvironmentGroupView[]> {
    return this.repository.listGroups(scope, runId);
  }

  async workspaceGrants(
    scope: Scope,
    environmentId: string,
    targetPluginId: string,
    signal?: AbortSignal,
  ): Promise<EnvironmentWorkspaceGrant[]> {
    const environment = await this.repository.getEnvironment(scope, environmentId);
    if (!environment || ['deleted', 'failed'].includes(environment.status)) throw new Error('NOT_FOUND');
    if (!environment.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
      throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    }
    return this.controller.workspaceGrants(environmentId, environment.generation, targetPluginId, signal);
  }

  async replaceWorkspaceGrants(
    scope: Scope,
    environmentId: string,
    targetPluginId: string,
    grants: readonly EnvironmentWorkspaceGrantInput[],
    signal?: AbortSignal,
  ): Promise<EnvironmentWorkspaceGrant[]> {
    await this.assertExecutionEnabled(scope);
    const environment = await this.repository.getEnvironment(scope, environmentId);
    if (!environment || ['deleted', 'failed'].includes(environment.status)) throw new Error('NOT_FOUND');
    const pluginIds = new Set(environment.runnerPlugins.map((target) => target.pluginId));
    if (!pluginIds.has(targetPluginId)) throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    if (grants.some((grant) => !pluginIds.has(grant.principalPluginId) || grant.principalPluginId === targetPluginId)) {
      throw new Error('WORKSPACE_GRANT_INVALID');
    }
    return this.controller.replaceWorkspaceGrants(
      environmentId,
      environment.generation,
      targetPluginId,
      grants,
      signal,
    );
  }

  async openWorkspaceFileRead(
    scope: Scope,
    environmentId: string,
    targetPluginId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<EnvironmentWorkspaceReadHandle> {
    const environment = await this.repository.getEnvironment(scope, environmentId);
    if (!environment || ['deleted', 'failed'].includes(environment.status)) throw new Error('NOT_FOUND');
    if (!environment.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
      throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    }
    return this.controller.openWorkspaceFileRead(environmentId, environment.generation, targetPluginId, path, signal);
  }

  async writeWorkspaceFileStream(
    scope: Scope,
    environmentId: string,
    targetPluginId: string,
    path: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const environment = await this.repository.getEnvironment(scope, environmentId);
    if (!environment || ['deleted', 'failed'].includes(environment.status)) throw new Error('NOT_FOUND');
    if (!environment.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
      throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    }
    await this.controller.writeWorkspaceFileStream(
      environmentId,
      environment.generation,
      targetPluginId,
      path,
      source,
      expectedBytes,
      signal,
    );
  }

  async getGroup(scope: Scope, groupId: string): Promise<EnvironmentGroupDetail> {
    const group = await this.repository.getGroup(scope, groupId);
    if (!group) throw new Error('NOT_FOUND');
    return group;
  }

  async createGroup(
    scope: Scope,
    runId: string,
    agentRuntimeId: string,
    specs: EnvironmentCreateSpec[],
    retained: boolean,
    idempotencyKey: string,
    expectedCatalogRevision?: string,
  ): Promise<EnvironmentGroupDetail> {
    if (!idempotencyKey || !Array.isArray(specs) || specs.length < 1 || specs.length > MAX_ENVIRONMENTS_PER_REQUEST) {
      throw new Error('VALIDATION_FAILED');
    }
    await this.assertExecutionEnabled(scope);
    const requestHash = hashOperation(
      {
        schemaVersion: 1,
        scope: { userId: scope.userId, appId: scope.appId },
        runId,
        agentRuntimeId,
        environments: JSON.parse(JSON.stringify(specs)) as JsonValue,
        retained,
        expectedCatalogRevision: expectedCatalogRevision ?? null,
      },
      this.cryptoHash,
    );
    const [availability, catalog, settings] = await Promise.all([
      this.controller.availability(),
      this.controller.catalog().catch(() => null),
      this.settings.get(scope.userId),
    ]);
    if (!availability.available || !catalog) throw new Error('ENVIRONMENT_CONTROLLER_UNAVAILABLE');
    if (expectedCatalogRevision && catalog.revision !== expectedCatalogRevision) {
      throw new Error('CATALOG_REVISION_CONFLICT');
    }
    if (specs.length > settings.effectiveSettings.environments.maxEnvironmentsPerGroup)
      throw new Error('ENVIRONMENT_LIMIT_EXCEEDED');
    const existing = await this.repository.listGroups(scope);
    if (
      existing.some(
        (group) =>
          group.runId === runId &&
          group.agentRuntimeId === agentRuntimeId &&
          !['deleted', 'failed'].includes(group.status),
      )
    ) {
      throw new Error('ENVIRONMENT_GROUP_EXISTS');
    }
    const active = existing.filter((group) => !['deleted', 'failed'].includes(group.status)).length;
    if (active >= settings.effectiveSettings.environments.maxActiveEnvironments)
      throw new Error('ENVIRONMENT_LIMIT_EXCEEDED');

    if (
      specs.some(
        (spec) =>
          (spec.runnerPluginIds?.length ?? 0) > 32 ||
          new Set(spec.runnerPluginIds ?? []).size !== (spec.runnerPluginIds?.length ?? 0),
      )
    ) {
      throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
    }
    const requestedRunnerPluginIds = [...new Set(specs.flatMap((spec) => spec.runnerPluginIds ?? []))];
    const resolvedRunnerPlugins = await this.pluginTargets.resolveRunnerTargets(scope.userId, requestedRunnerPluginIds);
    const now = this.now();
    const groupId = randomUUID();
    const frozen = specs.map((spec) => {
      const recipe = catalog.recipes.find((candidate) => candidate.id === spec.recipeId);
      if (!recipe) throw new Error('ENVIRONMENT_RECIPE_NOT_FOUND');
      return {
        id: randomUUID(),
        groupId,
        kind: recipe.kind,
        recipeId: recipe.id,
        recipeRevision: recipe.revision,
        runtimeDigest: catalog.runtimeDigest,
        catalogRevision: catalog.revision,
        packRefs: resolveEnvironmentPacks(catalog, recipe.id, spec.versions),
        generation: 1,
        limits: limits(spec.limits, recipe.defaultLimits),
        network: network(spec.network, recipe.networkDefaults),
        runnerPlugins: resolvedRunnerPlugins
          .filter((target) => (spec.runnerPluginIds ?? []).includes(target.pluginId))
          .map((target) => ({ ...target })),
        createdAt: now,
      };
    });
    if (
      frozen.some((environment) => environment.network.mode === 'allowlist') &&
      !availability.capabilities.egressAllowlist
    ) {
      throw new Error('ENVIRONMENT_NETWORK_ENFORCEMENT_UNAVAILABLE');
    }
    const group = await this.repository.createGroup(
      {
        scope,
        id: groupId,
        commandId: randomUUID(),
        idempotencyKey,
        requestHash,
        runId,
        agentRuntimeId,
        retained,
        limits: { environmentCount: frozen.length },
        createdAt: now,
      },
      frozen,
    );

    for (const env of group.environments) {
      const payload: JsonValue = {
        deploymentId: availability.deploymentId,
        userId: scope.userId,
        appId: scope.appId,
        runId,
        agentRuntimeId,
        groupId,
        environmentId: env.id,
        recipeId: env.recipeId,
        recipeRevision: env.recipeRevision,
        runtimeDigest: env.runtimeDigest,
        catalogRevision: env.catalogRevision,
        packs: env.packRefs.map((pack) => ({
          familyId: pack.familyId,
          versionId: pack.versionId,
          contentDigest: pack.contentDigest,
        })),
        runnerPlugins: env.runnerPlugins.map((target) => ({ ...target })),
        limits: {
          cpus: env.limits.cpus,
          memoryBytes: env.limits.memoryBytes,
          pids: env.limits.pids,
          tmpfsBytes: env.limits.tmpfsBytes,
        },
        network: { mode: env.network.mode, hosts: [...env.network.hosts] },
        retained: group.retained,
        idempotencyKey,
        expectedVersion: 1,
      };
      await this.dispatch(scope, 'provision', env.id, groupId, env.generation, payload);
    }
    return (await this.repository.getGroup(scope, groupId)) ?? group;
  }

  async action(
    scope: Scope,
    environmentId: string,
    action: 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize',
    expectedVersion: number,
    parameters: JsonValue,
  ): Promise<EnvironmentCommandView> {
    if (action !== 'stop' && action !== 'delete') await this.assertExecutionEnabled(scope);
    const [env, availability] = await Promise.all([
      this.repository.getEnvironment(scope, environmentId),
      this.controller.availability(),
    ]);
    if (!env) throw new Error('NOT_FOUND');
    if (!availability.available || !availability.deploymentId) throw new Error('ENVIRONMENT_CONTROLLER_UNAVAILABLE');
    if (env.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    if (
      (action === 'start' || action === 'restart') &&
      env.runnerPlugins.some((target) => Number(target.protocolVersion) !== PLUGIN_RUNNER_PROTOCOL_VERSION)
    ) {
      throw new Error('PLUGIN_RUNNER_PROTOCOL_VERSION_UNSUPPORTED');
    }
    const group = await this.repository.getGroup(scope, env.groupId);
    if (!group) throw new Error('NOT_FOUND');
    const payload: JsonValue = {
      deploymentId: availability.deploymentId,
      userId: scope.userId,
      appId: scope.appId,
      runId: group.runId,
      agentRuntimeId: group.agentRuntimeId,
      groupId: env.groupId,
      environmentId,
      recipeId: env.recipeId,
      recipeRevision: env.recipeRevision,
      runtimeDigest: env.runtimeDigest,
      catalogRevision: env.catalogRevision,
      packs: env.packRefs.map((pack) => ({
        familyId: pack.familyId,
        versionId: pack.versionId,
        contentDigest: pack.contentDigest,
      })),
      runnerPlugins: env.runnerPlugins.map((target) => ({ ...target })),
      limits: {
        cpus: env.limits.cpus,
        memoryBytes: env.limits.memoryBytes,
        pids: env.limits.pids,
        tmpfsBytes: env.limits.tmpfsBytes,
      },
      network: { mode: env.network.mode, hosts: [...env.network.hosts] },
      retained: group.retained,
      expectedVersion,
      parameters,
    };
    return this.dispatch(scope, action, environmentId, env.groupId, env.generation, payload);
  }

  async getCommand(scope: Scope, commandId: string): Promise<EnvironmentCommandView> {
    const local = await this.repository.getCommand(scope, commandId);
    if (!local) throw new Error('NOT_FOUND');
    if (!['pending', 'running'].includes(local.status)) return local;
    let remote;
    try {
      remote = await this.controller.query(commandId);
    } catch {
      return local;
    }
    const updated = await this.repository.completeCommand(scope, commandId, remote.status, remote.result, this.now());
    await this.syncEnvironmentStatus(scope, updated);
    return updated;
  }

  async adminAction(userId: number, action: string, payload: JsonValue): Promise<EnvironmentCommandView> {
    const availability = await this.controller.availability();
    if (!availability.available || !availability.deploymentId) throw new Error('ENVIRONMENT_CONTROLLER_UNAVAILABLE');
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return this.dispatch({ userId, appId: ADMIN_SCOPE.appId }, action, undefined, undefined, 1, {
      deploymentId: availability.deploymentId,
      userId,
      appId: ADMIN_SCOPE.appId,
      ...input,
    });
  }

  async reconcile(limit = 100): Promise<number> {
    const pending = await this.repository.listPendingCommands(limit);
    let completed = 0;
    for (const command of pending) {
      try {
        const remote = await this.controller.query(command.id);
        const scope = { userId: command.userId, appId: command.appId };
        const updated =
          remote.status !== command.status || JSON.stringify(remote.result) !== JSON.stringify(command.result)
            ? await this.repository.completeCommand(scope, command.id, remote.status, remote.result, this.now())
            : command;
        await this.syncEnvironmentStatus(scope, updated);
        if (['succeeded', 'failed', 'unknown'].includes(remote.status)) completed += 1;
      } catch {
        if (command.deadlineAt <= this.now()) {
          const scope = { userId: command.userId, appId: command.appId };
          const updated = await this.repository.completeCommand(
            scope,
            command.id,
            'unknown',
            { errorCode: 'ENVIRONMENT_RECONCILIATION_REQUIRED' },
            this.now(),
          );
          await this.syncEnvironmentStatus(scope, updated);
          completed += 1;
        }
      }
    }
    return completed;
  }

  private async dispatch(
    scope: Scope,
    action: string,
    environmentId: string | undefined,
    groupId: string | undefined,
    generation: number,
    payload: JsonValue,
  ): Promise<EnvironmentCommandView> {
    const now = this.now();
    const commandId = randomUUID();
    const operationHash = hashOperation(
      {
        schemaVersion: 1,
        scope: { userId: scope.userId, appId: scope.appId },
        action,
        generation,
        payload,
      },
      this.cryptoHash,
    );
    const deadlineAt = now + COMMAND_SECONDS;
    const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const wirePayload: JsonValue = { ...payloadRecord, issuedAt: now, nonce: randomUUID() };
    const command = await this.repository.createCommand({
      scope,
      id: commandId,
      environmentId,
      groupId,
      action,
      operationHash,
      generation,
      request: wirePayload,
      deadlineAt,
      createdAt: now,
    });
    if (command.id !== commandId) {
      if (!['pending', 'running'].includes(command.status)) {
        await this.syncEnvironmentStatus(scope, command);
        return command;
      }
      return this.getCommand(scope, command.id);
    }
    const request: RunnerCommandRequest = {
      commandId,
      operationHash,
      action,
      generation,
      deadlineAt,
      payload: wirePayload,
    };
    try {
      const remote = await this.controller.submit(request);
      const updated = await this.repository.completeCommand(scope, commandId, remote.status, remote.result, this.now());
      await this.syncEnvironmentStatus(scope, updated);
      return updated;
    } catch (error) {
      const updated = await this.repository.completeCommand(
        scope,
        command.id,
        'unknown',
        { errorCode: error instanceof Error ? error.message.slice(0, 200) : 'ENVIRONMENT_CONTROLLER_UNAVAILABLE' },
        this.now(),
      );
      await this.syncEnvironmentStatus(scope, updated);
      return updated;
    }
  }

  private async assertExecutionEnabled(scope: Scope): Promise<void> {
    const [settings, app, decision] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.capabilities.authorize(scope, 'environment.manage'),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState)) {
      throw new Error('AGENT_APP_DISABLED');
    }
    if (!decision.allowed) throw new Error(decision.code);
  }

  private async syncEnvironmentStatus(scope: Scope, command: EnvironmentCommandView): Promise<void> {
    if (!command.environmentId || !['succeeded', 'failed', 'unknown'].includes(command.status)) return;
    const environment = await this.repository.getEnvironment(scope, command.environmentId);
    if (!environment) return;
    let next = environment.status;
    if (command.status === 'succeeded') {
      next =
        command.action === 'provision'
          ? 'ready'
          : command.action === 'start' || command.action === 'restart'
            ? 'running'
            : command.action === 'stop'
              ? 'stopped'
              : command.action === 'delete'
                ? 'deleted'
                : environment.status;
    } else if (command.action === 'provision') {
      next = 'failed';
    }
    if (next !== environment.status) {
      await this.repository
        .setEnvironmentStatus(scope, environment.id, environment.version, next, this.now())
        .catch((error) => {
          if (!(error instanceof Error) || error.message !== 'STATE_CONFLICT') throw error;
        });
    }
    await this.repository.refreshGroupStatus(scope, environment.groupId, this.now()).catch(() => undefined);
  }
}
