import type { Scope } from '../agent.types';
import type { CapabilityGrant } from './app.types';

export interface AppGrantRepositoryPort {
  list(scope: Scope): Promise<CapabilityGrant[]>;
  insertDefaults(scope: Scope, grants: readonly CapabilityGrant[]): Promise<void>;
  replace(scope: Scope, expectedPolicyRevision: number, grants: readonly CapabilityGrant[]): Promise<number>;
}
