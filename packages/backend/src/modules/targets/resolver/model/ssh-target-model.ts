import type { ProxyType } from '@nexus-terminal/shared/targets/proxies/values';
import { targetModelFailure } from '../../model/target-technical-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import { createHash } from 'node:crypto';
import type { ResolveSshTargetRequest } from './ssh-target-types.js';
import { TargetFailure } from '../../target-failure.js';
import type { EncodedSshTarget, SshTargetStorage } from '../storage/ssh-target-storage.js';
import { SshTargetStorageRefusal } from '../storage/ssh-target-storage.js';
import type {
	ResolvedSshTarget,
	ResolvedAuthentication,
	ResolvedUnsavedSshTarget,
	UnsavedSshTargetInput,
	SshResolutionLimits,
} from './ssh-target-types.js';

/** Internal ciphertext snapshot. Each fingerprint comes from the same storage read. */
interface SshTargetSnapshot {
	id: number;
	host: string;
	port: number;
	username: string;
	credential:
		| { kind: 'password'; ciphertext: string }
		| { kind: 'ssh_key'; keyId: number; privateKey: string; passphrase: string | null };
	proxy: {
		id: number;
		type: ProxyType;
		host: string;
		port: number;
		username: string | null;
		ciphertext: string | null;
	} | null;
	fingerprint: string;
	jumps: SshTargetSnapshot[];
}

interface UnsavedSshTargetReferences {
	key: { privateKey: string; passphrase: string | null } | null;
	proxy: SshTargetSnapshot['proxy'];
	jumps: SshTargetSnapshot[];
}

function decrypt(source: SshTargetSnapshot, secrets: SecretBox): ResolvedSshTarget {
	const credential = source.credential;
	const authentication: ResolvedAuthentication =
		credential.kind === 'password'
			? { kind: 'password', password: secrets.decrypt(credential.ciphertext, 'connection:password') }
			: {
					kind: 'ssh_key',
					privateKey: secrets.decrypt(credential.privateKey, 'ssh-key:private'),
					passphrase:
						credential.passphrase === null
							? null
							: secrets.decrypt(credential.passphrase, 'ssh-key:passphrase'),
				};
	const proxyRecord = source.proxy;
	const proxy = proxyRecord
		? {
				type: proxyRecord.type,
				host: proxyRecord.host,
				port: proxyRecord.port,
				username: proxyRecord.username,
				password:
					proxyRecord.ciphertext === null ? null : secrets.decrypt(proxyRecord.ciphertext, 'proxy:password'),
			}
		: null;
	const jumps = source.jumps.map((item) => decrypt(item, secrets));
	return Object.freeze({
		id: source.id,
		host: source.host,
		port: source.port,
		username: source.username,
		authentication: Object.freeze(authentication),
		proxy: proxy ? Object.freeze(proxy) : null,
		jumps: Object.freeze(jumps),
		fingerprint: source.fingerprint,
	});
}

function fingerprint(encoded: EncodedSshTarget): string {
	// Machine configuration, reference identities and ciphertext determine the digest; plaintext is excluded.
	return createHash('sha256').update(JSON.stringify(encoded), 'utf8').digest('hex');
}

function snapshot(source: EncodedSshTarget): SshTargetSnapshot {
	const credential = source.credential;
	const proxy = source.proxy;
	return {
		id: source.id,
		host: source.host,
		port: source.port,
		username: source.username,
		credential:
			credential.kind === 'password'
				? { kind: 'password', ciphertext: credential.ciphertext }
				: {
						kind: 'ssh_key',
						keyId: credential.keyId,
						privateKey: credential.privateKey,
						passphrase: credential.passphrase,
					},
		proxy:
			proxy === null
				? null
				: {
						id: proxy.id,
						type: proxy.type,
						host: proxy.host,
						port: proxy.port,
						username: proxy.username,
						ciphertext: proxy.ciphertext,
					},
		jumps: source.jumps.map(snapshot),
		fingerprint: fingerprint(source),
	};
}

export class SshTargetModel {
	constructor(
		private readonly storage: Readonly<SshTargetStorage>,
		private readonly secrets: SecretBox | null,
	) {}

