import type { JsonValue, Scope } from '../agent.types';

export const AGENT_CAPABILITIES = [
  'ai.model.use',
  'runs.execute',
  'machine.diagnostics.read',
  'machine.files.read',
  'machine.files.write',
  'machine.shell.execute',
  'machine.docker.mutate',
  'environment.execute',
  'environment.manage',
  'integration.mcp.invoke',
  'integration.acp.execute',
  'browser.operate',
  'artifacts.read',
  'artifacts.write',
  'storage.app',
] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];

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

export interface CapabilityGrant {
  capability: AgentCapability;
  schemaVersion: number;
  scope: JsonValue;
  grantedAt: number;
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
