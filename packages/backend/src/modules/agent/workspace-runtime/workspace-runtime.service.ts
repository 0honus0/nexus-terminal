import { randomUUID } from 'node:crypto';
import { logger } from '../../../shared/logging/logger';
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
  ToolchainPackRef,
  WorkspaceProfileView,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeCommandView,
  WorkspaceToolchainSwitchView,
} from './workspace-runtime.types';

const COMMAND_SECONDS = 120;
const TOOLCHAIN_COMMAND_SECONDS = 12 * 60;
const COMMAND_POLL_MS = 250;
const ADMIN_SCOPE = { userId: 0, appId: 'nexus.host' } as const;

const selectedAcpProfiles = (
  ids: readonly string[] | undefined,
  profiles: readonly import('../agent-defaults').AgentAcpWorkspaceProfileSetting[],
  profileRevision: number,
): import('./workspace-runtime.types').WorkspaceAcpProfile[] => {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > 16) throw new Error('ACP_PROFILE_SELECTION_INVALID');
  return unique.map((id) => {
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error('ACP_PROFILE_NOT_FOUND');
    return { id: profile.id, profileRevision, argv: [...profile.argv], cwd: profile.cwd };
  });
};

const selectedBrowserTarget = (
  id: string | undefined,
  targets: readonly import('../agent-defaults').AgentBrowserTargetSetting[],
  profileRevision: number,
): import('./workspace-runtime.types').WorkspaceBrowserTarget | null => {
  if (!id) return null;
  const target = targets.find((candidate) => candidate.id === id);
  if (!target) throw new Error('BROWSER_TARGET_NOT_FOUND');
  return {
    id: target.id,
    profileRevision,
    endpoints: target.endpoints.map((endpoint) => ({ ...endpoint })),
    allowedUrlPatterns: [...target.allowedUrlPatterns],
  };
};

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

const assertSpecMatchesFrozenProfile = (spec: AgentWorkspaceCreateSpec | null, profile: WorkspaceProfileView): void => {
  if (!spec) return;
  if (spec.recipeId !== profile.recipeId) throw new Error('RUN_ENVIRONMENT_CONFLICT');
  const frozenVersions = Object.fromEntries(profile.toolchain.map((pack) => [pack.familyId, pack.versionId]));
  for (const [familyId, versionId] of Object.entries(spec.versions ?? {})) {
    if (frozenVersions[familyId] !== versionId) throw new Error('RUN_ENVIRONMENT_CONFLICT');
  }
  const sameIds = (requested: readonly string[] | undefined, frozen: readonly string[]): boolean => {
    if (requested === undefined) return true;
    return JSON.stringify([...requested].sort()) === JSON.stringify([...frozen].sort());
  };
  if (
    !sameIds(
      spec.runnerPluginIds,
      profile.runnerPlugins.map((target) => target.pluginId),
    )
  ) {
    throw new Error('RUN_ENVIRONMENT_CONFLICT');
  }
  if (
    !sameIds(
      spec.acpProfileIds,
      profile.acpProfiles.map((entry) => entry.id),
    )
  ) {
    throw new Error('RUN_ENVIRONMENT_CONFLICT');
  }
  if (spec.browserTargetId !== undefined && spec.browserTargetId !== profile.browserTarget?.id) {
    throw new Error('RUN_ENVIRONMENT_CONFLICT');
  }
};

