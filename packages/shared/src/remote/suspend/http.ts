import type { SuspendedSessionStatus, SuspendedOwnershipState } from './values.js';

/** HTTP management projection and response types are independent of SSH owners. */
export interface SuspendedSessionView {
	id: string;
	originalWorkspaceId: string;
	connectionId: number;
	connectionName: string;
	suspendedAt: string;
	customName?: string;
	status: SuspendedSessionStatus;
	ownershipState: SuspendedOwnershipState;
	ownershipGeneration: number;
	ownershipLeaseExpiresAt?: number;
	attachedWorkspaceId?: string;
	disconnectedAt?: string;
}

export interface SuspendedSessionRenameRequest {
	customName: string;
}

export interface SuspendedSessionRenameResponse {
	message: 'Suspended session name updated.';
	customName: string;
}

export interface SuspendedSessionTerminatedResponse {
	message: 'Suspended session terminated and removed.';
}

export interface SuspendedSessionRemovedResponse {
	message: 'Disconnected suspended entry removed.';
}

export interface SuspendedSessionRemovalResponse {
	suspendedSessionId: string;
	disposition: import('./values.js').SuspendedRemovalDisposition;
}

export interface SuspendedSessionHttpError {
	code: import('./values.js').SuspendedHttpErrorCode;
}
