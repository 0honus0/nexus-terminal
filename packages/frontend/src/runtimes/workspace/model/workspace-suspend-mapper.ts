import type {
	WorkspaceSuspendResumeResponse,
	WorkspaceSuspendOwnerRenewResponse,
} from '@nexus-terminal/shared/remote/suspend/workspace';
import type { WorkspaceSuspendedConnection, WorkspaceSuspendLease } from './workspace-suspend-types';

export function toSuspendedWorkspace(value: WorkspaceSuspendResumeResponse): WorkspaceSuspendedConnection {
	return {
		workspaceId: value.workspaceId,
		connectionId: value.connectionId,
		connectionName: value.connectionName,
		resumeToken: value.resumeToken,
		attachmentGeneration: value.attachmentGeneration,
		terminalOffset: value.terminalOffset,
		lastConnectedAt: value.lastConnectedAt === undefined ? undefined : value.lastConnectedAt * 1000,
		suspendedSessionId: value.resumedFrom,
		historyAvailable: value.historyAvailable,
		ownershipGeneration: value.ownershipGeneration,
		ownershipLeaseExpiresAt: value.ownershipLeaseExpiresAt,
	};
}

export function toSuspendedLease(value: WorkspaceSuspendOwnerRenewResponse): WorkspaceSuspendLease {
	return { generation: value.generation, expiresAt: value.leaseExpiresAt };
}
