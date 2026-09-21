import type { ResolvedSshConnection } from '../../../platform/connection/ssh-connection';
import type { CanonicalToolTargetFingerprint } from './tool-target.types';
import type { ToolContext } from './tool.types';

export interface AgentConnectionView {
  id: number;
  name: string | null;
  type: string;
  host: string;
  port: number;
  username: string;
  updatedAt: number;
  configurationHash: string;
}

export interface AgentConnectionResolverPort {
  list(): Promise<AgentConnectionView[]>;
  get(connectionId: number): Promise<AgentConnectionView | null>;
  resolve(connectionId: number, expectedConfigurationHash?: string): Promise<ResolvedSshConnection>;
}

export interface SshTargetFingerprint extends CanonicalToolTargetFingerprint {
  kind: 'ssh';
  target: 'ssh';
  connectionId: number;
  hostKeyTrust: 'unavailable';
}

export interface SshTargetResolverPort {
  target(context: ToolContext, connectionId: number): Promise<SshTargetFingerprint>;
}
