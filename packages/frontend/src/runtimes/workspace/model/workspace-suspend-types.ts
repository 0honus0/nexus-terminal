import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';
import type { WorkspaceConnectionState } from './workspace-connection-types';

export interface WorkspaceSuspendedConnection extends WorkspaceConnectionState {
	suspendedSessionId: string;
	historyAvailable: boolean;
	ownershipGeneration: number;
	ownershipLeaseExpiresAt: number;
}

export interface WorkspaceSuspendResumeOptions {
	takeover?: boolean;
}

export interface WorkspaceSuspendLease {
	generation: number;
	expiresAt: number;
}

export class WorkspaceSuspendFailure extends Error {
	constructor(
		readonly code: WorkspaceErrorCode | 'protocol_failure',
		readonly outcome: 'not_dispatched' | 'confirmed' | 'unknown',
		options?: ErrorOptions,
	) {
		super(code, options);
		this.name = 'WorkspaceSuspendFailure';
	}
}
