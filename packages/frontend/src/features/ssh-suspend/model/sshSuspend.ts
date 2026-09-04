export interface MarkedSuspendedSession {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  markedAt: string;
}

export type SuspendedSessionStatus = 'active' | 'disconnected';

export interface SuspendedSession {
  id: string;
  originalWorkspaceId: string;
  connectionId: number;
  connectionName: string;
  suspendedAt: string;
  customName?: string;
  status: SuspendedSessionStatus;
  disconnectedAt?: string;
}

export interface ResumeSuspendedSessionRequest {
  suspendedSessionId: string;
  workspaceId: string;
}
