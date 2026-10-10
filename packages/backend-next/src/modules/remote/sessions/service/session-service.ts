import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { RecentResults } from '../../../../platform/lifecycle/recent-results.js';
import { CLOSED_SESSION_TTL_MS, MAX_RECENTLY_RELEASED } from '../session-limits.js';
import { RemoteSessionFailure } from '../model/session-failure.js';
import {
	REMOTE_TERMINAL_MAX_COLUMNS,
	REMOTE_TERMINAL_MAX_ROWS,
	REMOTE_TERMINAL_MAX_TERM_LENGTH,
} from '@nexus-terminal/shared/remote/sessions/values';
import type { RemoteSessionCloseReason } from '../../public.js';
import { randomUUID } from 'node:crypto';
import type { RemoteSessionModel } from '../model/session-model.js';
import type { RemoteSessionSnapshot, RemoteSessionResource, OpenSessionRequest } from '../model/session-types.js';

interface ActiveSession {
	view: RemoteSessionSnapshot;
	resource: RemoteSessionResource;
	dataListeners: Set<(bytes: Uint8Array) => void>;
	stderrListeners: Set<(bytes: Uint8Array) => void>;
	closedListeners: Set<(reason: RemoteSessionCloseReason) => void>;
	closeReason: RemoteSessionCloseReason;
	offResource: () => void;
	offData: () => void;
	offStderr: () => void;
	onChunk: (bytes: Uint8Array) => void;
	closePromise: Promise<void> | null;
	transportPaused: boolean;
}

function notifyDataListeners(listeners: Set<(bytes: Uint8Array) => void>, bytes: Uint8Array): void {
	for (const listener of listeners) {
		try {
			listener(Uint8Array.from(bytes));
		} catch {
			// A consumer cannot interrupt delivery or change session ownership.
		}
	}
}

const MAX_LIVE_SESSIONS = 64;
const MAX_CONNECT_TIMEOUT = 300000;

export class RemoteSessionService {
	private readonly sessions = new Map<string, ActiveSession>();
	private readonly opening = new Set<AbortController>();
	private readonly openingTasks = new Set<Promise<unknown>>();
	private readonly closingTasks = new Set<Promise<void>>();
	private readonly sessionClosePromises = new Map<string, Promise<void>>();
	private readonly recentlyClosed = new RecentResults<string, Promise<void>>(
		MAX_RECENTLY_RELEASED,
		CLOSED_SESSION_TTL_MS,
	);
	private readonly cleanupFailures = new FailureSummary();
	private closePromise: Promise<void> | null = null;
	private accepting = true;

	constructor(private readonly model: RemoteSessionModel) {}

	private requireSession(id: string): ActiveSession {
		const session = this.sessions.get(id);
		if (!session) {
			throw new RemoteSessionFailure('not_found');
		}
		return session;
	}

	private assertAccepting(): void {
		if (!this.accepting) {
			throw new RemoteSessionFailure('remote_unavailable');
		}
	}

	open(request: OpenSessionRequest): Promise<RemoteSessionSnapshot> {
		this.assertAccepting();
		if (
			request.term !== undefined &&
			(typeof request.term !== 'string' ||
				request.term.length > REMOTE_TERMINAL_MAX_TERM_LENGTH ||
				!/^[-\w.]+$/u.test(request.term))
		) {
			throw new RemoteSessionFailure('invalid_input');
		}
		if (
			!Number.isSafeInteger(request.targetId) ||
			request.targetId < 1 ||
			!Number.isSafeInteger(request.columns) ||
			request.columns < 1 ||
			request.columns > REMOTE_TERMINAL_MAX_COLUMNS ||
			!Number.isSafeInteger(request.rows) ||
			request.rows < 1 ||
			request.rows > REMOTE_TERMINAL_MAX_ROWS ||
			!Number.isSafeInteger(request.timeoutMs) ||
			request.timeoutMs < 1 ||
			request.timeoutMs > MAX_CONNECT_TIMEOUT
		) {
			throw new RemoteSessionFailure('invalid_input');
		}
		if (this.sessions.size + this.opening.size >= MAX_LIVE_SESSIONS) {
			throw new RemoteSessionFailure('remote_unavailable');
		}
		const controller = new AbortController();

		const abort = () => controller.abort(request.signal?.reason);

		request.signal?.addEventListener('abort', abort, { once: true });
		if (request.signal?.aborted) {
			abort();
		}
		this.opening.add(controller);
		const task = this.openAdmitted(request, controller);
		this.openingTasks.add(task);
		void task
			.finally(() => {
				request.signal?.removeEventListener('abort', abort);
				this.opening.delete(controller);
				this.openingTasks.delete(task);
			})
			.catch(() => undefined);
		return task;
	}

