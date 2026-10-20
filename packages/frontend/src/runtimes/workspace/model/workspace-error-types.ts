import type { HostKeyTrustRequest } from '@/features/connections/public';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';

/** A local rejection before the message is handed to WebSocket.send. */
export class WorkspaceDispatchFailure extends Error {
	constructor(readonly code: 'not_connected' | 'limit_exceeded') {
		super(code);
		this.name = 'WorkspaceDispatchFailure';
	}
}

export class WorkspaceRequestFailure extends Error {
	constructor(
		readonly operation: string,
		readonly code: WorkspaceErrorCode,
		readonly hostKey?: HostKeyTrustRequest,
	) {
		super(code);
		this.name = 'WorkspaceRequestFailure';
	}
}
