import { createHash } from 'node:crypto';
import type { ProxyType } from '@nexus-terminal/shared/proxies/values';
import type { EncodedSshTarget, SshTargetStorage } from '../storage/ssh-target-storage.js';

/** Internal ciphertext snapshot. Each fingerprint comes from the same storage read. */
export interface SshTargetSnapshot {
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

function fingerprint(encoded: EncodedSshTarget): string {
	// Ciphertext and dependent versions participate, plaintext never enters the digest input.
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
