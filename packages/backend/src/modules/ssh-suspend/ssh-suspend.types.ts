import type { RemoteExecutionTransport, RemoteShellSession } from '../../platform/execution/remote-execution.port';
import type {
  SuspendedTerminalCheckpoint,
  SuspendedTerminalCheckpointSnapshot,
  SuspendedTerminalViewport,
} from './suspended-terminal-checkpoint.port';

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

export interface SuspendedTerminalCheckpointView extends SuspendedTerminalCheckpointSnapshot {
  rawLogOffset: number;
  revision: number;
  createdAt: number;
}

export interface SuspendTakeoverRequest {
  userId: number;
  originalSessionId: string;
  connectionName: string;
  connectionId: number;
  logIdentifier: string;
  transport: RemoteExecutionTransport;
  shell: RemoteShellSession;
  checkpoint?: SuspendedTerminalCheckpoint;
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
  checkpoint?: SuspendedTerminalCheckpoint;
  terminalCheckpoint?: SuspendedTerminalCheckpointView;
  viewport?: SuspendedTerminalViewport;
  shellPid?: number;
  shellKind?: ShellKind;
  shellIntegrationReady?: boolean;
  shellAtPrompt?: boolean;
}
