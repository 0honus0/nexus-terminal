import type { MachineConnection } from '../../../../platform/ssh/ssh-port.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import { RemoteFileFailure } from '../../files/model/file-types.js';
import type { RemoteMachineModel } from './machine-model.js';
import type { RemoteMachineOpenRequest, OpenedRemoteMachine, RemoteMachineProvider } from './machine-types.js';

interface ScopedMachine {
	targetId: number;
	key: string;
	stop: AbortController;
	opening: Promise<OpenedRemoteMachine>;
	opened: OpenedRemoteMachine | null;
	borrowed: boolean;
	retired: boolean;
	cleanupFailed: boolean;
	closing: Promise<void> | null;
}

/** One Run owns the pool. Overlapping operations borrow independent transports to isolate backpressure. */
export class RemoteMachineScopeModel implements RemoteMachineProvider {
	private readonly retained = new Set<ScopedMachine>();
	private readonly leases = new WeakMap<MachineConnection, (reusable: boolean) => Promise<void>>();
	private readonly stop = new AbortController();
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly changed: () => void = () => {},
	) {}

	snapshot(): { connections: number; targetIds: number[]; cleanupFailed: boolean } {
		const entries = [...this.retained];
		return {
			connections: entries.length,
			targetIds: [...new Set(entries.map((entry) => entry.targetId))],
			cleanupFailed: entries.some((entry) => entry.cleanupFailed),
		};
	}

	async key(request: RemoteMachineOpenRequest): Promise<string> {
		this.requireOpen();
		const key = await this.machines.reuseKey(request);
		this.requireOpen();
		const retired = [...this.retained].filter(
			(entry) =>
				(entry.targetId === request.targetId && entry.key !== key) ||
				(entry.opened !== null && !entry.opened.machine.isOpen),
		);
		for (const entry of retired) {
			entry.retired = true;
		}
		const released = await Promise.allSettled(
			retired.filter((entry) => !entry.borrowed).map((entry) => this.dispose(entry)),
		);
		const failures = released.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw new RemoteResourceCleanupFailure(failures);
		}
		this.requireOpen();
		request.signal.throwIfAborted();
		return key;
	}

	private requireOpen(): void {
		if (this.stop.signal.aborted || [...this.retained].some((entry) => entry.cleanupFailed)) {
			throw new RemoteFileFailure('remote_unavailable');
		}
	}

	async open(request: RemoteMachineOpenRequest): Promise<OpenedRemoteMachine> {
		const deadline = Date.now() + request.timeoutMs;
		const key = await this.key(request);
		this.requireOpen();
		let entry = [...this.retained].find(
			(candidate) => candidate.key === key && !candidate.borrowed && !candidate.retired,
		);
		if (!entry) {
			const remaining = deadline - Date.now();
			if (remaining < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			const stop = new AbortController();
			const opening = Promise.resolve().then(() =>
				this.machines.open({
					targetId: request.targetId,
					expectedFingerprint: request.expectedFingerprint,
					timeoutMs: remaining,
					signal: AbortSignal.any([request.signal, this.stop.signal, stop.signal]),
					validate: request.validate,
				}),
			);
			const created: ScopedMachine = {
				targetId: request.targetId,
				key,
				stop,
				opening,
				opened: null,
				borrowed: false,
				retired: false,
				cleanupFailed: false,
				closing: null,
			};
			entry = created;
			this.retained.add(created);
			this.changed();
			void opening.then(
				(opened) => {
					created.opened = opened;
					this.changed();
				},
				() => undefined,
			);
		}
		// Reserve before awaiting the handshake; active transports never accept another operation.
		entry.borrowed = true;
		try {
			const opened = await this.wait(entry.opening, request.signal, deadline);
			if ((await this.key(request)) !== key) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			await request.validate?.();
			this.requireOpen();
			request.signal.throwIfAborted();
			if (Date.now() >= deadline || entry.retired || !opened.machine.isOpen) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return this.lease(entry, opened);
		} catch (error) {
			entry.borrowed = false;
			// Waiting can end before the real handshake. Retain and close its late result.
			void this.dispose(entry).catch(() => undefined);
			throw error;
		}
	}

	private lease(owner: ScopedMachine, opened: OpenedRemoteMachine): OpenedRemoteMachine {
		const off = new Set<() => void>();
		const scopeSignal = this.stop.signal;
		let closing: Promise<void> | null = null;

		const requireLease = (): MachineConnection => {
			if (closing || owner.retired || this.stop.signal.aborted) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return opened.machine;
		};

		const release = (reusable: boolean): Promise<void> => {
			if (!closing) {
				closing = Promise.resolve().then(async () => {
					const failures: unknown[] = [];
					for (const unsubscribe of off) {
						try {
							unsubscribe();
						} catch (error) {
							failures.push(error);
						}
					}
					off.clear();
					owner.borrowed = false;
					if (
						!reusable ||
						failures.length ||
						owner.retired ||
						!opened.machine.isOpen ||
						this.stop.signal.aborted
					) {
						try {
							await this.dispose(owner);
						} catch (error) {
							failures.push(error);
						}
					}
					if (failures.length) {
						throw new RemoteResourceCleanupFailure(failures);
					}
				});
			}
			return closing;
		};

		const machine: MachineConnection = {
			get isOpen() {
				return !closing && !owner.retired && !scopeSignal.aborted && opened.machine.isOpen;
			},

			openShell: (pty, signal) => requireLease().openShell(pty, signal),

			openRawCommand: (command, signal, mode, pty) => requireLease().openRawCommand(command, signal, mode, pty),

			execute: (command, options) => requireLease().execute(command, options),

			openSftp: (signal) => requireLease().openSftp(signal),

			onClose: (listener) => {
				const unsubscribe = requireLease().onClose(listener);
				off.add(unsubscribe);
				return () => {
					off.delete(unsubscribe);
					unsubscribe();
				};
			},

			// An unclassified release is conservative; Models explicitly return confirmed operations.
			close: () => release(false),
		};
		this.leases.set(machine, release);
		return {
			target: { id: opened.target.id, fingerprint: opened.target.fingerprint },
			machine,
			hostPublicKey: Uint8Array.from(opened.hostPublicKey),
		};
	}

	release(machine: MachineConnection, reusable: boolean): Promise<void> {
		const release = this.leases.get(machine);
		if (!release) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		return release(reusable);
	}

	private wait(
		opening: Promise<OpenedRemoteMachine>,
		signal: AbortSignal,
		deadline: number,
	): Promise<OpenedRemoteMachine> {
		return new Promise((resolve, reject) => {
			const combined = AbortSignal.any([signal, this.stop.signal]);

			const finish = (error: unknown, value?: OpenedRemoteMachine): void => {
				clearTimeout(timer);
				combined.removeEventListener('abort', abort);
				if (value) {
					resolve(value);
				} else {
					reject(error);
				}
			};

			const abort = () => finish(new RemoteFileFailure('remote_unavailable', { cause: combined.reason }));

			const timer = setTimeout(
				() => finish(new RemoteFileFailure('remote_unavailable')),
				Math.max(1, deadline - Date.now()),
			);
			combined.addEventListener('abort', abort, { once: true });
			void opening.then(
				(value) => finish(null, value),
				(error: unknown) => finish(error),
			);
			if (combined.aborted) {
				abort();
			}
		});
	}

	private dispose(entry: ScopedMachine): Promise<void> {
		if (entry.closing) {
			return entry.closing;
		}
		entry.retired = true;
		entry.stop.abort();
		entry.closing = Promise.resolve().then(async () => {
			let opened: OpenedRemoteMachine;
			try {
				opened = await entry.opening;
			} catch (error) {
				if (error instanceof RemoteResourceCleanupFailure) {
					throw error;
				}
				this.retained.delete(entry);
				this.changed();
				return;
			}
			try {
				await opened.machine.close();
			} catch (error) {
				throw new RemoteResourceCleanupFailure([error]);
			}
			this.retained.delete(entry);
			this.changed();
		});
		void entry.closing.catch(() => {
			entry.cleanupFailed = true;
			this.changed();
		});
		return entry.closing;
	}

	quiesce(): void {
		this.stop.abort();
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(async () => {
				const results = await Promise.allSettled([...this.retained].map((entry) => this.dispose(entry)));
				const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				if (failures.length) {
					throw new RemoteResourceCleanupFailure(failures);
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
