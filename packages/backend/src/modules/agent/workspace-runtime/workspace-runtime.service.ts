import { randomUUID } from 'node:crypto';
import type { AgentSettingsService } from '../host/agent-settings.service';
import type { AppLifecycleService } from '../host/app-lifecycle.service';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import type { JsonValue, Scope } from '../agent.types';
import type { CryptoHashPort } from '../crypto-hash.port';
import { hashOperation } from '../operation-hash';
import type {
  AgentWorkspaceReadHandle,
  RunnerCommandRequest,
  RunnerCommandResult,
  WorkspaceRuntimeControllerPort,
} from './workspace-runtime-controller.port';
import { PLUGIN_RUNNER_PROTOCOL_VERSION, type PluginRunnerTargetSourcePort } from '../host/plugin-runner-target.port';
import type { AgentWorkspaceRepositoryPort } from './workspace-runtime.repository.port';
import type {
  AgentWorkspaceCreateSpec,
  AgentWorkspaceView,
  PluginWorkspaceGrantSet,
  PluginWorkspaceGrantInput,
  ToolchainPackRef,
  WorkspaceNetworkPolicy,
  WorkspaceProfileView,
  WorkspaceResourceLimits,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeCommandView,
  WorkspaceToolchainSwitchView,
} from './workspace-runtime.types';

const COMMAND_SECONDS = 120;
const TOOLCHAIN_COMMAND_SECONDS = 12 * 60;
const COMMAND_POLL_MS = 250;
const ADMIN_SCOPE = { userId: 0, appId: 'nexus.host' } as const;

const cleanHosts = (hosts: readonly string[]): string[] => {
  if (!Array.isArray(hosts) || hosts.length > 64) throw new Error('VALIDATION_FAILED');
  const normalized = [...new Set(hosts.map((host) => host.trim().toLowerCase()))];
  if (normalized.some((host) => !host || host.length > 253 || /[\s/@]/.test(host))) {
    throw new Error('VALIDATION_FAILED');
  }
  return normalized.sort();
};

const network = (
  value: WorkspaceNetworkPolicy | undefined,
  fallback: WorkspaceNetworkPolicy,
): WorkspaceNetworkPolicy => {
  const candidate = value ?? fallback;
  if (candidate.mode !== 'none' && candidate.mode !== 'allowlist') throw new Error('VALIDATION_FAILED');
  return { mode: candidate.mode, hosts: candidate.mode === 'none' ? [] : cleanHosts(candidate.hosts) };
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
  value: Partial<WorkspaceResourceLimits> | undefined,
  defaults: WorkspaceResourceLimits,
): WorkspaceResourceLimits => ({
  cpus: Math.min(32, finitePositive(value?.cpus, defaults.cpus)),
  memoryBytes: Math.min(64 * 1024 * 1024 * 1024, positiveInteger(value?.memoryBytes, defaults.memoryBytes)),
  pids: Math.min(32_768, positiveInteger(value?.pids, defaults.pids)),
  tmpfsBytes: Math.min(16 * 1024 * 1024 * 1024, positiveInteger(value?.tmpfsBytes, defaults.tmpfsBytes)),
});

export const resolveWorkspaceToolchain = (
  catalog: WorkspaceRuntimeCatalog,
  recipeId: string,
  versions: Record<string, string> = {},
): ToolchainPackRef[] => {
  const recipe = catalog.recipes.find((candidate) => candidate.id === recipeId);
  if (!recipe) throw new Error('WORKSPACE_RECIPE_NOT_FOUND');
  if (Object.keys(versions).some((family) => !recipe.allowedFamilies.includes(family))) {
    throw new Error('WORKSPACE_TOOLCHAIN_FORBIDDEN');
  }
  const families = [...new Set([...recipe.defaultFamilies, ...Object.keys(versions)])].sort();
  return families.map((familyId) => {
    const family = catalog.packs.filter((pack) => pack.familyId === familyId && pack.status !== 'unavailable');
    const requested = versions[familyId];
    const pack = requested
      ? family.find((candidate) => candidate.versionId === requested)
      : (family.find((candidate) => candidate.enabled) ?? family.find((candidate) => candidate.installed) ?? family[0]);
    if (!pack) throw new Error('WORKSPACE_TOOLCHAIN_UNAVAILABLE');
    return { familyId: pack.familyId, versionId: pack.versionId, contentDigest: pack.contentDigest };
  });
};

