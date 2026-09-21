import type { Scope } from '../agent.types';
import type { AgentModelCapability } from '../ai/model.types';
import type { AgentCapability, CapabilityGrant } from './capability.types';

export { AGENT_CAPABILITIES } from './capability.types';
export type { AgentCapability, CapabilityGrant } from './capability.types';

export interface AgentAppIntent {
  id: string;
  schemaVersion: number;
}

export interface AgentAppTarget {
  entry: string;
}

export interface AgentAppTargets {
  frontend?: AgentAppTarget;
  backend?: AgentAppTarget;
  runner?: AgentAppTarget;
}

export interface AgentAppSurfacePreferences {
  defaultApprovalMode?: 'ask' | 'full_access';
}

export interface AgentAppAgentDefinition {
  id: string;
  version: string;
  displayName: string;
  description: string;
  requiredModelCapabilities: AgentModelCapability[];
}

export interface AgentAppManifest {
  schemaVersion: 1;
  id: string;
  version: string;
  displayName: string;
  sdkVersion: string;
  nexus: {
    minVersion: string;
    maxVersion: string;
  };
  capabilities: AgentCapability[];
  intents: AgentAppIntent[];
  agents?: AgentAppAgentDefinition[];
  agentSurface?: AgentAppSurfacePreferences;
  targets?: AgentAppTargets;
}

export interface ValidatedManifest extends AgentAppManifest {
  readonly validated: true;
}

export type AppDesiredState = 'enabled' | 'disabled';
export type AppObservedState = 'disabled' | 'enabling' | 'running' | 'degraded' | 'failed' | 'disabling';

export interface AppRecord extends Scope {
  activeVersion: string;
  desiredState: AppDesiredState;
  observedState: AppObservedState;
  healthReason: string | null;
  policyRevision: number;
  runningCount: number;
  approvalCount: number;
  budgetRequestCount: number;
  acceptNewRuns: boolean;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppView extends AppRecord {
  displayName: string;
  capabilities: AgentCapability[];
  surface: 'builtin' | 'agent' | 'custom' | 'none';
  defaultApprovalMode: 'ask' | 'full_access';
}

export interface AppStatePatch {
  activeVersion?: string;
  desiredState?: AppDesiredState;
  observedState?: AppObservedState;
  healthReason?: string | null;
  runningCount?: number;
  approvalCount?: number;
  budgetRequestCount?: number;
  acceptNewRuns?: boolean;
}

export interface AppHealth {
  status: 'healthy' | 'degraded' | 'failed';
  reason?: string;
}

export interface AgentAppDefinition {
  manifest: ValidatedManifest;
  defaultEnabled: boolean;
  defaultGrants: readonly Omit<CapabilityGrant, 'grantedAt'>[];
  initialize?(): Promise<void>;
  quiesce?(deadlineUnixSeconds: number): Promise<void>;
  dispose?(): Promise<void>;
  initializeForScope?(scope: Scope): Promise<void>;
  quiesceForScope?(scope: Scope, deadlineUnixSeconds: number): Promise<void>;
  disposeForScope?(scope: Scope): Promise<void>;
  availableForScope?(scope: Scope): Promise<boolean>;
  health?(scope: Scope): Promise<AppHealth>;
}

export interface AgentAppContributionFactory {
  rawManifest: unknown;
  create(manifest: ValidatedManifest): AgentAppDefinition;
}
