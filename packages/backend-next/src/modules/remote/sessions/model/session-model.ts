import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { OpenSessionRequest, RemoteSessionResource } from './session-types.js';
import type { TrustedResolvedSshTarget } from '../../../targets/public.js';
import type { MachineConnection, MachineShell } from '../../../../platform/ssh/ssh-port.js';
import type { RemoteMachineModel } from '../../model/machine-model.js';

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
	target: TrustedResolvedSshTarget,
	machine: MachineConnection,
	shell: MachineShell,
): RemoteSessionResource {
	let closed = false;
	let closePromise: Promise<void> | null = null;
	const offMachine = machine.onClose(() => {
		closed = true;
	});
	const offShell = shell.onClose(() => {
		closed = true;
	});

	const assertOpen = (): void => {
		if (closed || closePromise || !machine.isOpen) {
			throw new Error('Remote session resource closed');
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
			throw new AggregateError(failures, 'Remote resource close failed');
		}
	}

	return {
		targetId: target.id,
		fingerprint: target.fingerprint,

		get isOpen() {
			return !closed && closePromise === null && machine.isOpen;
		},

		write(bytes) {
			assertOpen();
			return shell.writable.write(Buffer.from(bytes));
		},

		resize(columns, rows) {
			assertOpen();
			shell.resize(columns, rows);
		},

		pause() {
			shell.pause();
		},

		resume() {
			assertOpen();
			shell.resume();
		},

		onData(listener) {
			const data = (chunk: Buffer | string) =>
				listener(Uint8Array.from(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

			shell.readable.on('data', data);
			return () => shell.readable.off('data', data);
		},

		onStderr(listener) {
			return shell.onStderr((bytes) => listener(Uint8Array.from(bytes)));
		},

		onDrain(listener) {
			return shell.onDrain(listener);
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

			const offTransport = machine.onClose(() => notify('disconnected'));
			const offChannel = shell.onClose((reason) => notify(reason === 'normal' ? 'normal' : 'disconnected'));
			return () => {
				lastReason = 'disconnected';
				const failures = unsubscribeAll([offTransport, offChannel]);
				if (failures.length) {
					throw new AggregateError(failures, 'Remote close subscriptions failed');
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
		request.signal?.throwIfAborted();
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
			throw error;
		} finally {
			clearTimeout(timer);
			request.signal?.removeEventListener('abort', abort);
		}
	}
}
