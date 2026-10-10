import { TargetFailure } from '../../target-failure.js';
import type { SecretBox } from '../../../../platform/security/secret-box.js';
import type { SshTargetModel } from '../model/ssh-target-model.js';
import type { ResolvedSshTarget, ResolvedAuthentication, SshTargetSnapshot } from '../model/ssh-target-types.js';
import type { ResolveSshTargetRequest } from '../model/ssh-target-types.js';
import { validateTargetId } from '../../target-validation.js';

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

export class SshTargetService {
	constructor(
		private readonly model: SshTargetModel,
		private readonly secrets: SecretBox | null,
	) {}

	fingerprintStored(value: number): Promise<string> {
		validateTargetId(value);
		return this.model.fingerprintStored(value);
	}

	/** Trusted backend call only. No HTTP route or serialized response. */
	async resolveStored(request: ResolveSshTargetRequest): Promise<ResolvedSshTarget> {
		validateTargetId(request.targetId);
		if (request.expectedFingerprint !== undefined && !/^[a-f0-9]{64}$/u.test(request.expectedFingerprint)) {
			throw new TargetFailure('invalid_input');
		}
		if (!this.secrets) {
			throw new TargetFailure('unresolvable');
		}
		return decrypt(await this.model.resolveStored({
			targetId: request.targetId,
			...(request.expectedFingerprint === undefined ? {} : { expectedFingerprint: request.expectedFingerprint }),
		}), this.secrets);
	}
}