export class WorkspaceRuntimeService {
  constructor(
    private readonly controller: WorkspaceRuntimeControllerPort,
    private readonly repository: AgentWorkspaceRepositoryPort,
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
    if (!availability.available) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    return this.controller.catalog(signal);
  }

  async storage(signal?: AbortSignal) {
    const availability = await this.controller.availability(signal);
    if (!availability.available) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    return this.controller.storage(signal);
  }

  listWorkspaces(scope: Scope, runId?: string): Promise<AgentWorkspaceView[]> {
    return this.repository.listWorkspaces(scope, runId);
  }

  async getWorkspace(scope: Scope, workspaceId: string): Promise<AgentWorkspaceView> {
    const workspace = await this.repository.getWorkspace(scope, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    return workspace;
  }

  async workspaceGrants(
    scope: Scope,
    workspaceId: string,
    targetPluginId: string,
    signal?: AbortSignal,
  ): Promise<PluginWorkspaceGrantSet> {
    const workspace = await this.requireLiveWorkspace(scope, workspaceId);
    if (!workspace.profile.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
      throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    }
    return this.controller.workspaceGrants(workspaceId, workspace.generation, targetPluginId, signal);
  }

  async replaceWorkspaceGrants(
    scope: Scope,
    workspaceId: string,
    targetPluginId: string,
    grants: readonly PluginWorkspaceGrantInput[],
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<PluginWorkspaceGrantSet> {
    await this.assertExecutionEnabled(scope);
    const workspace = await this.requireLiveWorkspace(scope, workspaceId);
    const pluginIds = new Set(workspace.profile.runnerPlugins.map((target) => target.pluginId));
    if (!pluginIds.has(targetPluginId)) throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    if (grants.some((grant) => !pluginIds.has(grant.principalPluginId) || grant.principalPluginId === targetPluginId)) {
      throw new Error('WORKSPACE_GRANT_INVALID');
    }
    return this.controller.replaceWorkspaceGrants(
      workspaceId,
      workspace.generation,
      targetPluginId,
      grants,
      expectedRevision,
      signal,
    );
  }

  async openWorkspaceFileRead(
    scope: Scope,
    workspaceId: string,
    targetPluginId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<AgentWorkspaceReadHandle> {
    const workspace = await this.requireLiveWorkspace(scope, workspaceId);
    if (!workspace.profile.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
      throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    }
    return this.controller.openWorkspaceFileRead(workspaceId, workspace.generation, targetPluginId, path, signal);
  }

  async writeWorkspaceFileStream(
    scope: Scope,
    workspaceId: string,
    targetPluginId: string,
    path: string,
    source: AsyncIterable<Uint8Array>,
    expectedBytes: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const workspace = await this.requireLiveWorkspace(scope, workspaceId);
    if (!workspace.profile.runnerPlugins.some((target) => target.pluginId === targetPluginId)) {
      throw new Error('WORKSPACE_TARGET_NOT_FOUND');
    }
    await this.controller.writeWorkspaceFileStream(
      workspaceId,
      workspace.generation,
      targetPluginId,
      path,
      source,
      expectedBytes,
      signal,
    );
  }

  async createWorkspace(
    scope: Scope,
    runId: string,
    agentRuntimeId: string,
    spec: AgentWorkspaceCreateSpec,
    retained: boolean,
    idempotencyKey: string,
    expectedCatalogRevision?: string,
  ): Promise<AgentWorkspaceView> {
    if (!idempotencyKey || !spec || typeof spec !== 'object') throw new Error('VALIDATION_FAILED');
    await this.assertExecutionEnabled(scope);
    const requestHash = hashOperation(
      {
        schemaVersion: 2,
        scope: { userId: scope.userId, appId: scope.appId },
        runId,
        agentRuntimeId,
        workspace: JSON.parse(JSON.stringify(spec)) as JsonValue,
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
    if (!availability.available || !availability.deploymentId || !catalog)
      throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    if (expectedCatalogRevision && catalog.revision !== expectedCatalogRevision) {
      throw new Error('CATALOG_REVISION_CONFLICT');
    }
    const existing = await this.repository.listWorkspaces(scope);
    if (
      existing.some(
        (workspace) =>
          workspace.runId === runId &&
          workspace.agentRuntimeId === agentRuntimeId &&
          !['deleted', 'failed'].includes(workspace.status),
      )
    ) {
      throw new Error('WORKSPACE_EXISTS');
    }
    const workspaceSettings = settings.effectiveSettings.workspaceRuntime;
    const active = existing.filter((workspace) => !['deleted', 'failed'].includes(workspace.status)).length;
    if (active >= workspaceSettings.maxActiveWorkspaces) throw new Error('WORKSPACE_LIMIT_EXCEEDED');
    if (
      (spec.runnerPluginIds?.length ?? 0) > 32 ||
      new Set(spec.runnerPluginIds ?? []).size !== (spec.runnerPluginIds?.length ?? 0)
    ) {
      throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
    }
    const recipe = catalog.recipes.find((candidate) => candidate.id === spec.recipeId);
    if (!recipe) throw new Error('WORKSPACE_RECIPE_NOT_FOUND');
    const resolvedRunnerPlugins = await this.pluginTargets.resolveRunnerTargets(
      scope.userId,
      spec.runnerPluginIds ?? [],
    );
    const profile: WorkspaceProfileView = {
      kind: recipe.kind,
      recipeId: recipe.id,
      recipeRevision: recipe.revision,
      runtimeDigest: catalog.runtimeDigest,
      catalogRevision: catalog.revision,
      toolchain: resolveWorkspaceToolchain(catalog, recipe.id, spec.versions),
      runnerPlugins: resolvedRunnerPlugins.map((target) => ({ ...target })),
      limits: limits(spec.limits, recipe.defaultLimits),
      network: network(spec.network, recipe.networkDefaults),
    };
    if (profile.network.mode === 'allowlist' && !availability.capabilities.egressAllowlist) {
      throw new Error('WORKSPACE_NETWORK_ENFORCEMENT_UNAVAILABLE');
    }
    const now = this.now();
    const workspaceId = randomUUID();
    let workspace = await this.repository.createWorkspace({
      scope,
      id: workspaceId,
      commandId: randomUUID(),
      idempotencyKey,
      requestHash,
      runId,
      agentRuntimeId,
      retained,
      profile,
      generation: 1,
      createdAt: now,
    });
    const provision = await this.dispatch(scope, 'provision', workspace.id, workspace.generation, {
      ...this.runnerPayload(workspace, availability.deploymentId),
      expectedVersion: workspace.version,
      idempotencyKey,
    });
    if (provision.status === 'succeeded') {
      workspace = (await this.repository.getWorkspace(scope, workspace.id)) ?? workspace;
    }
    return workspace;
  }

  async action(
    scope: Scope,
    workspaceId: string,
    action: 'start' | 'stop' | 'restart' | 'delete' | 'setNetwork' | 'resize',
    expectedVersion: number,
    parameters: JsonValue,
    waitForTerminal = false,
  ): Promise<WorkspaceRuntimeCommandView> {
    if (action !== 'stop' && action !== 'delete') await this.assertExecutionEnabled(scope);
    const [workspace, availability] = await Promise.all([
      this.repository.getWorkspace(scope, workspaceId),
      this.controller.availability(),
    ]);
    if (!workspace) throw new Error('NOT_FOUND');
    if (!availability.available || !availability.deploymentId) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    if (workspace.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    if (
      (action === 'start' || action === 'restart') &&
      workspace.profile.runnerPlugins.some(
        (target) => Number(target.protocolVersion) !== PLUGIN_RUNNER_PROTOCOL_VERSION,
      )
    ) {
      throw new Error('PLUGIN_RUNNER_PROTOCOL_VERSION_UNSUPPORTED');
    }
    return this.dispatch(
      scope,
      action,
      workspaceId,
      workspace.generation,
      {
        ...this.runnerPayload(workspace, availability.deploymentId),
        expectedVersion,
        parameters,
      },
      true,
      waitForTerminal,
    );
  }

  async switchToolVersions(
    scope: Scope,
    workspaceId: string,
    versions: Record<string, string>,
    expectedVersion: number,
    expectedCatalogRevision?: string,
  ): Promise<WorkspaceToolchainSwitchView> {
    const requested =
      versions && typeof versions === 'object' && !Array.isArray(versions) ? Object.entries(versions) : [];
    if (
      requested.length < 1 ||
      requested.length > 32 ||
      requested.some(
        ([familyId, versionId]) => !familyId || familyId.length > 128 || !versionId || versionId.length > 128,
      )
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    await this.assertExecutionEnabled(scope);
    const [workspace, availability, catalog] = await Promise.all([
      this.repository.getWorkspace(scope, workspaceId),
      this.controller.availability(),
      this.controller.catalog().catch(() => null),
    ]);
    if (!workspace) throw new Error('NOT_FOUND');
    if (!availability.available || !availability.deploymentId || !catalog)
      throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    if (expectedCatalogRevision && catalog.revision !== expectedCatalogRevision) {
      throw new Error('CATALOG_REVISION_CONFLICT');
    }
    if (workspace.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    if (!['ready', 'running', 'stopped'].includes(workspace.status)) throw new Error('WORKSPACE_STATE_INVALID');
    const recipe = catalog.recipes.find((candidate) => candidate.id === workspace.profile.recipeId);
    if (!recipe) throw new Error('WORKSPACE_RECIPE_NOT_FOUND');
    const currentVersions = Object.fromEntries(
      workspace.profile.toolchain.map((pack) => [pack.familyId, pack.versionId]),
    ) as Record<string, string>;
    const nextToolchain = resolveWorkspaceToolchain(catalog, recipe.id, { ...currentVersions, ...versions });
    if (JSON.stringify(nextToolchain) === JSON.stringify(workspace.profile.toolchain)) {
      throw new Error('WORKSPACE_TOOLCHAIN_NO_CHANGE');
    }

    const wasRunning = workspace.status === 'running';
    const commands: WorkspaceRuntimeCommandView[] = [];
    // Reserve this Workspace before deleting the old generation. This prevents a concurrent
    // lifecycle/create request from observing a transiently deleted stable Workspace.
    const switching = await this.repository.setWorkspaceStatus(
      scope,
      workspaceId,
      expectedVersion,
      'stopping',
      this.now(),
    );
    const deleted = await this.dispatch(
      scope,
      'delete',
      workspaceId,
      workspace.generation,
      {
        ...this.runnerPayload(workspace, availability.deploymentId),
        expectedVersion: switching.version,
        parameters: { reason: 'workspace-toolchain-switch' },
      },
      false,
      true,
    );
    commands.push(deleted);
    if (deleted.status !== 'succeeded') {
      if (deleted.status === 'failed') {
        await this.repository
          .setWorkspaceStatus(scope, workspaceId, switching.version, workspace.status, this.now())
          .catch(() => undefined);
      }
      const current = (await this.repository.getWorkspace(scope, workspaceId)) ?? switching;
      return { outcome: deleted.status === 'failed' ? 'failed' : 'unknown', workspace: current, commands };
    }

    const generation = workspace.generation + 1;
    let reconfigured: AgentWorkspaceView;
    try {
      reconfigured = await this.repository.reconfigureWorkspace({
        scope,
        workspaceId,
        expectedVersion: switching.version,
        expectedGeneration: workspace.generation,
        recipeRevision: recipe.revision,
        runtimeDigest: catalog.runtimeDigest,
        catalogRevision: catalog.revision,
        toolchain: nextToolchain,
        generation,
        now: this.now(),
      });
    } catch (error) {
      await this.repository
        .setWorkspaceStatus(scope, workspaceId, switching.version, 'failed', this.now())
        .catch(() => undefined);
      throw error;
    }
    const provision = await this.dispatch(
      scope,
      'provision',
      workspaceId,
      generation,
      {
        ...this.runnerPayload(reconfigured, availability.deploymentId),
        expectedVersion: reconfigured.version,
        parameters: { reason: 'workspace-toolchain-switch' },
      },
      true,
      true,
    );
    commands.push(provision);
    if (provision.status !== 'succeeded') {
      const current = (await this.repository.getWorkspace(scope, workspaceId)) ?? reconfigured;
      return { outcome: provision.status === 'failed' ? 'failed' : 'unknown', workspace: current, commands };
    }

    if (wasRunning) {
      const ready = await this.repository.getWorkspace(scope, workspaceId);
      if (!ready || ready.status !== 'ready') throw new Error('WORKSPACE_STATE_INVALID');
      const started = await this.action(
        scope,
        workspaceId,
        'start',
        ready.version,
        { reason: 'workspace-toolchain-switch' },
        true,
      );
      commands.push(started);
      if (started.status !== 'succeeded') {
        const current = (await this.repository.getWorkspace(scope, workspaceId)) ?? ready;
        return { outcome: started.status === 'failed' ? 'failed' : 'unknown', workspace: current, commands };
      }
    }

    const current = await this.repository.getWorkspace(scope, workspaceId);
    if (!current) throw new Error('NOT_FOUND');
    return { outcome: 'succeeded', workspace: current, commands };
  }

  async getCommand(scope: Scope, commandId: string): Promise<WorkspaceRuntimeCommandView> {
    const local = await this.repository.getCommand(scope, commandId);
    if (!local) throw new Error('NOT_FOUND');
    if (!['pending', 'running'].includes(local.status)) return local;
    try {
      const remote = await this.controller.query(commandId);
      const updated = await this.repository.completeCommand(scope, commandId, remote.status, remote.result, this.now());
      await this.syncWorkspaceStatus(scope, updated);
      return updated;
    } catch {
      return local;
    }
  }

  async adminAction(userId: number, action: string, payload: JsonValue): Promise<WorkspaceRuntimeCommandView> {
    const availability = await this.controller.availability();
    if (!availability.available || !availability.deploymentId) throw new Error('WORKSPACE_RUNTIME_UNAVAILABLE');
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return this.dispatch({ userId, appId: ADMIN_SCOPE.appId }, action, undefined, 1, {
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
      const scope = { userId: command.userId, appId: command.appId };
      try {
        const remote = await this.controller.query(command.id);
        const updated =
          remote.status !== command.status || JSON.stringify(remote.result) !== JSON.stringify(command.result)
            ? await this.repository.completeCommand(scope, command.id, remote.status, remote.result, this.now())
            : command;
        await this.syncWorkspaceStatus(scope, updated);
        if (['succeeded', 'failed', 'unknown'].includes(remote.status)) completed += 1;
      } catch {
        if (command.deadlineAt <= this.now()) {
          const updated = await this.repository.completeCommand(
            scope,
            command.id,
            'unknown',
            { errorCode: 'WORKSPACE_RECONCILIATION_REQUIRED' },
            this.now(),
          );
          await this.syncWorkspaceStatus(scope, updated);
          completed += 1;
        }
      }
    }
    return completed;
  }

  private runnerPayload(workspace: AgentWorkspaceView, deploymentId: string): Record<string, JsonValue> {
    return {
      deploymentId,
      userId: workspace.userId,
      appId: workspace.appId,
      runId: workspace.runId,
      agentRuntimeId: workspace.agentRuntimeId,
      workspaceId: workspace.id,
      recipeId: workspace.profile.recipeId,
      recipeRevision: workspace.profile.recipeRevision,
      runtimeDigest: workspace.profile.runtimeDigest,
      catalogRevision: workspace.profile.catalogRevision,
      toolchain: workspace.profile.toolchain.map((pack) => ({ ...pack })),
      runnerPlugins: workspace.profile.runnerPlugins.map((target) => ({ ...target })),
      limits: { ...workspace.profile.limits },
      network: { mode: workspace.profile.network.mode, hosts: [...workspace.profile.network.hosts] },
      retained: workspace.retained,
    };
  }

  private async dispatch(
    scope: Scope,
    action: string,
    workspaceId: string | undefined,
    generation: number,
    payload: JsonValue,
    syncWorkspace = true,
    waitForTerminal = false,
  ): Promise<WorkspaceRuntimeCommandView> {
    const now = this.now();
    const commandId = randomUUID();
    const operationHash = hashOperation(
      { schemaVersion: 2, scope: { userId: scope.userId, appId: scope.appId }, action, generation, payload },
      this.cryptoHash,
    );
    const deadlineAt =
      now + (action === 'provision' || action === 'packInstall' ? TOOLCHAIN_COMMAND_SECONDS : COMMAND_SECONDS);
    const payloadRecord = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const wirePayload: JsonValue = { ...payloadRecord, issuedAt: now, nonce: randomUUID() };
    const command = await this.repository.createCommand({
      scope,
      id: commandId,
      workspaceId,
      action,
      operationHash,
      generation,
      request: wirePayload,
      deadlineAt,
      createdAt: now,
    });
    if (command.id !== commandId) {
      if (!['pending', 'running'].includes(command.status)) {
        if (syncWorkspace) await this.syncWorkspaceStatus(scope, command);
        return command;
      }
      if (syncWorkspace) return this.getCommand(scope, command.id);
      return command;
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
      let remote = await this.controller.submit(request);
      if (waitForTerminal && ['pending', 'running'].includes(remote.status)) {
        remote = await this.awaitRemoteCommand(commandId, deadlineAt);
      }
      const updated = await this.repository.completeCommand(scope, commandId, remote.status, remote.result, this.now());
      if (syncWorkspace) await this.syncWorkspaceStatus(scope, updated);
      return updated;
    } catch (error) {
      const updated = await this.repository.completeCommand(
        scope,
        command.id,
        'unknown',
        { errorCode: error instanceof Error ? error.message.slice(0, 200) : 'WORKSPACE_RUNTIME_UNAVAILABLE' },
        this.now(),
      );
      if (syncWorkspace) await this.syncWorkspaceStatus(scope, updated);
      return updated;
    }
  }

  private async awaitRemoteCommand(commandId: string, deadlineAt: number): Promise<RunnerCommandResult> {
    let last: RunnerCommandResult | null = null;
    while (this.now() <= deadlineAt) {
      last = await this.controller.query(commandId);
      if (!['pending', 'running'].includes(last.status)) return last;
      await new Promise<void>((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
    }
    return {
      commandId,
      status: 'unknown',
      result: { errorCode: 'WORKSPACE_COMMAND_DEADLINE_EXCEEDED' },
    };
  }

  private async assertExecutionEnabled(scope: Scope): Promise<void> {
    const [settings, app, decision] = await Promise.all([
      this.settings.get(scope.userId),
      this.lifecycle.get(scope),
      this.capabilities.authorize(scope, 'workspace.runtime.manage'),
    ]);
    if (!settings.effectiveSettings.feature.enabled) throw new Error('AGENT_DISABLED');
    if (app.desiredState !== 'enabled' || !['running', 'degraded'].includes(app.observedState)) {
      throw new Error('AGENT_APP_DISABLED');
    }
    if (!decision.allowed) throw new Error(decision.code);
  }

  private async requireLiveWorkspace(scope: Scope, workspaceId: string): Promise<AgentWorkspaceView> {
    const workspace = await this.repository.getWorkspace(scope, workspaceId);
    if (!workspace || ['deleted', 'failed'].includes(workspace.status)) throw new Error('NOT_FOUND');
    return workspace;
  }

  private async syncWorkspaceStatus(scope: Scope, command: WorkspaceRuntimeCommandView): Promise<void> {
    if (!command.workspaceId || !['succeeded', 'failed', 'unknown'].includes(command.status)) return;
    const workspace = await this.repository.getWorkspace(scope, command.workspaceId);
    if (!workspace || workspace.generation !== command.generation) return;
    let next = workspace.status;
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
                : workspace.status;
    } else if (command.action === 'provision') {
      next = 'failed';
    }
    if (next === workspace.status) return;
    await this.repository
      .setWorkspaceStatus(scope, workspace.id, workspace.version, next, this.now())
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== 'STATE_CONFLICT') throw error;
      });
  }
}
