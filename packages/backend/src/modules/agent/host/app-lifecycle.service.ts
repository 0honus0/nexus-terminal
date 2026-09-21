import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { ClockPort, Scope } from '../agent.types';
import type { AppGrantRepositoryPort } from './app-grant.repository.port';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AgentAppDefinition, AppRecord, AppStatePatch, AppView } from './app.types';

const QUIESCE_SECONDS = 10;

export class AppLifecycleService {
  private readonly initializationByUser = new Map<number, Promise<void>>();

  constructor(
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly grants: AppGrantRepositoryPort,
    private readonly clock: ClockPort,
    private readonly onHostStateCommitted: (userId: number) => void = () => undefined,
    private readonly quiesceHostExecution: (scope: Scope, deadlineUnixSeconds: number) => Promise<void> = async () =>
      undefined,
  ) {}

  initializeDefaults(userId: number): Promise<void> {
    const active = this.initializationByUser.get(userId);
    if (active) return active;

    const initialization = (async () => {
      for (const definition of this.registry.list()) await this.ensureDefault(userId, definition);
    })();
    let shared!: Promise<void>;
    shared = initialization.finally(() => {
      if (this.initializationByUser.get(userId) === shared) this.initializationByUser.delete(userId);
    });
    this.initializationByUser.set(userId, shared);
    return shared;
  }

  async list(userId: number): Promise<AppView[]> {
    await this.initializeDefaults(userId);
    const result: AppView[] = [];
    for (const record of await this.states.list(userId)) {
      if (!this.registry.has(record.appId, record.activeVersion)) continue;
      const definition = this.registry.get(record.appId, record.activeVersion);
      const scope = { userId, appId: record.appId };
      if (definition.availableForScope && !(await definition.availableForScope(scope))) continue;
      result.push(this.toView(record));
    }
    return result;
  }

  async get(scope: Scope): Promise<AppView> {
    await this.initializeDefaults(scope.userId);
    const record = await this.states.get(scope);
    if (!record || !this.registry.has(record.appId, record.activeVersion)) throw new Error('AGENT_APP_NOT_FOUND');
    const definition = this.registry.get(record.appId, record.activeVersion);
    if (definition.availableForScope && !(await definition.availableForScope(scope)))
      throw new Error('AGENT_APP_NOT_FOUND');
    return this.toView(record);
  }

  async setEnabled(scope: Scope, enabled: boolean, expectedVersion: number): Promise<AppView> {
    await this.initializeDefaults(scope.userId);
    const current = await this.states.get(scope);
    if (!current) throw new Error('AGENT_APP_NOT_FOUND');
    const definition = this.registry.get(scope.appId, current.activeVersion);
    if (current.version !== expectedVersion) throw new Error('APP_STATE_VERSION_CONFLICT');

    logger.debug(
      { userId: scope.userId, appId: scope.appId, enabled, expectedVersion },
      'Agent App lifecycle transition requested',
    );
    const next = enabled ? await this.enable(definition, current) : await this.disable(definition, current);
    return this.toView(next);
  }

  async refreshHealth(userId: number): Promise<void> {
    await this.initializeDefaults(userId);
    for (const current of await this.states.list(userId)) {
      if (current.desiredState !== 'enabled' || !['running', 'degraded', 'failed'].includes(current.observedState))
        continue;
      const scope = { userId, appId: current.appId };
      const definition = this.registry.get(current.appId, current.activeVersion);
      const health = (await definition.health?.(scope)) ?? { status: 'healthy' as const };
      const observedState =
        health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'failed';
      const healthReason = health.reason ?? null;
      if (current.observedState === observedState && current.healthReason === healthReason) continue;
      const updated = await this.compareAndSetState(scope, current.version, { observedState, healthReason });
      logger.info(
        {
          userId,
          appId: current.appId,
          previousObservedState: current.observedState,
          observedState: updated.observedState,
          version: updated.version,
        },
        'Agent App health state changed',
      );
    }
  }

