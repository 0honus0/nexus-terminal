export interface MarkedSuspendedSession {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  markedAt: string;
}

export type SuspendedSessionStatus = 'active' | 'disconnected';
export type SuspendedSessionOwnershipState = 'available' | 'resuming' | 'attached';

export interface SuspendedSession {
  id: string;
  originalWorkspaceId: string;
  connectionId: number;
  connectionName: string;
  suspendedAt: string;
  customName?: string;
  status: SuspendedSessionStatus;
  ownershipState: SuspendedSessionOwnershipState;
  ownershipGeneration: number;
  ownershipLeaseExpiresAt?: number;
  attachedWorkspaceId?: string;
  disconnectedAt?: string;
}

export interface ResumeSuspendedSessionRequest {
  suspendedSessionId: string;
  workspaceId: string;
  takeover?: boolean;
}
