import { readWorkspaceSuspendMark } from '@nexus-terminal/shared/remote/suspend/workspace-codec';
import { readWorkspaceSuspendMarkResponse } from '@nexus-terminal/shared/remote/suspend/workspace-result-codec';
import { readWorkspaceEmptyResponse } from '@nexus-terminal/shared/remote/workspace/workspace-codec';
import type { SshSuspendChannel } from '@/features/ssh-suspend/public';
import type { WorkspaceSocket } from '../protocol/workspaceSocket';
import { WorkspaceDispatchFailure, WorkspaceRequestFailure } from '../model/workspace-error-types';
import { WorkspaceSuspendFailure } from '../model/workspace-suspend-types';

function failure(cause: unknown): WorkspaceSuspendFailure {
	if (cause instanceof WorkspaceSuspendFailure) {
		return cause;
	}
	if (cause instanceof WorkspaceDispatchFailure) {
		return new WorkspaceSuspendFailure(
			cause.code === 'not_connected' ? 'remote_unavailable' : cause.code,
			'not_dispatched',
			{ cause },
		);
	}
	if (cause instanceof WorkspaceRequestFailure) {
		const unknown = cause.code === 'operation_unknown' || cause.code === 'remote_unavailable';
		return new WorkspaceSuspendFailure(cause.code, unknown ? 'unknown' : 'confirmed', { cause });
	}
	return new WorkspaceSuspendFailure('operation_unknown', 'unknown', { cause });
}

export function createSshSuspendChannel(socket: WorkspaceSocket, canUse: () => boolean): SshSuspendChannel {
	let busy = false;
	let blocked = false;
	return {
		async mark(_workspaceId, snapshot) {
			if (!canUse() || busy || blocked) {
				throw new WorkspaceSuspendFailure('conflict', 'not_dispatched');
			}
			busy = true;
			const request = socket.bindRequests();
			let prepared = false;
			let dispatched = false;
			try {
				const initial = readWorkspaceSuspendMark({ terminalSnapshot: await snapshot() });
				if (!canUse()) {
					throw new WorkspaceSuspendFailure('not_found', 'not_dispatched');
				}
				dispatched = true;
				readWorkspaceEmptyResponse(await request('suspend.prepare', initial));
				prepared = true;
				const final = readWorkspaceSuspendMark({ terminalSnapshot: await snapshot() });
				if (!canUse()) {
					throw new WorkspaceSuspendFailure('operation_unknown', 'unknown');
				}
				const response = readWorkspaceSuspendMarkResponse(await request('suspend.commit', final));
				return { suspendedSessionId: response.suspendedSessionId };
			} catch (cause) {
				const error = dispatched
					? failure(cause)
					: new WorkspaceSuspendFailure('invalid_input', 'not_dispatched', { cause });
				// A confirmed prepare is still a retained remote state. Do not compensate a
				// lost/invalid commit with unmark, which could destroy a committed record.
				if (prepared || (dispatched && error.outcome === 'unknown')) {
					blocked = true;
				}
				if (blocked) {
					throw new WorkspaceSuspendFailure('operation_unknown', 'unknown', { cause: error });
				}
				throw error;
			} finally {
				busy = false;
			}
		},

		async unmark(_workspaceId) {
			if (!canUse() || busy || blocked) {
				throw new WorkspaceSuspendFailure('conflict', 'not_dispatched');
			}
			busy = true;
			try {
				readWorkspaceEmptyResponse(await socket.bindRequests()('suspend.unmark', {}));
			} catch (cause) {
				const error = failure(cause);
				if (error.outcome === 'unknown') {
					blocked = true;
				}
				throw error;
			} finally {
				busy = false;
			}
		},
	};
}