  async quiesce(appId: string, deadlineUnixSeconds: number): Promise<void> {
    const definition = this.registry.get(appId);
    await definition.quiesce?.(deadlineUnixSeconds);
  }

  async quiesceScope(scope: Scope, deadlineUnixSeconds: number): Promise<void> {
    const current = await this.states.get(scope);
    if (!current) return;
    const definition = this.registry.get(scope.appId, current.activeVersion);
    await this.quiesceHostExecution(scope, deadlineUnixSeconds);
    if (current.observedState === 'disabled') return;
    if (definition.quiesceForScope) await definition.quiesceForScope(scope, deadlineUnixSeconds);
    else await definition.quiesce?.(deadlineUnixSeconds);
  }

  async resumeScope(scope: Scope): Promise<void> {
    const current = await this.states.get(scope);
    if (!current || current.desiredState !== 'enabled') return;
    const definition = this.registry.get(scope.appId, current.activeVersion);
    try {
      if (definition.initializeForScope) await definition.initializeForScope(scope);
      else await definition.initialize?.();
      const health = (await definition.health?.(scope)) ?? { status: 'healthy' as const };
      const observedState =
        health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'failed';
      const healthReason = health.reason ?? null;
      if (current.observedState !== observedState || current.healthReason !== healthReason) {
        await this.compareAndSetState(scope, current.version, { observedState, healthReason });
      }
    } catch (error) {
      const failed = await this.compareAndSetState(scope, current.version, {
        observedState: 'failed',
        healthReason: error instanceof Error ? error.message : 'APP_INITIALIZATION_FAILED',
      });
      logger.warn(
        {
          userId: scope.userId,
          appId: scope.appId,
          errorCode: logErrorCode(error, 'APP_INITIALIZATION_FAILED'),
          observedState: failed.observedState,
          version: failed.version,
        },
        'Agent App scope resume failed',
      );
      throw error;
    }
  }

  async dispose(): Promise<void> {
    for (const definition of this.registry.list()) await definition.dispose?.();
  }

