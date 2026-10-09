import { createHash } from 'node:crypto';
import type { OpenSessionRequest, RemoteSessionResource } from './session-types.js';
import type { TrustedResolvedSshTarget, TrustedSshTargetResolver } from '../../../targets/public.js';
import type { HostKeyManagement } from '../../../targets/public.js';
import type {
	MachineEndpoint,
	MachineRoute,
	MachineAuthentication,
	MachineProxy,
	MachineSshFactory,
	MachineConnectOptions,
	MachineConnection,
	MachineShell,
} from '../../../../platform/ssh/ssh-port.js';

/** Remote owns business target → generic machine contract transformation. */
function toMachineTarget(target: TrustedResolvedSshTarget): MachineEndpoint {
	const credentials = target.authentication;
	const authentication: MachineAuthentication =
		credentials.kind === 'password'
			? { kind: 'password', password: credentials.password }
			: { kind: 'private_key', privateKey: credentials.privateKey, passphrase: credentials.passphrase };
	const proxy = target.proxy;
	const proxyInput: MachineProxy | null =
		proxy === null
			? null
			: {
					type: proxy.type,
					host: proxy.host,
					port: proxy.port,
					username: proxy.username,
					password: proxy.password,
				};
	const route = toMachineRoute(target.jumps, proxyInput);
	return {
		host: target.host,
		port: target.port,
		username: target.username,
		authentication,
		route,
	};
}

function toMachineRoute(jumps: readonly TrustedResolvedSshTarget[], proxy: MachineProxy | null): MachineRoute {
	if (jumps.length > 0) {
		return { kind: 'jump', hops: jumps.map(toMachineTarget) };
	}
	if (proxy === null) {
		return { kind: 'direct' };
	}
	return { kind: 'proxy', proxy };
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
		offMachine();
		offShell();
		const failures: unknown[] = [];
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
			let notified = false;

			const notify = () => {
				if (!notified) {
					notified = true;
					listener();
				}
			};

			const offTransport = machine.onClose(notify);
			const offChannel = shell.onClose(notify);
			return () => {
				notified = true;
				offTransport();
				offChannel();
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
	constructor(
		private readonly resolver: TrustedSshTargetResolver,
		private readonly ssh: MachineSshFactory,
		private readonly verifyHostKey: MachineConnectOptions['verifyHostKey'] | null,
		private readonly hostKeys: Pick<HostKeyManagement, 'list'>,
	) {}

	async open(request: OpenSessionRequest): Promise<RemoteSessionResource> {
		request.signal?.throwIfAborted();
		const controller = new AbortController();

		const abort = () => controller.abort(request.signal?.reason);

		request.signal?.addEventListener('abort', abort, { once: true });
		const deadline = Date.now() + request.timeoutMs;
		const timer = setTimeout(
			() => controller.abort(new Error('Remote session opening deadline exceeded')),
			request.timeoutMs,
		);
		let machine: MachineConnection | null = null;
		try {
			const target = await this.resolver.resolveStored(request.targetId);
			// All hops and the final endpoint must have explicit operator-confirmed
			// public-key fingerprints. No TOFU / accept-all fallback.
			const trusts = await this.hostKeys.list();
			const pinned = new Map(trusts.map((key) => [key.host.toLowerCase() + ':' + key.port, key.fingerprint]));

			const verify: MachineConnectOptions['verifyHostKey'] = (host, port, publicKey) => {
				const fingerprint =
					'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/u, '');
				const expected = pinned.get(host.toLowerCase() + ':' + port);
				return (
					expected !== undefined &&
					expected === fingerprint &&
					(this.verifyHostKey === null || this.verifyHostKey(host, port, publicKey))
				);
			};

			controller.signal.throwIfAborted();
			const remaining = deadline - Date.now();
			if (remaining <= 0) {
				throw new Error('Remote session opening deadline exceeded');
			}
			machine = await this.ssh.connect(toMachineTarget(target), {
				timeoutMs: remaining,
				signal: controller.signal,
				verifyHostKey: verify,
			});
			controller.signal.throwIfAborted();
			const shell = await machine.openShell(
				{ columns: request.columns, rows: request.rows, term: request.term },
				controller.signal,
			);
			controller.signal.throwIfAborted();
			shell.pause();
			return createSessionResource(target, machine, shell);
		} catch (error) {
			if (machine) {
				try {
					await machine.close();
				} catch (cleanup) {
					throw new AggregateError([error, cleanup], 'Remote opening and cleanup failed');
				}
			}
			throw error;
		} finally {
			clearTimeout(timer);
			request.signal?.removeEventListener('abort', abort);
		}
	}
}
