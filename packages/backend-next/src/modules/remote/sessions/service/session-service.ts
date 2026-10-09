import { randomUUID } from 'node:crypto';
import type { RemoteSessionModel } from '../model/session-model.js';
import type { RemoteSessionSnapshot, RemoteSessionResource, OpenSessionRequest } from '../model/session-types.js';

interface ActiveSession {
	view: RemoteSessionSnapshot;
	resource: RemoteSessionResource;
	dataListeners: Set<(bytes: Uint8Array) => void>;
	stderrListeners: Set<(bytes: Uint8Array) => void>;
	closedListeners: Set<() => void>;
	offResource: () => void;
	offData: () => void;
	offStderr: () => void;
	onChunk: (bytes: Uint8Array) => void;
	closePromise: Promise<void> | null;
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
	private closePromise: Promise<void> | null = null;
	private accepting = true;

	constructor(private readonly model: RemoteSessionModel) {}

	private requireSession(id: string): ActiveSession {
		const session = this.sessions.get(id);
		if (!session) {
			throw new Error('Remote session not found');
		}
		return session;
	}

	private assertAccepting(): void {
		if (!this.accepting) {
			throw new Error('Remote sessions are closing');
		}
	}

	open(request: OpenSessionRequest): Promise<RemoteSessionSnapshot> {
		this.assertAccepting();
		if (
			!Number.isSafeInteger(request.targetId) ||
			request.targetId < 1 ||
			!Number.isSafeInteger(request.columns) ||
			request.columns < 1 ||
			!Number.isSafeInteger(request.rows) ||
			request.rows < 1 ||
			!Number.isSafeInteger(request.timeoutMs) ||
			request.timeoutMs < 1 ||
			request.timeoutMs > MAX_CONNECT_TIMEOUT
		) {
			throw new Error('Invalid remote session request');
		}
		if (this.sessions.size + this.opening.size >= MAX_LIVE_SESSIONS) {
			throw new Error('Remote session capacity exceeded');
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
				throw new Error('Remote session opening cancelled');
			}
			return this.registerSession(opened);
		} catch (error) {
			if (opened) {
				try {
					await opened.close();
				} catch (cleanup) {
					throw new AggregateError([error, cleanup], 'Remote registration and cleanup failed');
				}
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

			offResource: () => undefined,

			offData: () => undefined,

			offStderr: () => undefined,

			onChunk: () => undefined,

			closePromise: null,
		};
		current.onChunk = (bytes) => notifyDataListeners(current.dataListeners, bytes);
		current.offResource = resource.onClose(() => {
			void this.closeSession(id).catch(() => undefined);
		});
		current.offStderr = resource.onStderr((bytes) => notifyDataListeners(current.stderrListeners, bytes));
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
			throw new Error('Remote session closed');
		}
		return session.resource.write(bytes);
	}

	resize(id: string, columns: number, rows: number): void {
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
			session.resource.resume();
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
		session.stderrListeners.add(listener);
		return () => session.stderrListeners.delete(listener);
	}

	onDrain(id: string, listener: () => void): () => void {
		return this.requireSession(id).resource.onDrain(listener);
	}

	onClosed(id: string, listener: () => void): () => void {
		const session = this.requireSession(id);
		session.closedListeners.add(listener);
		return () => session.closedListeners.delete(listener);
	}

	closeSession(id: string): Promise<void> {
		const pending = this.sessionClosePromises.get(id);
		if (pending) {
			return pending;
		}
		const session = this.sessions.get(id);
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
		void task
			.finally(() => {
				this.closingTasks.delete(task);
				this.sessionClosePromises.delete(id);
			})
			.catch(() => undefined);
		return task;
	}

	private async closeActiveSession(id: string, session: ActiveSession): Promise<void> {
		this.sessions.delete(id);
		session.offResource();
		session.offStderr();
		session.offData();
		try {
			await session.resource.close();
		} finally {
			for (const listener of session.closedListeners) {
				try {
					listener();
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
			...[...this.sessions.keys()].map((id) => this.closeSession(id)),
		]);
		const failures = completions.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
		if (failures.length) {
			throw new AggregateError(
				failures.map((item) => item.reason),
				'Remote sessions failed to close',
			);
		}
	}
}
