import type { RemoteExecutionTransport, RemoteShellSession } from '../../platform/execution/remote-execution.port';

export type SuspendedSessionStatus = 'hanging' | 'disconnected_by_backend';
export type ShellKind = 'bash' | 'zsh' | 'other';

export interface SuspendedSessionInfo {
  suspendSessionId: string;
  originalSessionId: string;
  connectionName: string;
  connectionId: string;
  suspendStartTime: string;
  customSuspendName?: string;
  backendSshStatus: SuspendedSessionStatus;
  disconnectionTimestamp?: string;
}

export interface SuspendTakeoverRequest {
  userId: number;
  originalSessionId: string;
  connectionName: string;
  connectionId: number;
  logIdentifier: string;
  transport: RemoteExecutionTransport;
  shell: RemoteShellSession;
  customSuspendName?: string;
  shellPid?: number;
  shellKind?: ShellKind;
  shellIntegrationReady?: boolean;
  shellAtPrompt?: boolean;
}

export interface PreparedResumeSession {
  transport: RemoteExecutionTransport;
  shell: RemoteShellSession;
  logIdentifier: string;
  connectionName: string;
  originalConnectionId: number;
  shellPid?: number;
  shellKind?: ShellKind;
  shellIntegrationReady?: boolean;
  shellAtPrompt?: boolean;
}