  private async ensureDefault(userId: number, definition: AgentAppDefinition): Promise<void> {
    const scope = { userId, appId: definition.manifest.id };
    const now = this.clock.nowUnixSeconds();
    const inserted = await this.states.insertDefault({
      ...scope,
      activeVersion: definition.manifest.version,
      desiredState: definition.defaultEnabled ? 'enabled' : 'disabled',
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

    const current = await this.states.get(scope);
    if (!current) throw new Error(`Agent App state disappeared after initialization: ${scope.appId}`);

    // policyRevision=1 means the user has never replaced the default grants. Re-inserting with
    // INSERT OR IGNORE repairs a crash between the initial App row and default-grant writes
    // without ever restoring grants after an explicit user policy change (which increments revision).
    if (inserted || current.policyRevision === 1) {
      await this.grants.insertDefaults(
        scope,
        definition.defaultGrants.map((grant) => ({ ...grant, grantedAt: now })),
      );
    }

    if (current.desiredState === 'enabled' && !['running', 'degraded'].includes(current.observedState)) {
      await this.enable(definition, current);
    } else if (current.desiredState === 'disabled' && current.observedState !== 'disabled') {
      await this.disable(definition, current);
    }
  }

  private async enable(definition: AgentAppDefinition, current: AppRecord): Promise<AppRecord> {
    if (current.desiredState === 'enabled' && ['running', 'degraded'].includes(current.observedState)) return current;

    const starting = await this.compareAndSetState(current, current.version, {
      activeVersion: definition.manifest.version,
      desiredState: 'enabled',
      observedState: 'enabling',
      healthReason: null,
    });

    try {
      if (definition.initializeForScope)
        await definition.initializeForScope({ userId: starting.userId, appId: starting.appId });
      else await definition.initialize?.();
      const health = (await definition.health?.({ userId: starting.userId, appId: starting.appId })) ?? {
        status: 'healthy' as const,
      };
      const enabled = await this.compareAndSetState(starting, starting.version, {
        observedState: health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'failed',
        healthReason: health.reason ?? null,
      });
      logger.info(
        {
          userId: enabled.userId,
          appId: enabled.appId,
          observedState: enabled.observedState,
          version: enabled.version,
        },
        'Agent App enable completed',
      );
      return enabled;
    } catch (error) {
      const failed = await this.compareAndSetState(starting, starting.version, {
        observedState: 'failed',
        healthReason: error instanceof Error ? error.message : 'APP_INITIALIZATION_FAILED',
      });
      logger.warn(
        {
          userId: failed.userId,
          appId: failed.appId,
          errorCode: logErrorCode(error, 'APP_INITIALIZATION_FAILED'),
          observedState: failed.observedState,
          version: failed.version,
        },
        'Agent App enable failed',
      );
      return failed;
    }
  }

  private async disable(definition: AgentAppDefinition, current: AppRecord): Promise<AppRecord> {
    if (current.desiredState === 'disabled' && current.observedState === 'disabled') return current;

    const stopping = await this.compareAndSetState(current, current.version, {
      desiredState: 'disabled',
      observedState: 'disabling',
      healthReason: null,
    });

    try {
      const scope = { userId: stopping.userId, appId: stopping.appId };
      const deadline = this.clock.nowUnixSeconds() + QUIESCE_SECONDS;
      await this.quiesceHostExecution(scope, deadline);
      if (definition.quiesceForScope) await definition.quiesceForScope(scope, deadline);
      else await definition.quiesce?.(deadline);
      if (definition.disposeForScope) await definition.disposeForScope(scope);
      else await definition.dispose?.();
      const disabled = await this.compareAndSetState(stopping, stopping.version, {
        observedState: 'disabled',
        healthReason: null,
      });
      logger.info(
        {
          userId: disabled.userId,
          appId: disabled.appId,
          observedState: disabled.observedState,
          version: disabled.version,
        },
        'Agent App disable completed',
      );
      return disabled;
    } catch (error) {
      const degraded = await this.compareAndSetState(stopping, stopping.version, {
        observedState: 'disabling',
        healthReason: error instanceof Error ? error.message : 'APP_QUIESCE_FAILED',
      });
      logger.warn(
        {
          userId: degraded.userId,
          appId: degraded.appId,
          errorCode: logErrorCode(error, 'APP_QUIESCE_FAILED'),
          observedState: degraded.observedState,
          version: degraded.version,
        },
        'Agent App disable failed',
      );
      return degraded;
    }
  }

  private async compareAndSetState(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord> {
    try {
      const updated = await this.states.compareAndSet(scope, expectedVersion, patch);
      this.onHostStateCommitted(scope.userId);
      return updated;
    } catch (error) {
      logger.error(
        {
          userId: scope.userId,
          appId: scope.appId,
          expectedVersion,
          desiredState: patch.desiredState,
          observedState: patch.observedState,
          errorCode: logErrorCode(error, 'APP_STATE_COMMIT_FAILED'),
        },
        'Agent App state transition commit failed',
      );
      throw error;
    }
  }

  private toView(record: AppRecord): AppView {
    const manifest = this.registry.get(record.appId, record.activeVersion).manifest;
    const surface: AppView['surface'] = this.registry.isBuiltin(record.appId)
      ? 'builtin'
      : manifest.targets?.frontend
        ? 'custom'
        : manifest.agents?.length
          ? 'agent'
          : 'none';
    return {
      ...record,
      displayName: manifest.displayName,
      capabilities: [...manifest.capabilities],
      surface,
      defaultApprovalMode: manifest.agentSurface?.defaultApprovalMode ?? 'ask',
    };
  }
}
