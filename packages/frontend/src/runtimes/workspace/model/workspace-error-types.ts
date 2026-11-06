import type { HostKeyTrustRequest } from '@/features/connections/public';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';
import { WebSocketConnectionFailure } from '@/client/websocket';
import { WorkspaceSuspendFailure } from './workspace-suspend-types';

export type WorkspaceConnectionFailureCode = WorkspaceErrorCode | 'network' | 'timeout' | 'unexpected';

export function workspaceConnectionFailureCode(cause: unknown): WorkspaceConnectionFailureCode {
	if (cause instanceof WorkspaceRequestFailure) return cause.code;
	if (cause instanceof WorkspaceSuspendFailure) return cause.code === 'protocol_failure' ? 'unexpected' : cause.code;
	if (cause instanceof WorkspaceRequestTimeout) return 'timeout';
	if (cause instanceof WebSocketConnectionFailure) return 'network';
	if (cause instanceof WorkspaceDispatchFailure) return cause.code === 'not_connected' ? 'network' : cause.code;
	return 'unexpected';
}

/** A local rejection before the message is handed to WebSocket.send. */
export class WorkspaceDispatchFailure extends Error {
	constructor(readonly code: 'not_connected' | 'limit_exceeded') {
		super(code);
		this.name = 'WorkspaceDispatchFailure';
	}
}

/** No response arrived before the local deadline; this does not prove non-execution. */
export class WorkspaceRequestTimeout extends Error {
	constructor(readonly operation: string) {
		super(`Workspace request timed out: ${operation}`);
		this.name = 'WorkspaceRequestTimeout';
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
