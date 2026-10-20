import { WorkspaceRequestFailure } from '../model/workspace-error-types';
import type { WorkspaceSuspendResumeOptions } from '../model/workspace-suspend-types';
import type { SuspendedAutoTermination } from '@/features/ssh-suspend/public';
import { computed, nextTick, ref, shallowReactive } from 'vue';
import { logger } from '@/client/logging/logger';
import { registerAuthenticatedSessionReset } from '@/shared/session/public';
import type { WorkspaceCloseOutcome } from '../model/workspace-connection-types';
import type { ConnectionSummary } from '@/features/connections/public';
import {
	applySuspendedAutoTermination,
	refreshSuspendedSessionsAfterHandoff,
	refreshSuspendedSessionsCatalog,
	type SuspendedAutoTerminationViewModel,
	type SuspendedSession,
} from '@/features/ssh-suspend/public';
import type { TerminalViewport } from '@/features/terminal/public';
import { createFileEditorSession } from '@/features/file-editor/public';
import { createFileClipboardController } from '@/features/transfers/public';
import { WorkspaceRuntimeSession } from './workspaceRuntimeSession';

const sessions = shallowReactive(new Map<string, WorkspaceRuntimeSession>());
const activeId = ref<string | null>(null);
const order = ref<string[]>([]);
const fileClipboard = createFileClipboardController();
const sharedEditorSession = createFileEditorSession();
const suspendAutoTerminationNotice = ref<SuspendedAutoTerminationViewModel | null>(null);
const resumeInFlight = new Map<string, Promise<WorkspaceRuntimeSession>>();
const pendingDisposals = new Set<Promise<WorkspaceCloseOutcome>>();
let runtimeGeneration = 0;

const handleSuspendedAutoTerminated = (event: SuspendedAutoTermination): void => {
	const notice = applySuspendedAutoTermination(event);
	if (!notice) {
		return;
	}
	logger.warn(
		{ suspendedSessionId: event.suspendedSessionId, reason: event.reason },
		'Suspended Workspace auto-terminated',
	);
	suspendAutoTerminationNotice.value = notice;
	void refreshSuspendedSessionsCatalog();
};

const orderedSessions = computed(() =>
	order.value.map((id) => sessions.get(id)).filter((session): session is WorkspaceRuntimeSession => Boolean(session)),
);
const activeSession = computed(() => (activeId.value ? (sessions.get(activeId.value) ?? null) : null));

const add = (session: WorkspaceRuntimeSession, index = order.value.length): WorkspaceRuntimeSession => {
	sessions.set(session.id, session);
	const next = [...order.value];
	next.splice(Math.max(0, Math.min(index, next.length)), 0, session.id);
	order.value = next;
	activeId.value = session.id;
	logger.debug(
		{ workspaceId: session.id, connectionId: session.connection.id, sessionCount: sessions.size },
		'Workspace runtime registered',
	);
	return session;
};

