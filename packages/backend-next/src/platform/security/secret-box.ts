import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Encryption-only technical capability; no business fields or database access. */
export class SecretBox {
	private readonly key: Buffer;

	constructor(key: Uint8Array) {
		if (key.byteLength !== 32) throw new Error('Encryption key must be 32 bytes');
		this.key = Buffer.from(key);
	}

	encrypt(value: string, scope: string): string {
		if (!value || !scope) throw new Error('Empty credential or encryption scope');
		const nonce = randomBytes(12);
		const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
		cipher.setAAD(Buffer.from(scope));
		const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
		return [
			'v1',
			nonce.toString('base64url'),
			cipher.getAuthTag().toString('base64url'),
			encrypted.toString('base64url'),
		].join('.');
	}

	decrypt(value: string, scope: string): string {
		const parts = value.split('.');
		if (parts.length !== 4 || parts[0] !== 'v1' || !scope) throw new Error('Invalid encrypted credential');
		const nonce = Buffer.from(parts[1], 'base64url');
		const tag = Buffer.from(parts[2], 'base64url');
		if (nonce.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted credential');
		const decipher = createDecipheriv('aes-256-gcm', this.key, nonce);
		decipher.setAAD(Buffer.from(scope));
		decipher.setAuthTag(tag);
		try {
			return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString(
				'utf8',
			);
		} catch {
			throw new Error('Credential authentication failed');
		}
	}
}
