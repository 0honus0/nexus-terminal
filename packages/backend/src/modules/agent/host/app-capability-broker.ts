import type { Scope } from '../agent.types';
import type { AppGrantRepositoryPort } from './app-grant.repository.port';
import { AppRegistryService } from './app-registry.service';
import type { AppStateRepositoryPort } from './app-state.repository.port';
import type { AgentCapability } from './app.types';
import type { TargetDenylistRepositoryPort } from './target-denylist.repository.port';

export interface CapabilityResource {
  connectionId?: number;
}

export type GrantDecision =
  | { allowed: true; policyRevision: number }
  | {
      allowed: false;
      code: 'APP_DISABLED' | 'APP_CAPABILITY_UNDECLARED' | 'APP_CAPABILITY_DENIED' | 'TARGET_DENIED';
      policyRevision: number;
    };

export class AppCapabilityBroker {
  constructor(
    private readonly registry: AppRegistryService,
    private readonly states: AppStateRepositoryPort,
    private readonly grants: AppGrantRepositoryPort,
    private readonly denylist: TargetDenylistRepositoryPort,
  ) {}

  async authorize(
    scope: Scope,
    capability: AgentCapability,
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
      'storage.app',
      {},
      (state) =>
        (state.desiredState === 'enabled' && ['enabling', 'running', 'degraded'].includes(state.observedState)) ||
        (state.desiredState === 'disabled' && state.observedState === 'disabling'),
    );
  }

  private async authorizeWhen(
    scope: Scope,
    capability: AgentCapability,
    resource: CapabilityResource,
    stateAllowed: (state: NonNullable<Awaited<ReturnType<AppStateRepositoryPort['get']>>>) => boolean,
  ): Promise<GrantDecision> {
    const state = await this.states.get(scope);
    const policyRevision = state?.policyRevision ?? 0;

    if (!state || !stateAllowed(state)) {
      return { allowed: false, code: 'APP_DISABLED', policyRevision };
    }
    const definition = this.registry.get(scope.appId, state.activeVersion);
    if (!definition.manifest.capabilities.includes(capability)) {
      return { allowed: false, code: 'APP_CAPABILITY_UNDECLARED', policyRevision };
    }

    const granted = (await this.grants.list(scope)).some((grant) => grant.capability === capability);
    if (!granted) return { allowed: false, code: 'APP_CAPABILITY_DENIED', policyRevision };

    if (resource.connectionId !== undefined && (await this.denylist.isDenied(resource.connectionId))) {
      return { allowed: false, code: 'TARGET_DENIED', policyRevision };
    }

    return { allowed: true, policyRevision };
  }
}
