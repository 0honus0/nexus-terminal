export interface ToolTargetFingerprint {
  kind: 'machine' | 'workspace' | 'integration' | 'browser' | 'run';
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
