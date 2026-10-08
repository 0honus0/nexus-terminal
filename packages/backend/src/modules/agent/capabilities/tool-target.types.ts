export type AgentTargetKind = 'ssh';

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
  integrationId?: string;
  schemaHash?: string;
  browserSessionId?: string;
  snapshotId?: string;
  hostKeyTrust?: 'unavailable';
}

export interface CanonicalToolTargetFingerprint extends ToolTargetFingerprintBase, AgentTargetSelector {
  kind: AgentTargetKind;
}

export interface NonTargetToolTargetFingerprint extends ToolTargetFingerprintBase {
  kind: 'integration' | 'browser' | 'run';
}

export type ToolTargetFingerprint = CanonicalToolTargetFingerprint | NonTargetToolTargetFingerprint;
