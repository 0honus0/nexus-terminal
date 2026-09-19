import type { RemoteExecutionTransport, RemoteShellSession } from '../../platform/execution/remote-execution.port';
import type {
  SuspendedTerminalCheckpoint,
  SuspendedTerminalCheckpointSnapshot,
  SuspendedTerminalViewport,
} from './suspended-terminal-checkpoint.port';

export type SuspendedSessionStatus = 'hanging' | 'disconnected_by_backend';
export type SuspendedSessionOwnershipState = 'available' | 'resuming' | 'attached';
export type SuspendedSessionOwnershipRevokeReason = 'takeover' | 'lease_expired';
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
  ownershipState: SuspendedSessionOwnershipState;
  ownershipGeneration: number;
  ownershipLeaseExpiresAt?: number;
  attachedWorkspaceId?: string;
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

export interface SuspendResumeOwnershipRequest {
  ownerId: string;
  takeover?: boolean;
}

export interface SuspendedSessionOwnershipRevoked {
  userId: number;
  suspendSessionId: string;
  ownerId: string;
  generation: number;
  reason: SuspendedSessionOwnershipRevokeReason;
}

export interface SuspendedSessionOwnershipToken {
  ownerId: string;
  generation: number;
  leaseExpiresAt: number;
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
  ownership: SuspendedSessionOwnershipToken;
}
