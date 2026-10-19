import type { SuspendedSessionView } from '@nexus-terminal/shared/remote/suspend/http';
import type { WorkspaceSuspendAutoTerminatedEvent } from '@nexus-terminal/shared/remote/suspend/workspace';
import type { SuspendedAutoTermination, SuspendedSession } from './suspended-session-types';

export function toSuspendedSession(value: SuspendedSessionView): SuspendedSession {
	return {
		id: value.id,
		originalWorkspaceId: value.originalWorkspaceId,
		connectionId: value.connectionId,
		connectionName: value.connectionName,
		suspendedAt: value.suspendedAt,
		customName: value.customName,
		status: value.status,
		ownershipState: value.ownershipState,
		ownershipGeneration: value.ownershipGeneration,
		ownershipLeaseExpiresAt: value.ownershipLeaseExpiresAt,
		attachedWorkspaceId: value.attachedWorkspaceId,
		disconnectedAt: value.disconnectedAt,
	};
}

export function toSuspendedAutoTermination(value: WorkspaceSuspendAutoTerminatedEvent): SuspendedAutoTermination {
	return { suspendedSessionId: value.suspendedSessionId, reason: value.reason };
}
