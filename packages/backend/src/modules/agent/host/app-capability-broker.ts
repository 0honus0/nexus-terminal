import { logger } from '../../../shared/logging/logger';
import type { Scope } from '../agent.types';
import type { AppGrantRepositoryPort } from './app-grant.repository.port';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import { CapabilityRegistry } from './capability-registry';
import type { AgentCapability, CapabilityResource } from './capability.types';
import type { TargetDenylistRepositoryPort } from './target-denylist.repository.port';

const targetConnectionId = (resource: CapabilityResource): number | undefined => {
  if (resource.connectionId !== undefined) return resource.connectionId;
  if (resource.target?.target !== 'ssh' || !/^[1-9][0-9]*$/.test(resource.target.id)) return undefined;
  const id = Number(resource.target.id);
  return Number.isSafeInteger(id) ? id : undefined;
};

export type GrantDecision =
  | { allowed: true; policyRevision: number }
  | {
      allowed: false;
      code: 'APP_DISABLED' | 'APP_CAPABILITY_UNDECLARED' | 'APP_CAPABILITY_DENIED' | 'TARGET_DENIED';
      policyRevision: number;
    };

export class AppCapabilityBroker {
  constructor(
    private readonly apps: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly grants: AppGrantRepositoryPort,
    private readonly denylist: TargetDenylistRepositoryPort,
    private readonly capabilities: CapabilityRegistry,
  ) {}

  async authorize(
    scope: Scope,
    capability: AgentCapability | undefined,
    resource: CapabilityResource = {},
  ): Promise<GrantDecision> {
    return this.authorizeWhen(
      scope,
      capability,
      resource,
      (state) => state.desiredState === 'enabled' && ['running', 'degraded'].includes(state.observedState),
    );
  }

  async authorizeBackendStorage(scope: Scope): Promise<GrantDecision> {
    return this.authorizeWhen(
      scope,
      undefined,
      {},
      (state) =>
        (state.desiredState === 'enabled' && ['enabling', 'running', 'degraded'].includes(state.observedState)) ||
        (state.desiredState === 'disabled' && state.observedState === 'disabling'),
    );
  }

  private async authorizeWhen(
    scope: Scope,
    capability: AgentCapability | undefined,
    resource: CapabilityResource,
    stateAllowed: (state: NonNullable<Awaited<ReturnType<AppStateRepositoryPort['get']>>>) => boolean,
  ): Promise<GrantDecision> {
    const state = await this.states.get(scope);
    const policyRevision = state?.policyRevision ?? 0;

    if (!state || !stateAllowed(state)) {
      this.logDecision(scope, capability, resource, policyRevision, 'APP_DISABLED');
      return { allowed: false, code: 'APP_DISABLED', policyRevision };
    }

    if (capability !== undefined) {
      const definition = this.apps.get(scope.appId, state.activeVersion);
      if (!definition.manifest.capabilities.includes(capability)) {
        this.logDecision(scope, capability, resource, policyRevision, 'APP_CAPABILITY_UNDECLARED');
        return { allowed: false, code: 'APP_CAPABILITY_UNDECLARED', policyRevision };
      }
      const grant = (await this.grants.list(scope)).find((candidate) => candidate.capability === capability);
      if (!grant || !this.capabilities.allows(capability, grant.scope, resource.target)) {
        this.logDecision(scope, capability, resource, policyRevision, 'APP_CAPABILITY_DENIED');
        return { allowed: false, code: 'APP_CAPABILITY_DENIED', policyRevision };
      }
    }

    const connectionId = targetConnectionId(resource);
    if (connectionId !== undefined && (await this.denylist.isDenied(connectionId))) {
      this.logDecision(scope, capability, resource, policyRevision, 'TARGET_DENIED');
      return { allowed: false, code: 'TARGET_DENIED', policyRevision };
    }

    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        capability: capability ?? null,
        connectionId: connectionId ?? null,
        target: resource.target ?? null,
        policyRevision,
      },
      'Agent capability authorization allowed',
    );
    return { allowed: true, policyRevision };
  }

  private logDecision(
    scope: Scope,
    capability: AgentCapability | undefined,
    resource: CapabilityResource,
    policyRevision: number,
    decision: GrantDecision extends infer _T ? string : never,
  ): void {
    logger.warn(
      {
        userId: scope.userId,
        appId: scope.appId,
        capability: capability ?? null,
        connectionId: targetConnectionId(resource) ?? null,
        target: resource.target ?? null,
        policyRevision,
        decision,
      },
      'Agent capability authorization denied',
    );
  }
}