const removeRuntime = (id: string, reason: string): Promise<WorkspaceCloseOutcome> => {
	const session = sessions.get(id);
	if (!session) {
		logger.debug(
			{ workspaceId: id, reason, failureKind: 'workspace_runtime_not_found', sessionCount: sessions.size },
			'Workspace runtime removal ignored because session was not found',
		);
		return Promise.resolve('detached');
	}
	const ids = [...order.value];
	const index = ids.indexOf(id);
	const shouldRefreshSuspendHandoff = session.markedForSuspend.value && session.state.value === 'connected';
	let closed: Promise<WorkspaceCloseOutcome>;
	try {
		closed = session.dispose(reason);
	} catch (cause) {
		closed = Promise.reject(cause);
	}
	const failures: unknown[] = [];
	for (const release of [
		() => {
			if (shouldRefreshSuspendHandoff) refreshSuspendedSessionsAfterHandoff(session.id);
		},
		() => {
			if (fileClipboard.value.value?.sourceScopeId === id) fileClipboard.clear();
		},
		() => sharedEditorSession.closeScope(id),
	]) {
		try {
			release();
		} catch (cause) {
			failures.push(cause);
		}
	}
	if (failures.length) {
		closed = closed.then(
			(outcome) => {
				const causes =
					outcome === 'unknown' ? [new Error('Workspace close outcome is unknown'), ...failures] : failures;
				throw new AggregateError(causes, 'Workspace scope cleanup failed');
			},
			(cause) => {
				throw new AggregateError([cause, ...failures], 'Workspace scope cleanup failed');
			},
		);
	}
	pendingDisposals.add(closed);
	void closed.then(
		(outcome) => {
			pendingDisposals.delete(closed);
			if (outcome === 'unknown') {
				logger.warn({ workspaceId: id }, 'Removed Workspace close result remains unknown');
			}
		},
		(cause) => {
			pendingDisposals.delete(closed);
			logger.error({ err: cause, workspaceId: id }, 'Removed Workspace cleanup failed');
		},
	);
	sessions.delete(id);
	order.value = order.value.filter((sessionId) => sessionId !== id);
	logger.debug({ workspaceId: id, reason, sessionCount: sessions.size }, 'Workspace runtime removed');
	if (activeId.value === id) {
		const next = ids[index + 1] ?? ids[index - 1] ?? null;
		activeId.value = next && sessions.has(next) ? next : null;
	}
	return closed;
};

const restoreActive = (preferredId: string | null, fallbackId: string | null): void => {
	if (preferredId && sessions.has(preferredId)) {
		activeId.value = preferredId;
	} else if (fallbackId && sessions.has(fallbackId)) {
		activeId.value = fallbackId;
	}
};

const runResume = (
	suspended: SuspendedSession,
	connection: ConnectionSummary,
	replaceWorkspaceId?: string,
	options: WorkspaceSuspendResumeOptions = {},
): Promise<WorkspaceRuntimeSession> => {
	const existing = resumeInFlight.get(suspended.id);
	if (existing) {
		logger.trace({ suspendedSessionId: suspended.id }, 'Reusing in-flight Workspace resume');
		return existing;
	}
	logger.debug({ suspendedSessionId: suspended.id, replaceWorkspaceId }, 'Workspace resume queued');
	const generation = runtimeGeneration;
	const task = (async () => {
		const previousActiveId = activeId.value;
		const replaceIndex = replaceWorkspaceId ? order.value.indexOf(replaceWorkspaceId) : -1;
		const oldSession = replaceWorkspaceId ? sessions.get(replaceWorkspaceId) : undefined;
		if (replaceWorkspaceId && !oldSession) {
			logger.debug(
				{
					workspaceId: replaceWorkspaceId,
					suspendedSessionId: suspended.id,
					failureKind: 'workspace_runtime_not_found',
					sessionCount: sessions.size,
				},
				'Workspace resume replacement target was not found',
			);
		} else if (replaceWorkspaceId && replaceIndex < 0) {
			logger.debug(
				{
					workspaceId: replaceWorkspaceId,
					suspendedSessionId: suspended.id,
					failureKind: 'workspace_order_stale',
					sessionCount: sessions.size,
				},
				'Workspace resume replacement target was missing from tab order',
			);
		}
		const shouldRestorePrevious = Boolean(previousActiveId && oldSession && previousActiveId !== oldSession.id);
		const session = new WorkspaceRuntimeSession(connection, {
			onSuspendedAutoTerminated: handleSuspendedAutoTerminated,
		});
		const replacingVisibleSlot = Boolean(oldSession && replaceIndex >= 0);

		if (oldSession && replaceIndex >= 0) {
			// Mobile foreground recovery needs the replacement Terminal mounted while suspend.resume
			// restores the tail/history. Swap the visible tab slot atomically instead of appending a
			// temporary second tab and removing the stale disconnected tab only after resume completes.
			sessions.set(session.id, session);
			order.value = order.value.map((id) => (id === oldSession.id ? session.id : id));
			activeId.value = session.id;
		} else {
			add(session, replaceIndex >= 0 ? replaceIndex : order.value.length);
		}

		try {
			await nextTick();
			if (generation !== runtimeGeneration || sessions.get(session.id) !== session) {
				throw new DOMException('Workspace closed', 'AbortError');
			}
			await session.resume(suspended.id, suspended.suspendedAt, options);
			if (generation !== runtimeGeneration || sessions.get(session.id) !== session) {
				throw new DOMException('Workspace closed', 'AbortError');
			}
			void refreshSuspendedSessionsCatalog();
			if (oldSession && sessions.get(oldSession.id) === oldSession) {
				removeRuntime(oldSession.id, 'Replaced by resumed suspended session');
			}
			if (shouldRestorePrevious) {
				restoreActive(previousActiveId, session.id);
			} else {
				activeId.value = session.id;
			}
			return session;
		} catch (error) {
			if (generation !== runtimeGeneration) {
				throw error;
			}
			if (sessions.get(session.id) !== session) {
				if (oldSession && sessions.get(oldSession.id) === oldSession) {
					removeRuntime(oldSession.id, 'Replacement Workspace tab closed');
				}
				throw error;
			}
			logger.debug(
				{
					err: error,
					workspaceId: session.id,
					suspendedSessionId: suspended.id,
					replaceWorkspaceId,
					failureKind: 'workspace_resume_failed',
				},
				'Workspace resume registry transaction failed',
			);
			removeRuntime(session.id, 'Suspended session resume failed');
			if (replacingVisibleSlot && oldSession && sessions.get(oldSession.id) === oldSession) {
				const next = [...order.value];
				const insertIndex = Math.max(0, Math.min(replaceIndex, next.length));
				if (!next.includes(oldSession.id)) {
					next.splice(insertIndex, 0, oldSession.id);
				}
				order.value = next;
			}
			restoreActive(previousActiveId, oldSession?.id ?? null);
			throw error;
		}
	})().finally(() => {
		if (resumeInFlight.get(suspended.id) === task) {
			resumeInFlight.delete(suspended.id);
		}
	});
	resumeInFlight.set(suspended.id, task);
	return task;
};

