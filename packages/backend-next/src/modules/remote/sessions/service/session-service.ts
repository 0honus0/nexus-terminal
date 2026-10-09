import { randomUUID } from 'node:crypto';
import type {
	MachineConnection,
	MachineShell,
	MachineSshFactory,
	MachineConnectOptions,
} from '../../../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import { toMachineTarget } from '../model/session-model.js';
import type { RemoteSessionSnapshot } from '../model/session-types.js';

interface ActiveSession {
	view: RemoteSessionSnapshot;
	machine: MachineConnection;
	shell: MachineShell;
	dataListeners: Set<(bytes: Uint8Array) => void>;
	stderrListeners: Set<(bytes: Uint8Array) => void>;
	closedListeners: Set<() => void>;
	offTransport: () => void;
	offShell: () => void;
	offStderr: () => void;
	onChunk: (bytes: Buffer) => void;
	closing: Promise<void> | null;
}

interface OpenRequest {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
	timeoutMs: number;
	signal?: AbortSignal;
}
const MAX_LIVE_SESSIONS = 64;
const MAX_CONNECT_TIMEOUT = 300000;

export class RemoteSessionService {
	private readonly sessions = new Map<string, ActiveSession>();
	private readonly opening = new Set<AbortController>();
	private readonly openingTasks = new Set<Promise<unknown>>();
	private readonly closingTasks = new Set<Promise<void>>();
	private closing: Promise<void> | null = null;
	private accepting = true;

	constructor(
		private readonly resolver: TrustedSshTargetResolver,
		private readonly ssh: MachineSshFactory,
		private readonly verifyHostKey: MachineConnectOptions['verifyHostKey'] | null,
	) {}

	private requireSession(id: string): ActiveSession {
		const session = this.sessions.get(id);
		if (!session) throw new Error('Remote session not found');
		return session;
	}

	private admitted(): void {
		if (!this.accepting) throw new Error('Remote sessions are closing');
	}

	open(request: OpenRequest): Promise<RemoteSessionSnapshot> {
		this.admitted();
		if (!this.verifyHostKey) throw new Error('SSH host-key verification policy is not configured');
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

	private async openAdmitted(request: OpenRequest, controller: AbortController): Promise<RemoteSessionSnapshot> {
		const started = Date.now();
		let machine: MachineConnection | null = null;
		try {
			const target = await this.resolver.resolveStored(request.targetId);
			if (controller.signal.aborted || !this.accepting) throw new Error('Remote session opening cancelled');
			const left = request.timeoutMs - (Date.now() - started);
			if (left <= 0) throw new Error('Remote session connect deadline exceeded');
			machine = await this.ssh.connect(toMachineTarget(target), {
				timeoutMs: left,
				signal: controller.signal,
				verifyHostKey: this.verifyHostKey!,
			});
			if (controller.signal.aborted || !this.accepting) throw new Error('Remote session opening cancelled');
			const shell = await machine.openShell(
				{ columns: request.columns, rows: request.rows, term: request.term },
				controller.signal,
			);
			if (controller.signal.aborted || !this.accepting) {
				shell.close();
				throw new Error('Remote session opening cancelled');
			}
			shell.pause();
			const id = randomUUID();
			const view: RemoteSessionSnapshot = {
				id,
				targetId: target.id,
				fingerprint: target.fingerprint,
				startedAt: Date.now(),
				status: 'open',
			};
			const current: ActiveSession = {
				view,
				machine,
				shell,
				dataListeners: new Set(),
				stderrListeners: new Set(),
				closedListeners: new Set(),

				offTransport: () => undefined,

				offShell: () => undefined,

				offStderr: () => undefined,

				onChunk: () => undefined,

				closing: null,
			};
			current.onChunk = (bytes: Buffer) => {
				for (const fn of current.dataListeners) {
					try {
						fn(Uint8Array.from(bytes));
					} catch {
						/* isolate client listeners */
					}
				}
			};
			current.offTransport = machine.onClose(() => {
				void this.closeSession(id);
			});
			current.offShell = shell.onClose(() => {
				void this.closeSession(id);
			});
			current.offStderr = shell.onStderr((bytes) => {
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
			if (machine) await machine.close();
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
		if (!session.machine.isOpen || session.closing) throw new Error('Remote session closed');
		return session.shell.writable.write(Buffer.from(bytes));
	}

	resize(id: string, columns: number, rows: number): void {
		const session = this.requireSession(id);
		session.shell.resize(columns, rows);
	}

	onData(id: string, listener: (bytes: Uint8Array) => void): () => void {
		const session = this.requireSession(id);
		if (session.dataListeners.size === 0) {
			// The remote channel stays paused when no output consumer exists.
			session.shell.readable.on('data', session.onChunk);
			session.shell.resume();
		}
		session.dataListeners.add(listener);
		return () => {
			session.dataListeners.delete(listener);
			if (!session.dataListeners.size) {
				session.shell.pause();
				session.shell.readable.off('data', session.onChunk);
			}
		};
	}

	onStderr(id: string, listener: (bytes: Uint8Array) => void): () => void {
		const session = this.requireSession(id);
		session.stderrListeners.add(listener);
		return () => session.stderrListeners.delete(listener);
	}

	onDrain(id: string, listener: () => void): () => void {
		return this.requireSession(id).shell.onDrain(listener);
	}

	onClosed(id: string, listener: () => void): () => void {
		const session = this.requireSession(id);
		session.closedListeners.add(listener);
		return () => session.closedListeners.delete(listener);
	}

	closeSession(id: string): Promise<void> {
		const session = this.sessions.get(id);
		if (!session) return Promise.resolve();
		if (session.closing) return session.closing;
		session.closing = (async () => {
			this.sessions.delete(id);
			session.offTransport();
			session.offShell();
			session.offStderr();
			session.shell.readable.off('data', session.onChunk);
			session.shell.close();
			try {
				await session.machine.close();
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
		})();
		const task = session.closing;
		this.closingTasks.add(task);
		void task.finally(() => this.closingTasks.delete(task)).catch(() => undefined);
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
