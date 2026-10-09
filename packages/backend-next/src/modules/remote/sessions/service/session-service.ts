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
	closing: Promise<void> | null;
}

const MAX_LIVE_SESSIONS = 64;
const MAX_CONNECT_TIMEOUT = 300000;

export class RemoteSessionService {
	private readonly sessions = new Map<string, ActiveSession>();
	private readonly opening = new Set<AbortController>();
	private readonly openingTasks = new Set<Promise<unknown>>();
	private readonly closingTasks = new Set<Promise<void>>();
	private readonly sessionClosings = new Map<string, Promise<void>>();
	private closing: Promise<void> | null = null;
	private accepting = true;

	constructor(private readonly model: RemoteSessionModel) {}

	private requireSession(id: string): ActiveSession {
		const session = this.sessions.get(id);
		if (!session) throw new Error('Remote session not found');
		return session;
	}

	private admitted(): void {
		if (!this.accepting) throw new Error('Remote sessions are closing');
	}

	open(request: OpenSessionRequest): Promise<RemoteSessionSnapshot> {
		this.admitted();
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
		)
			throw new Error('Invalid remote session request');
		if (this.sessions.size + this.opening.size >= MAX_LIVE_SESSIONS)
			throw new Error('Remote session capacity exceeded');
		const controller = new AbortController();

		const abort = () => controller.abort(request.signal?.reason);

		request.signal?.addEventListener('abort', abort, { once: true });
		if (request.signal?.aborted) abort();
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
			if (controller.signal.aborted || !this.accepting || !opened.isOpen)
				throw new Error('Remote session opening cancelled');
			const id = randomUUID();
			const view: RemoteSessionSnapshot = {
				id,
				targetId: opened.targetId,
				fingerprint: opened.fingerprint,
				startedAt: Date.now(),
				status: 'open',
			};
			const current: ActiveSession = {
				view,
				resource: opened,
				dataListeners: new Set(),
				stderrListeners: new Set(),
				closedListeners: new Set(),

				offResource: () => undefined,

				offData: () => undefined,

				offStderr: () => undefined,

				onChunk: () => undefined,

				closing: null,
			};
			current.onChunk = (bytes: Uint8Array) => {
				for (const fn of current.dataListeners) {
					try {
						fn(Uint8Array.from(bytes));
					} catch {
						/* isolate client listeners */
					}
				}
			};
			current.offResource = opened.onClose(() => {
				void this.closeSession(id).catch(() => undefined);
			});
			current.offStderr = opened.onStderr((bytes) => {
				for (const listener of current.stderrListeners) {
					try {
						listener(Uint8Array.from(bytes));
					} catch {
						/* caller cannot break session lifecycle */
					}
				}
			});
			this.sessions.set(id, current);
			return this.view(current);
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

	private view(session: ActiveSession): RemoteSessionSnapshot {
		const { id, targetId, fingerprint, startedAt } = session.view;
		return { id, targetId, fingerprint, startedAt, status: 'open' };
	}

	get(id: string): RemoteSessionSnapshot | null {
		const current = this.sessions.get(id);
		return current ? this.view(current) : null;
	}

	list(): RemoteSessionSnapshot[] {
		return [...this.sessions.values()].map((session) => this.view(session));
	}

	write(id: string, bytes: Uint8Array): boolean {
		const session = this.requireSession(id);
		if (!session.resource.isOpen || session.closing) throw new Error('Remote session closed');
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
		const pending = this.sessionClosings.get(id);
		if (pending) return pending;
		const session = this.sessions.get(id);
		if (!session) return Promise.resolve();
		if (session.closing) return session.closing;
		session.closing = Promise.resolve().then(async () => {
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
		});
		const task = session.closing;
		this.sessionClosings.set(id, task);
		this.closingTasks.add(task);
		void task
			.finally(() => {
				this.closingTasks.delete(task);
				this.sessionClosings.delete(id);
			})
			.catch(() => undefined);
		return task;
	}

	quiesce(): void {
		if (!this.accepting) return;
		this.accepting = false;
		for (const controller of this.opening) controller.abort(new Error('Remote sessions shutting down'));
	}

	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.quiesce();
		this.closing = (async () => {
			await Promise.allSettled([...this.openingTasks]);
			const completions = await Promise.allSettled([
				...this.closingTasks,
				...[...this.sessions.keys()].map((id) => this.closeSession(id)),
			]);
			const failures = completions.filter(
				(result): result is PromiseRejectedResult => result.status === 'rejected',
			);
			if (failures.length)
				throw new AggregateError(
					failures.map((item) => item.reason),
					'Remote sessions failed to close',
				);
		})();
		return this.closing;
	}
}
