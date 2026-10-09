import { createHash } from 'node:crypto';
import type { SshTargetSnapshot } from './ssh-target-types.js';
import type { EncodedSshTarget, SshTargetStorage } from '../storage/ssh-target-storage.js';

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
	constructor(private readonly storage: Readonly<SshTargetStorage>) {}

	async fingerprintStored(id: number): Promise<string> {
		return fingerprint(await this.storage.get(id));
	}

	async resolveStored(id: number): Promise<SshTargetSnapshot> {
		return snapshot(await this.storage.get(id));
	}
}
