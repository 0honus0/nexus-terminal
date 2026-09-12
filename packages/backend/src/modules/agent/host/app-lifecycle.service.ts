import type { ClockPort, Scope } from '../agent.types';
import type { AppGrantRepositoryPort } from './app-grant.repository.port';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AgentAppDefinition, AppRecord, AppStatePatch, AppView } from './app.types';

const QUIESCE_SECONDS = 10;

export class AppLifecycleService {
  constructor(
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly grants: AppGrantRepositoryPort,
    private readonly clock: ClockPort,
    private readonly onHostStateCommitted: (userId: number) => void = () => undefined,
  ) {}

  async initializeDefaults(userId: number): Promise<void> {
    for (const definition of this.registry.list()) await this.ensureDefault(userId, definition);
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

    if (enabled) return this.toView(await this.enable(definition, current));
    return this.toView(await this.disable(definition, current));
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
      await this.compareAndSetState(scope, current.version, { observedState, healthReason });
    }
  }

  async quiesce(appId: string, deadlineUnixSeconds: number): Promise<void> {
    const definition = this.registry.get(appId);
    await definition.quiesce?.(deadlineUnixSeconds);
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
      return this.compareAndSetState(starting, starting.version, {
        observedState: health.status === 'healthy' ? 'running' : health.status === 'degraded' ? 'degraded' : 'failed',
        healthReason: health.reason ?? null,
      });
    } catch (error) {
      const failed = await this.compareAndSetState(starting, starting.version, {
        observedState: 'failed',
        healthReason: error instanceof Error ? error.message : 'APP_INITIALIZATION_FAILED',
      });
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
      if (definition.quiesceForScope)
        await definition.quiesceForScope(scope, this.clock.nowUnixSeconds() + QUIESCE_SECONDS);
      else await definition.quiesce?.(this.clock.nowUnixSeconds() + QUIESCE_SECONDS);
      if (definition.disposeForScope) await definition.disposeForScope(scope);
      else await definition.dispose?.();
      return await this.compareAndSetState(stopping, stopping.version, {
        observedState: 'disabled',
        healthReason: null,
      });
    } catch (error) {
      return this.compareAndSetState(stopping, stopping.version, {
        observedState: 'disabling',
        healthReason: error instanceof Error ? error.message : 'APP_QUIESCE_FAILED',
      });
    }
  }

  private async compareAndSetState(scope: Scope, expectedVersion: number, patch: AppStatePatch): Promise<AppRecord> {
    const updated = await this.states.compareAndSet(scope, expectedVersion, patch);
    this.onHostStateCommitted(scope.userId);
    return updated;
  }

  private toView(record: AppRecord): AppView {
    const manifest = this.registry.get(record.appId, record.activeVersion).manifest;
    const surface: AppView['surface'] = this.registry.isBuiltin(record.appId)
      ? 'builtin'
      : manifest.targets?.frontend
        ? 'plugin'
        : manifest.agents?.length
          ? 'agent'
          : 'none';
    return { ...record, displayName: manifest.displayName, capabilities: [...manifest.capabilities], surface };
  }
}
