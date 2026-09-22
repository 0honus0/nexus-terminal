export interface MarkedSuspendedSession {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  markedAt: string;
}

export type {
  SuspendedSessionDto as SuspendedSession,
  SuspendedSessionOwnershipStateDto as SuspendedSessionOwnershipState,
  SuspendedSessionStatusDto as SuspendedSessionStatus,
} from '@nexus-terminal/protocol/ssh-suspend';

export interface ResumeSuspendedSessionRequest {
  suspendedSessionId: string;
  workspaceId: string;
  takeover?: boolean;
}