	private async openAdmitted(
		request: OpenSessionRequest,
		controller: AbortController,
	): Promise<RemoteSessionSnapshot> {
		let opened: RemoteSessionResource | null = null;
		try {
			opened = await this.model.open({
				targetId: request.targetId,
				columns: request.columns,
				rows: request.rows,
				term: request.term,
				timeoutMs: request.timeoutMs,
				signal: controller.signal,
			});
			if (controller.signal.aborted || !this.accepting || !opened.isOpen) {
				throw new RemoteSessionFailure('remote_unavailable');
			}
			return this.registerSession(opened);
		} catch (error) {
			if (opened) {
				try {
					await opened.close();
				} catch (cleanup) {
					const failure = new RemoteResourceCleanupFailure([error, cleanup]);
					this.cleanupFailures.record(failure);
					throw failure;
				}
			}
			if (error instanceof RemoteResourceCleanupFailure) {
				this.cleanupFailures.record(error);
			}
			throw error;
		}
	}

	private registerSession(resource: RemoteSessionResource): RemoteSessionSnapshot {
		const id = randomUUID();
		const view: RemoteSessionSnapshot = {
			id,
			targetId: resource.targetId,
			fingerprint: resource.fingerprint,
			startedAt: Date.now(),
			status: 'open',
		};
		const current: ActiveSession = {
			view,
			resource,
			dataListeners: new Set(),
			stderrListeners: new Set(),
			closedListeners: new Set(),
			closeReason: 'closed_by_owner',

			offResource: () => undefined,

			offData: () => undefined,

			offStderr: () => undefined,

			onChunk: () => undefined,

			closePromise: null,
			transportPaused: false,
		};
		current.onChunk = (bytes) => notifyDataListeners(current.dataListeners, bytes);
		current.offResource = resource.onClose((reason) => {
			void this.closeSession(id, reason).catch(() => undefined);
		});
		this.sessions.set(id, current);
		return this.toSnapshot(current);
	}

	private toSnapshot(session: ActiveSession): RemoteSessionSnapshot {
		const { id, targetId, fingerprint, startedAt } = session.view;
		return { id, targetId, fingerprint, startedAt, status: 'open' };
	}

	get(id: string): RemoteSessionSnapshot | null {
		const current = this.sessions.get(id);
		return current ? this.toSnapshot(current) : null;
	}

	list(): RemoteSessionSnapshot[] {
		return [...this.sessions.values()].map((session) => this.toSnapshot(session));
	}

	write(id: string, bytes: Uint8Array): boolean {
		const session = this.requireSession(id);
		if (!session.resource.isOpen || session.closePromise) {
			throw new RemoteSessionFailure('remote_unavailable');
		}
		return session.resource.write(bytes);
	}

	resize(id: string, columns: number, rows: number): void {
		if (
			!Number.isSafeInteger(columns) ||
			columns < 1 ||
			columns > REMOTE_TERMINAL_MAX_COLUMNS ||
			!Number.isSafeInteger(rows) ||
			rows < 1 ||
			rows > REMOTE_TERMINAL_MAX_ROWS
		) {
			throw new RemoteSessionFailure('invalid_input');
		}
		const session = this.requireSession(id);
		session.resource.resize(columns, rows);
	}

	onData(id: string, listener: (bytes: Uint8Array) => void): () => void {
		const session = this.requireSession(id);
		const first = session.dataListeners.size === 0;
		session.dataListeners.add(listener);
		if (first) {
			// The remote channel stays paused when no output consumer exists.
			session.offData = session.resource.onData(session.onChunk);
			if (!session.transportPaused) {
				session.resource.resume();
			}
		}
		return () => {
			session.dataListeners.delete(listener);
			if (!session.dataListeners.size) {
				session.resource.pause();
				session.offData();
			}
		};
	}

