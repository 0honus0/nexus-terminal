import { RemoteSessionFailure } from './session-failure.js';
import { RemoteHostKeyUntrustedError } from '../../machines/model/machine-errors.js';
import { TargetOperationError } from '../../../targets/public-errors.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { OpenSessionRequest, RemoteSessionResource } from './session-types.js';
import type { RemoteMachineIdentity } from '../../machines/model/machine-types.js';
import type { MachineConnection, MachineShell } from '../../../../platform/ssh/ssh-port.js';
import type { RemoteMachineModel } from '../../machines/model/machine-model.js';

function sessionFailure(cause: unknown): Error {
	if (
		cause instanceof RemoteSessionFailure ||
		cause instanceof RemoteResourceCleanupFailure ||
		cause instanceof RemoteHostKeyUntrustedError ||
		cause instanceof TargetOperationError
	) {
		return cause;
	}
	return new RemoteSessionFailure('remote_unavailable', { cause });
}

function boundary<T>(operation: () => T): T {
	try {
		return operation();
	} catch (cause) {
		throw sessionFailure(cause);
	}
}

function unsubscribeAll(subscriptions: readonly (() => void)[]): unknown[] {
	const failures: unknown[] = [];
	for (const unsubscribe of subscriptions) {
		try {
			unsubscribe();
		} catch (error) {
			failures.push(error);
		}
	}
	return failures;
}

function createSessionResource(
	target: RemoteMachineIdentity,
	machine: MachineConnection,
	shell: MachineShell,
): RemoteSessionResource {
	let closed = false;
	let closePromise: Promise<void> | null = null;
	const offMachine = machine.onClose(() => {
		closed = true;
	});
	let offShell: () => void;
	try {
		offShell = shell.onClose(() => {
			closed = true;
		});
	} catch (cause) {
		const failures = unsubscribeAll([offMachine]);
		if (failures.length) {
			throw new RemoteResourceCleanupFailure([cause, ...failures]);
		}
		throw sessionFailure(cause);
	}

	const assertOpen = (): void => {
		if (closed || closePromise || !boundary(() => machine.isOpen)) {
			throw new RemoteSessionFailure('remote_unavailable');
		}
	};

	async function closeResources(): Promise<void> {
		closed = true;
		const failures = unsubscribeAll([offMachine, offShell]);
		try {
			shell.close();
		} catch (error) {
			failures.push(error);
		}
		try {
			await machine.close();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) {
			throw new RemoteResourceCleanupFailure(failures);
		}
	}

	return {
		targetId: target.id,
		fingerprint: target.fingerprint,

		get isOpen() {
			return boundary(() => !closed && closePromise === null && machine.isOpen);
		},

		write(bytes) {
			assertOpen();
			return boundary(() => shell.writable.write(Buffer.from(bytes)));
		},

		resize(columns, rows) {
			assertOpen();
			boundary(() => shell.resize(columns, rows));
		},

		pause() {
			boundary(() => shell.pause());
		},

		resume() {
			assertOpen();
			boundary(() => shell.resume());
		},

		onData(listener) {
			const data = (chunk: Buffer | string) =>
				listener(Uint8Array.from(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

			boundary(() => shell.readable.on('data', data));
			return () =>
				boundary(() => {
					shell.readable.off('data', data);
				});
		},

		onStderr(listener) {
			const off = boundary(() => shell.onStderr((bytes) => listener(Uint8Array.from(bytes))));
			return () => boundary(off);
		},

		onDrain(listener) {
			const off = boundary(() => shell.onDrain(listener));
			return () => boundary(off);
		},

		onClose(listener) {
			let lastReason: 'normal' | 'disconnected' | null = null;

			const notify = (reason: 'normal' | 'disconnected') => {
				if (lastReason === 'disconnected' || lastReason === reason) {
					return;
				}
				lastReason = reason;
				listener(reason);
			};

			const offTransport = boundary(() => machine.onClose(() => notify('disconnected')));
			let offChannel: () => void;
			try {
				offChannel = boundary(() =>
					shell.onClose((reason) => notify(reason === 'normal' ? 'normal' : 'disconnected')),
				);
			} catch (cause) {
				const failures = unsubscribeAll([offTransport]);
				if (failures.length) {
					throw new RemoteResourceCleanupFailure([cause, ...failures]);
				}
				throw cause;
			}
			return () => {
				lastReason = 'disconnected';
				const failures = unsubscribeAll([offTransport, offChannel]);
				if (failures.length) {
					throw new RemoteResourceCleanupFailure(failures);
				}
			};
		},

		close() {
			if (closePromise) {
				return closePromise;
			}
			closePromise = Promise.resolve().then(closeResources);
			return closePromise;
		},
	};
}

/** All cross-module target resolution and generic machine calls enter through Model. */
export class RemoteSessionModel {
	constructor(private readonly machines: RemoteMachineModel) {}

	async open(request: OpenSessionRequest): Promise<RemoteSessionResource> {
		boundary(() => request.signal?.throwIfAborted());
		const controller = new AbortController();

		const abort = () => controller.abort(request.signal?.reason);

		request.signal?.addEventListener('abort', abort, { once: true });
		if (request.signal?.aborted) {
			abort();
		}
		const deadline = Date.now() + request.timeoutMs;
		const timer = setTimeout(
			() => controller.abort(new Error('Remote opening deadline exceeded')),
			request.timeoutMs,
		);
		let machine: MachineConnection | null = null;
		try {
			const remaining = deadline - Date.now();
			if (remaining < 1) {
				throw new Error('Remote opening deadline exceeded');
			}
			const opened = await this.machines.open({
				targetId: request.targetId,
				timeoutMs: remaining,
				signal: controller.signal,
			});
			machine = opened.machine;
			controller.signal.throwIfAborted();
			const shell = await machine.openShell(
				{ columns: request.columns, rows: request.rows, term: request.term },
				controller.signal,
			);
			controller.signal.throwIfAborted();
			shell.pause();
			return createSessionResource(opened.target, machine, shell);
		} catch (error) {
			if (machine) {
				try {
					await machine.close();
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure([error, cleanup]);
				}
			}
			throw sessionFailure(error);
		} finally {
			clearTimeout(timer);
			request.signal?.removeEventListener('abort', abort);
		}
	}
}
