import type { TrustedResolvedSshTarget } from '../../../targets/public.js';
import type { MachineEndpoint, MachineAuthentication, MachineProxy } from '../../../../platform/ssh/ssh-port.js';

/** Remote owns business target → generic machine contract transformation. */
export function toMachineTarget(target: TrustedResolvedSshTarget): MachineEndpoint {
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
	const route =
		target.jumps.length > 0
			? { kind: 'jump' as const, hops: target.jumps.map((hop) => toMachineTarget(hop)) }
			: proxyInput === null
				? { kind: 'direct' as const }
				: { kind: 'proxy' as const, proxy: proxyInput };
	return {
		host: target.host,
		port: target.port,
		username: target.username,
		authentication,
		route,
	};
}
