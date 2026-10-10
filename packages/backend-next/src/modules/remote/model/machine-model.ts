import { RemoteResourceCleanupFailure } from '../resource-errors.js';
import { createHash } from 'node:crypto';
import { RemoteHostKeyUntrustedError } from './machine-errors.js';
import type { RemoteMachineOpenRequest, OpenedRemoteMachine } from './machine-types.js';
import type {
	TrustedResolvedSshTarget,
	TrustedSshTargetResolver,
	TrustedSshResolveRequest,
	HostKeyManagement,
} from '../../targets/public.js';
import type {
	MachineEndpoint,
	MachineRoute,
	MachineAuthentication,
	MachineProxy,
	MachineSshFactory,
	MachineConnectOptions,
} from '../../../platform/ssh/ssh-port.js';

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

/** Shared Remote model owner; ordinary PTY and file resources do not share live machines. */
export class RemoteMachineModel {
	constructor(
		private readonly resolver: TrustedSshTargetResolver,
		private readonly ssh: MachineSshFactory,
		private readonly verifyHostKey: MachineConnectOptions['verifyHostKey'] | null,
		private readonly hostKeys: Pick<HostKeyManagement, 'list'>,
	) {}

	async open(request: RemoteMachineOpenRequest): Promise<OpenedRemoteMachine> {
		const deadline = Date.now() + request.timeoutMs;
		const resolvedRequest: TrustedSshResolveRequest = { targetId: request.targetId };
		if (request.expectedFingerprint !== undefined) {
			resolvedRequest.expectedFingerprint = request.expectedFingerprint;
		}
		const target = await this.resolver.resolveStored(resolvedRequest);
		request.signal.throwIfAborted();
		const trusts = await this.hostKeys.list();
		request.signal.throwIfAborted();
		const pinned = new Map(trusts.map((key) => [key.host.toLowerCase() + ':' + key.port, key.fingerprint]));
		let hostKeyRejected = false;

		const verify: MachineConnectOptions['verifyHostKey'] = (host, port, publicKey) => {
			const fingerprint = 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/u, '');
			const expected = pinned.get(host.toLowerCase() + ':' + port);
			const trusted =
				expected === fingerprint && (this.verifyHostKey === null || this.verifyHostKey(host, port, publicKey));
			if (!trusted) {
				hostKeyRejected = true;
			}
			return trusted;
		};

		try {
			const remaining = deadline - Date.now();
			if (remaining < 1) {
				throw new Error('Remote machine opening deadline exceeded');
			}
			const machine = await this.ssh.connect(toMachineTarget(target), {
				timeoutMs: remaining,
				signal: request.signal,
				verifyHostKey: verify,
			});
			if (request.signal.aborted || Date.now() >= deadline) {
				try {
					await machine.close();
				} catch (cleanup) {
					throw new RemoteResourceCleanupFailure([new Error('Remote opening expired'), cleanup]);
				}
				throw new Error('Remote opening expired');
			}
			return { target, machine };
		} catch (error) {
			if (hostKeyRejected && !request.signal.aborted && !(error instanceof RemoteResourceCleanupFailure)) {
				throw new RemoteHostKeyUntrustedError(error);
			}
			throw error;
		}
	}
}