	onStderr(id: string, listener: (bytes: Uint8Array) => void): () => void {
		const session = this.requireSession(id);
		const first = session.stderrListeners.size === 0;
		session.stderrListeners.add(listener);
		if (first) {
			session.offStderr = session.resource.onStderr((bytes) =>
				notifyDataListeners(session.stderrListeners, bytes),
			);
		}
		return () => {
			session.stderrListeners.delete(listener);
			if (!session.stderrListeners.size) {
				session.offStderr();
			}
		};
	}

	pauseOutput(id: string): void {
		const session = this.requireSession(id);
		session.transportPaused = true;
		session.resource.pause();
	}

	resumeOutput(id: string): void {
		const session = this.requireSession(id);
		session.transportPaused = false;
		if (session.dataListeners.size) {
			session.resource.resume();
		}
	}

	onDrain(id: string, listener: () => void): () => void {
		return this.requireSession(id).resource.onDrain(listener);
	}

	onClosed(id: string, listener: (reason: RemoteSessionCloseReason) => void): () => void {
		const session = this.requireSession(id);
		session.closedListeners.add(listener);
		return () => session.closedListeners.delete(listener);
	}

	closeSession(id: string, reason: RemoteSessionCloseReason = 'closed_by_owner'): Promise<void> {
		const session = this.sessions.get(id);
		if (session) {
			// A transport failure must upgrade a previously observed Shell EOF,
			// never convert an actual failure into a normal termination.
			if (reason === 'disconnected' || session.closeReason === 'closed_by_owner') {
				session.closeReason = reason;
			}
		}
		const pending = this.sessionClosePromises.get(id) ?? this.recentlyClosed.get(id);
		if (pending) {
			return pending;
		}
		if (!session) {
			return Promise.resolve();
		}
		if (session.closePromise) {
			return session.closePromise;
		}
		session.closePromise = Promise.resolve().then(() => this.closeActiveSession(id, session));
		const task = session.closePromise;
		this.sessionClosePromises.set(id, task);
		this.closingTasks.add(task);
		void task.then(
			() => {
				this.closingTasks.delete(task);
				this.sessionClosePromises.delete(id);
				this.recentlyClosed.set(id, task);
			},
			(error) => {
				this.closingTasks.delete(task);
				this.sessionClosePromises.delete(id);
				this.recentlyClosed.set(id, task);
				this.cleanupFailures.record(error);
			},
		);
		return task;
	}

	private async closeActiveSession(id: string, session: ActiveSession): Promise<void> {
		this.sessions.delete(id);
		session.offResource();
		session.offStderr();
		session.offData();
		try {
			await session.resource.close();
		} catch (error) {
			session.closeReason = 'cleanup_failed';
			throw error;
		} finally {
			for (const listener of session.closedListeners) {
				try {
					listener(session.closeReason);
				} catch {
					/* lifecycle is already closed */
				}
			}
			session.dataListeners.clear();
			session.stderrListeners.clear();
			session.closedListeners.clear();
		}
	}

	quiesce(): void {
		if (!this.accepting) {
			return;
		}
		this.accepting = false;
		for (const controller of this.opening) {
			controller.abort(new Error('Remote sessions shutting down'));
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.quiesce();
		this.closePromise = Promise.resolve().then(() => this.closeSessions());
		return this.closePromise;
	}

	private async closeSessions(): Promise<void> {
		await Promise.allSettled([...this.openingTasks]);
		const completions = await Promise.allSettled([
			...this.closingTasks,
			...this.sessionClosePromises.values(),
			...[...this.sessions.keys()].map((id) => this.closeSession(id)),
		]);
		const failures = completions
			.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
			.map((item) => item.reason);
		failures.push(...this.cleanupFailures.errors());
		if (failures.length) {
			throw new AggregateError([...new Set(failures)], 'Remote sessions failed to close');
		}
	}
}