	private async lookup<T>(work: () => Promise<T>): Promise<T> {
		try {
			return await work();
		} catch (error) {
			if (error instanceof SshTargetStorageRefusal) {
				throw new TargetFailure(
					error.reason === 'missing_reference'
						? 'reference_not_found'
						: error.reason === 'invalid_graph'
							? 'invalid_input'
							: 'unresolvable',
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async fingerprintStored(id: number, limits: SshResolutionLimits): Promise<string> {
		return fingerprint(
			await this.lookup(() =>
				this.storage
					.get(id, { maxDepth: limits.maxJumpEdges, maxExpanded: limits.maxExpandedTargets })
					.catch(targetModelFailure),
			),
		);
	}

	async resolveStored(request: ResolveSshTargetRequest, limits: SshResolutionLimits): Promise<ResolvedSshTarget> {
		const current = snapshot(
			await this.lookup(() =>
				this.storage
					.get(request.targetId, {
						maxDepth: limits.maxJumpEdges,
						maxExpanded: limits.maxExpandedTargets,
					})
					.catch(targetModelFailure),
			),
		);
		if (request.expectedFingerprint !== undefined && current.fingerprint !== request.expectedFingerprint) {
			throw new TargetFailure('conflict');
		}
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		return this.decryptTarget(current);
	}

	private async references(
		request: UnsavedSshTargetInput,
		limits: SshResolutionLimits,
	): Promise<UnsavedSshTargetReferences> {
		const result = await this.lookup(() =>
			this.storage
				.references(
					{
						sshKeyId: request.authentication.kind === 'ssh_key' ? request.authentication.sshKeyId : null,
						proxyId: request.proxyId,
						jumpIds: request.jumpIds.map((id) => id),
					},
					{ maxDepth: limits.maxJumpEdges, maxExpanded: limits.maxExpandedTargets },
				)
				.catch(targetModelFailure),
		);
		const proxy = result.proxy;
		return {
			key: result.key === null ? null : { privateKey: result.key.privateKey, passphrase: result.key.passphrase },
			proxy:
				proxy === null
					? null
					: {
							id: proxy.id,
							type: proxy.type,
							host: proxy.host,
							port: proxy.port,
							username: proxy.username,
							ciphertext: proxy.ciphertext,
						},
			jumps: result.jumps.map(snapshot),
		};
	}

	async resolveUnsaved(
		request: UnsavedSshTargetInput,
		limits: SshResolutionLimits,
	): Promise<ResolvedUnsavedSshTarget> {
		const references = await this.references(request, limits);
		const auth = request.authentication;
		const key = references.key,
			proxy = references.proxy,
			secrets = this.secrets;
		let authentication: ResolvedAuthentication;
		if (auth.kind === 'password') {
			authentication = { kind: 'password', password: auth.password };
		} else if (auth.kind === 'private_key') {
			authentication = { kind: 'ssh_key', privateKey: auth.privateKey, passphrase: auth.passphrase };
		} else {
			if (!key || !secrets) {
				throw new TargetFailure('unresolvable');
			}
			authentication = {
				kind: 'ssh_key',
				privateKey: this.decryptSecret(key.privateKey, 'ssh-key:private'),
				passphrase: key.passphrase === null ? null : this.decryptSecret(key.passphrase, 'ssh-key:passphrase'),
			};
		}
		return {
			host: request.host.trim(),
			port: request.port,
			username: request.username,
			authentication,
			proxy:
				proxy === null
					? null
					: {
							type: proxy.type,
							host: proxy.host,
							port: proxy.port,
							username: proxy.username,
							password:
								proxy.ciphertext === null
									? null
									: this.decryptSecret(proxy.ciphertext, 'proxy:password'),
						},
			jumps: references.jumps.map((item) => this.decryptTarget(item)),
		};
	}

	private decryptSecret(ciphertext: string, scope: string): string {
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		try {
			return this.secrets.decrypt(ciphertext, scope);
		} catch (cause) {
			return targetModelFailure(cause);
		}
	}

	private decryptTarget(target: SshTargetSnapshot): ResolvedSshTarget {
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		try {
			return decrypt(target, this.secrets);
		} catch (cause) {
			return targetModelFailure(cause);
		}
	}
}
