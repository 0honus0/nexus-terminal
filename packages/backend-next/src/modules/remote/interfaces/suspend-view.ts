import type { SuspendedSessionView } from '@nexus-terminal/shared/remote/suspend/http';
import type { SuspendedWorkspaceView } from '../sessions/model/workspace-types.js';

/** Whitelist the transport-facing view. The internal suspension record,
 * resource lease and disk bookkeeping must never leak through HTTP or WS. */
export function suspendSessionView(value: SuspendedWorkspaceView): SuspendedSessionView {
	return {
		id: value.id,
		originalWorkspaceId: value.originalWorkspaceId,
		connectionId: value.connectionId,
		connectionName: value.connectionName,
		suspendedAt: value.suspendedAt,
		...(value.customName === undefined ? {} : { customName: value.customName }),
		status: value.status,
		ownershipState: value.ownershipState,
		ownershipGeneration: value.ownershipGeneration,
		...(value.ownershipLeaseExpiresAt === undefined
			? {}
			: { ownershipLeaseExpiresAt: value.ownershipLeaseExpiresAt }),
		...(value.attachedWorkspaceId === undefined ? {} : { attachedWorkspaceId: value.attachedWorkspaceId }),
		...(value.disconnectedAt === undefined ? {} : { disconnectedAt: value.disconnectedAt }),
	};
}
