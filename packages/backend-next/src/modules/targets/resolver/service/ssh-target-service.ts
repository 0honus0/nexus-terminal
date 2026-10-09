import type { SecretBox } from '../../../../platform/security/secret-box.js';
import { SshTargetModel, type SshTargetSnapshot } from '../model/ssh-target-model.js';
import type { ResolvedSshTarget } from '../model/resolved-target.js';

function decrypt(source: SshTargetSnapshot, secrets: SecretBox): ResolvedSshTarget {
	const c = source.credential;
	const authentication =
		c.kind === 'password'
			? { kind: 'password' as const, password: secrets.decrypt(c.ciphertext, 'connection:password') }
			: {
					kind: 'ssh_key' as const,
					privateKey: secrets.decrypt(c.privateKey, 'ssh-key:private'),
					passphrase: c.passphrase === null ? null : secrets.decrypt(c.passphrase, 'ssh-key:passphrase'),
				};
	const p = source.proxy;
	const proxy = p
		? {
				type: p.type,
				host: p.host,
				port: p.port,
				username: p.username,
				password: p.ciphertext === null ? null : secrets.decrypt(p.ciphertext, 'proxy:password'),
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

export class SshTargetService {
	constructor(
		private readonly model: SshTargetModel,
		private readonly secrets: SecretBox | null,
	) {}

	private id(value: number) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new Error('Invalid target ID');
		}
	}

	fingerprintStored(value: number) {
		this.id(value);
		return this.model.fingerprintStored(value);
	}

	/** Trusted backend call only. No HTTP route or serialized response. */
	async resolveStored(value: number): Promise<ResolvedSshTarget> {
		this.id(value);
		if (!this.secrets) {
			throw new Error('Encryption key required');
		}
		return decrypt(await this.model.resolveStored(value), this.secrets);
	}
}
