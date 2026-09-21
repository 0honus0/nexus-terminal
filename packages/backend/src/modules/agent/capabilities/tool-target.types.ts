export type AgentTargetKind = 'workspace' | 'ssh';

export interface AgentTargetSelector {
  target: AgentTargetKind;
  id: string;
}

interface ToolTargetFingerprintBase {
  targetIdentity: string;
  endpoint: string;
  loginUser: string;
  configurationHash: string;
  connectionId?: number;
  workspaceId?: string;
  integrationId?: string;
  schemaHash?: string;
  browserSessionId?: string;
  snapshotId?: string;
  generation?: number;
  hostKeyTrust?: 'unavailable';
}

export interface CanonicalToolTargetFingerprint extends ToolTargetFingerprintBase, AgentTargetSelector {
  kind: AgentTargetKind;
}

export interface NonTargetToolTargetFingerprint extends ToolTargetFingerprintBase {
  kind: 'integration' | 'browser' | 'run';
}

export type ToolTargetFingerprint = CanonicalToolTargetFingerprint | NonTargetToolTargetFingerprint;