export const workspaceRuntimeRegistry = {
	sessions,
	activeId,
	order,
	orderedSessions,
	activeSession,
	fileClipboard,
	sharedEditorSession,
	suspendAutoTerminationNotice,

	async open(connection: ConnectionSummary, viewport?: TerminalViewport): Promise<WorkspaceRuntimeSession> {
		if (connection.type !== 'SSH') {
			throw new Error('Only SSH connections can open a Workspace session.');
		}
		const session = new WorkspaceRuntimeSession(connection, {
			onSuspendedAutoTerminated: handleSuspendedAutoTerminated,
		});
		add(session);
		try {
			await session.connect(viewport);
			if (sessions.get(session.id) !== session) {
				throw new DOMException('Workspace closed', 'AbortError');
			}
			return session;
		} catch (error) {
			if (sessions.get(session.id) !== session) {
				throw new DOMException('Workspace closed', 'AbortError');
			}
			// Keep a refused host's tab available for an explicit reconnect after confirmation/cancellation.
			if (error instanceof WorkspaceRequestFailure && error.code === 'host_key_untrusted') {
				return session;
			}
			// Other failed initial bindings still release the provisional tab.
			removeRuntime(session.id, 'Initial Workspace connection failed');
			throw error;
		}
	},

	resume(
		suspended: SuspendedSession,
		connection: ConnectionSummary,
		options: WorkspaceSuspendResumeOptions = {},
	): Promise<WorkspaceRuntimeSession> {
		return runResume(suspended, connection, undefined, options);
	},

	resumeReplacing(
		suspended: SuspendedSession,
		connection: ConnectionSummary,
		replaceWorkspaceId: string,
		options: WorkspaceSuspendResumeOptions = {},
	): Promise<WorkspaceRuntimeSession> {
		return runResume(suspended, connection, replaceWorkspaceId, options);
	},

	activate(id: string): void {
		if (sessions.has(id)) {
			activeId.value = id;
			return;
		}
		logger.debug(
			{ workspaceId: id, failureKind: 'workspace_runtime_not_found', sessionCount: sessions.size },
			'Workspace activation ignored because session was not found',
		);
	},

	move(id: string, targetId: string, placement: 'before' | 'after' = 'before'): void {
		if (id === targetId) {
			return;
		}
		if (!sessions.has(id) || !sessions.has(targetId)) {
			logger.debug(
				{
					workspaceId: id,
					targetWorkspaceId: targetId,
					sourceExists: sessions.has(id),
					targetExists: sessions.has(targetId),
					failureKind: 'workspace_runtime_not_found',
				},
				'Workspace move ignored because a session was not found',
			);
			return;
		}
		const next = order.value.filter((sessionId) => sessionId !== id);
		const targetIndex = next.indexOf(targetId);
		if (targetIndex < 0) {
			return;
		}
		next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, id);
		order.value = next;
	},

	remove(id: string, reason = 'Workspace tab closed'): void {
		removeRuntime(id, reason);
	},

	closeOthers(id: string): void {
		for (const sessionId of [...order.value]) {
			if (sessionId !== id) {
				removeRuntime(sessionId, 'Other Workspace tab closed');
			}
		}
		this.activate(id);
	},

	closeToRight(id: string): void {
		const ids = [...order.value];
		const index = ids.indexOf(id);
		if (index < 0) {
			logger.debug(
				{ workspaceId: id, failureKind: 'workspace_order_stale', sessionCount: sessions.size },
				'Workspace close-to-right ignored because session was missing from tab order',
			);
			return;
		}
		for (const sessionId of ids.slice(index + 1)) {
			removeRuntime(sessionId, 'Workspace tab closed');
		}
	},

	closeToLeft(id: string): void {
		const ids = [...order.value];
		const index = ids.indexOf(id);
		if (index < 0) {
			logger.debug(
				{ workspaceId: id, failureKind: 'workspace_order_stale', sessionCount: sessions.size },
				'Workspace close-to-left ignored because session was missing from tab order',
			);
			return;
		}
		for (const sessionId of ids.slice(0, index)) {
			removeRuntime(sessionId, 'Workspace tab closed');
		}
	},

	async disposeAll(reason = 'Workspace runtime disposed'): Promise<void> {
		runtimeGeneration += 1;
		resumeInFlight.clear();
		const tasks = new Set(pendingDisposals);
		for (const id of [...sessions.keys()]) {
			tasks.add(removeRuntime(id, reason));
		}
		sharedEditorSession.reset();
		fileClipboard.clear();
		suspendAutoTerminationNotice.value = null;
		const results = await Promise.allSettled(tasks);
		const failures: unknown[] = [];
		for (const result of results) {
			if (result.status === 'rejected') failures.push(result.reason);
			else if (result.value === 'unknown') failures.push(new Error('Workspace close outcome is unknown'));
		}
		if (failures.length) throw new AggregateError(failures, 'Workspace runtime cleanup failed');
	},
};

registerAuthenticatedSessionReset('workspace-runtimes', () => {
	void workspaceRuntimeRegistry
		.disposeAll('Authenticated session revoked')
		.catch((cause) => logger.error({ err: cause }, 'Authenticated Workspace cleanup failed'));
});

const handlePageHide = (event: PageTransitionEvent): void => {
	if (sessions.size > 0) {
		logger.info(
			{
				persisted: event.persisted,
				visibilityState: document.visibilityState,
				activeWorkspaceId: activeId.value,
				sessionCount: sessions.size,
				markedWorkspaceIds: [...sessions.values()]
					.filter((session) => session.markedForSuspend.value)
					.map((session) => session.id),
			},
			'Workspace pagehide lifecycle event',
		);
	}
	if (event.persisted) {
		return;
	}
	void workspaceRuntimeRegistry
		.disposeAll('Workspace disposed by pagehide')
		.catch((cause) => logger.error({ err: cause }, 'Workspace pagehide cleanup failed'));
};

if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', handlePageHide);
}

export type WorkspaceRuntimeRegistry = typeof workspaceRuntimeRegistry;
