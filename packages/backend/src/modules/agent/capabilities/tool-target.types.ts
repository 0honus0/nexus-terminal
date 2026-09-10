export interface ToolTargetFingerprint {
  kind: 'machine' | 'environment' | 'integration' | 'browser' | 'run';
  targetIdentity: string;
  endpoint: string;
  loginUser: string;
  configurationHash: string;
  connectionId?: number;
  environmentId?: string;
  integrationId?: string;
  schemaHash?: string;
  browserSessionId?: string;
  snapshotId?: string;
  generation?: number;
  hostKeyTrust?: 'unavailable';
}