export interface WorkspaceRuntimeLifecycleHooks {
  workspaceInvalidated?(workspaceId: string, generation: number): void;
}

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
    private readonly runtimeHooks: WorkspaceRuntimeLifecycleHooks = {},
  ) {}

  availability(signal?: AbortSignal) {
    return this.controller.availability(signal);
  }

  catalog(signal?: AbortSignal) {
    return this.controller.catalog(signal);
  }

  storage(signal?: AbortSignal) {
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

  async resolveRunEnvironment(
    scope: Scope,
    spec: AgentWorkspaceCreateSpec,
    expectedCatalogRevision?: string,
    expectedSettingsRevision?: number,
  ): Promise<WorkspaceProfileView> {
    if (!spec || typeof spec !== 'object') throw new Error('VALIDATION_FAILED');
    await this.assertExecutionEnabled(scope);
    const [catalog, settings] = await Promise.all([this.controller.catalog(), this.settings.get(scope.userId)]);
    if (expectedCatalogRevision && catalog.revision !== expectedCatalogRevision) {
      throw new Error('CATALOG_REVISION_CONFLICT');
    }
    if (expectedSettingsRevision !== undefined && settings.revision !== expectedSettingsRevision) {
      throw new Error('SETTINGS_REVISION_CONFLICT');
    }
    const workspaceSettings = settings.effectiveSettings.workspaceRuntime;
    if (!workspaceSettings.enabledRecipeIds.includes(spec.recipeId)) throw new Error('WORKSPACE_RECIPE_DISABLED');
    if (
      (spec.runnerPluginIds?.length ?? 0) > 32 ||
      new Set(spec.runnerPluginIds ?? []).size !== (spec.runnerPluginIds?.length ?? 0)
    ) {
      throw new Error('PLUGIN_RUNNER_TARGET_INVALID');
    }
    const recipe = catalog.recipes.find((candidate) => candidate.id === spec.recipeId);
    if (!recipe) throw new Error('WORKSPACE_RECIPE_NOT_FOUND');
    const configuredDefaults = Object.fromEntries(
      Object.entries(workspaceSettings.toolVersions)
        .filter(([familyId, value]) => recipe.allowedFamilies.includes(familyId) && Boolean(value.defaultVersionId))
        .map(([familyId, value]) => [familyId, value.defaultVersionId!]),
    );
    const versions = { ...configuredDefaults, ...(spec.versions ?? {}) };
    for (const [familyId, versionId] of Object.entries(versions)) {
      const configured = workspaceSettings.toolVersions[familyId];
      if (configured && !configured.enabledVersionIds.includes(versionId)) {
        throw new Error('WORKSPACE_TOOLCHAIN_VERSION_DISABLED');
      }
    }
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
      toolchain: resolveWorkspaceToolchain(catalog, recipe.id, versions),
      runnerPlugins: resolvedRunnerPlugins.map((target) => ({ ...target })),
      acpProfiles: selectedAcpProfiles(spec.acpProfileIds, workspaceSettings.acpProfiles, settings.revision),
      browserTarget: selectedBrowserTarget(
        spec.browserTargetId,
        settings.effectiveSettings.browser.targets,
        settings.revision,
      ),
    };
    if (profile.browserTarget && recipe.kind !== 'browser') throw new Error('BROWSER_TARGET_REQUIRES_BROWSER_RECIPE');
    return profile;
  }

  async createWorkspace(
    scope: Scope,
    runId: string,
    agentRuntimeId: string,
    spec: AgentWorkspaceCreateSpec | null,
    retained: boolean,
    idempotencyKey: string,
    expectedCatalogRevision?: string,
    frozenProfile?: WorkspaceProfileView,
  ): Promise<AgentWorkspaceView> {
    if (!idempotencyKey || (!frozenProfile && (!spec || typeof spec !== 'object')))
      throw new Error('VALIDATION_FAILED');
    await this.assertExecutionEnabled(scope);
    const requestHash = hashOperation(
      {
        schemaVersion: 2,
        scope: { userId: scope.userId, appId: scope.appId },
        runId,
        agentRuntimeId,
        workspace: JSON.parse(JSON.stringify(spec)) as JsonValue,
        frozenProfile: frozenProfile ? (JSON.parse(JSON.stringify(frozenProfile)) as JsonValue) : null,
        retained,
        expectedCatalogRevision: expectedCatalogRevision ?? null,
      },
      this.cryptoHash,
    );
    const settings = await this.settings.get(scope.userId);
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
    let profile: WorkspaceProfileView;
    if (frozenProfile) {
      if (expectedCatalogRevision && frozenProfile.catalogRevision !== expectedCatalogRevision) {
        throw new Error('CATALOG_REVISION_CONFLICT');
      }
      assertSpecMatchesFrozenProfile(spec, frozenProfile);
      profile = structuredClone(frozenProfile);
    } else {
      profile = await this.resolveRunEnvironment(scope, spec!, expectedCatalogRevision);
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
    const provision = await this.dispatch(
      scope,
      'provision',
      workspace.id,
      workspace.generation,
      this.runnerProvisionPayload(workspace),
    );
    if (provision.status === 'succeeded') {
      workspace = (await this.repository.getWorkspace(scope, workspace.id)) ?? workspace;
    }
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        agentRuntimeId,
        workspaceId: workspace.id,
        generation: workspace.generation,
        status: workspace.status,
        recipeId: workspace.profile.recipeId,
        retained: workspace.retained,
        provisionCommandId: provision.id,
        provisionStatus: provision.status,
      },
      'Agent Workspace created',
    );
    return workspace;
  }

  async action(
    scope: Scope,
    workspaceId: string,
    action: 'start' | 'stop' | 'restart' | 'delete',
    expectedVersion: number,
    waitForTerminal = false,
  ): Promise<WorkspaceRuntimeCommandView> {
    if (action !== 'stop' && action !== 'delete') await this.assertExecutionEnabled(scope);
    const workspace = await this.repository.getWorkspace(scope, workspaceId);
    if (!workspace) throw new Error('NOT_FOUND');
    if (workspace.version !== expectedVersion) throw new Error('STATE_CONFLICT');
    if (
      (action === 'start' || action === 'restart') &&
      workspace.profile.runnerPlugins.some(
        (target) => Number(target.protocolVersion) !== PLUGIN_RUNNER_PROTOCOL_VERSION,
      )
    ) {
      throw new Error('PLUGIN_RUNNER_PROTOCOL_VERSION_UNSUPPORTED');
    }
    const command = await this.dispatch(
      scope,
      action,
      workspaceId,
      workspace.generation,
      { workspaceId },
      true,
      waitForTerminal,
    );
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        workspaceId,
        generation: workspace.generation,
        action,
        commandId: command.id,
        commandStatus: command.status,
      },
      'Agent Workspace action dispatched',
    );
    return command;
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
    const [workspace, catalog] = await Promise.all([
      this.repository.getWorkspace(scope, workspaceId),
      this.controller.catalog(),
    ]);
    if (!workspace) throw new Error('NOT_FOUND');
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
      { workspaceId },
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
      this.runnerProvisionPayload(reconfigured),
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
      const started = await this.action(scope, workspaceId, 'start', ready.version, true);
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
    if (!['pending', 'running', 'unknown'].includes(local.status)) {
      await this.syncCommandProjection(scope, local);
      return local;
    }
    try {
      const remote = await this.controller.query(commandId);
      const updated = await this.repository.completeCommand(scope, commandId, remote.status, remote.result, this.now());
      await this.syncCommandProjection(scope, updated);
      return updated;
    } catch {
      return local;
    }
  }

  async adminAction(userId: number, action: string, payload: JsonValue): Promise<WorkspaceRuntimeCommandView> {
    const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    return this.dispatch({ userId, appId: ADMIN_SCOPE.appId }, action, undefined, 1, input);
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
        await this.syncCommandProjection(scope, updated);
        if (['succeeded', 'failed', 'unknown'].includes(remote.status)) completed += 1;
      } catch (cause) {
        logger.debug(
          { err: cause, commandId: command.id, action: command.action, workspaceId: command.workspaceId },
          'Agent Workspace reconciliation query failed',
        );
        if (command.deadlineAt <= this.now()) {
          const updated = await this.repository.completeCommand(
            scope,
            command.id,
            'unknown',
            { errorCode: 'WORKSPACE_RECONCILIATION_REQUIRED' },
            this.now(),
          );
          await this.syncCommandProjection(scope, updated);
          completed += 1;
        }
      }
    }
    if (pending.length > 0) {
      logger.debug(
        { pendingCommands: pending.length, completedCommands: completed, limit },
        'Agent Workspace reconciliation pass finished',
      );
    }
    return completed;
  }

  private runnerProvisionPayload(workspace: AgentWorkspaceView): Record<string, JsonValue> {
    return {
      workspaceId: workspace.id,
      recipeId: workspace.profile.recipeId,
      recipeRevision: workspace.profile.recipeRevision,
      runtimeDigest: workspace.profile.runtimeDigest,
      catalogRevision: workspace.profile.catalogRevision,
      toolchain: workspace.profile.toolchain.map((pack) => ({ ...pack })),
      runnerPlugins: workspace.profile.runnerPlugins.map((target) => ({ ...target })),
      acpProfiles: workspace.profile.acpProfiles.map((profile) => ({ ...profile, argv: [...profile.argv] })),
      browserTarget: workspace.profile.browserTarget
        ? {
            ...workspace.profile.browserTarget,
            endpoints: workspace.profile.browserTarget.endpoints.map((endpoint) => ({ ...endpoint })),
            allowedUrlPatterns: [...workspace.profile.browserTarget.allowedUrlPatterns],
          }
        : null,
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
    if (workspaceId && (action === 'stop' || action === 'restart' || action === 'delete')) {
      this.runtimeHooks.workspaceInvalidated?.(workspaceId, generation);
    }
    const now = this.now();
    const commandId = randomUUID();
    const operationHash = hashOperation(
      { schemaVersion: 2, scope: { userId: scope.userId, appId: scope.appId }, action, generation, payload },
      this.cryptoHash,
    );
    const deadlineAt =
      now + (action === 'provision' || action === 'packInstall' ? TOOLCHAIN_COMMAND_SECONDS : COMMAND_SECONDS);
    const wirePayload: JsonValue =
      payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
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
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        commandId: command.id,
        workspaceId: workspaceId ?? null,
        action,
        generation,
        deadlineAt,
        replayed: command.id !== commandId,
      },
      'Agent Workspace runtime command recorded',
    );
    if (command.id !== commandId) {
      if (!['pending', 'running'].includes(command.status)) {
        if (syncWorkspace) await this.syncCommandProjection(scope, command);
        return command;
      }
      if (syncWorkspace) return this.getCommand(scope, command.id);
      return command;
    }
    const request: RunnerCommandRequest = {
      commandId,
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
      if (syncWorkspace) await this.syncCommandProjection(scope, updated);
      logger.debug(
        {
          userId: scope.userId,
          appId: scope.appId,
          commandId,
          workspaceId: workspaceId ?? null,
          action,
          generation,
          commandStatus: updated.status,
        },
        'Agent Workspace runtime command completed',
      );
      return updated;
    } catch (error) {
      const updated = await this.repository.completeCommand(
        scope,
        command.id,
        'unknown',
        { errorCode: error instanceof Error ? error.message.slice(0, 200) : 'WORKSPACE_RUNTIME_UNAVAILABLE' },
        this.now(),
      );
      if (syncWorkspace) await this.syncCommandProjection(scope, updated);
      logger.warn(
        {
          err: error,
          userId: scope.userId,
          appId: scope.appId,
          commandId: command.id,
          workspaceId: workspaceId ?? null,
          action,
          generation,
        },
        'Agent Workspace runtime command became unknown',
      );
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

  private async syncCommandProjection(scope: Scope, command: WorkspaceRuntimeCommandView): Promise<void> {
    await this.syncWorkspaceStatus(scope, command);
    await this.syncRuntimeCleanupProjection(scope.userId, command);
  }

  private async syncRuntimeCleanupProjection(userId: number, command: WorkspaceRuntimeCommandView): Promise<void> {
    if (command.action !== 'runtimeCleanup' || command.status !== 'succeeded') return;
    if (!command.result || typeof command.result !== 'object' || Array.isArray(command.result)) return;
    const deleted = (command.result as Record<string, JsonValue>).deleted;
    if (!Array.isArray(deleted)) return;
    const deletedIds = [...new Set(deleted.filter((value): value is string => typeof value === 'string'))];
    if (!deletedIds.length) return;
    await this.repository.markRuntimeCleanupDeleted(userId, deletedIds, this.now());
    logger.info(
      { userId, commandId: command.id, deletedWorkspaceCount: deletedIds.length },
      'Agent Workspace runtime cleanup projection synchronized',
    );
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
