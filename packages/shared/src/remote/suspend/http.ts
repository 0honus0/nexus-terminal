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
	message: string;
	customName: string;
}
