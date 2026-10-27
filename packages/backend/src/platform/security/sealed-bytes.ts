import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { SecretBoxFailure, type SecretBox } from './secret-box.js';

const MAGIC = Buffer.from('NXSEALED2\n', 'ascii');
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const ITERATIONS = 210_000;
const WRAPPED_KEY_BYTES = NONCE_BYTES + TAG_BYTES + KEY_BYTES;
const FIXED_HEADER_BYTES = MAGIC.length + SALT_BYTES + WRAPPED_KEY_BYTES + 2;
const MAX_INSTANCE_KEY_BYTES = 256;
const INSTANCE_SCOPE = 'sealed-bytes:key:v2';

export class SealedBytesFailure extends Error {
	constructor(
		readonly kind:
			'invalid_input' | 'limit_exceeded' | 'password_required' | 'authentication_failed' | 'unavailable',
		options?: ErrorOptions,
	) {
		super('Sealed bytes failed: ' + kind, options);
		this.name = 'SealedBytesFailure';
	}
}

function passwordKey(password: string, salt: Uint8Array): Promise<Buffer> {
	if (
		!password ||
		Buffer.byteLength(password, 'utf8') > 8192 ||
		Buffer.from(password).toString('utf8') !== password
	) {
		throw new SealedBytesFailure('invalid_input');
	}
	return new Promise((resolve, reject) => {
		pbkdf2(password, salt, ITERATIONS, KEY_BYTES, 'sha256', (error, key) => {
			if (error) {
				reject(new SealedBytesFailure('unavailable', { cause: error }));
			} else {
				resolve(key);
			}
		});
	});
}

function encrypt(plain: Uint8Array, key: Uint8Array, aad: Uint8Array): Buffer {
	const nonce = randomBytes(NONCE_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(aad);
	const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
	return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

function decrypt(bytes: Uint8Array, key: Uint8Array, aad: Uint8Array): Buffer {
	const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, NONCE_BYTES));
	cipher.setAAD(aad);
	cipher.setAuthTag(bytes.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
	return Buffer.concat([cipher.update(bytes.subarray(NONCE_BYTES + TAG_BYTES)), cipher.final()]);
}

/** Fixed authenticated binary envelope. Application formats and limits belong to its consumer. */
export class SealedBytes {
	constructor(
		private readonly maxPlainBytes: number,
		private readonly instance: SecretBox | null,
	) {
		if (!Number.isSafeInteger(maxPlainBytes) || maxPlainBytes < 1) {
			throw new SealedBytesFailure('invalid_input');
		}
	}

	async encode(plain: Uint8Array, password: string): Promise<Uint8Array> {
		if (plain.byteLength > this.maxPlainBytes) {
			throw new SealedBytesFailure('limit_exceeded');
		}
		const salt = randomBytes(SALT_BYTES);
		const passwordSecret = await passwordKey(password, salt);
		const dataKey = randomBytes(KEY_BYTES);
		try {
			const prefix = Buffer.concat([MAGIC, salt]);
			const passwordWrapped = encrypt(dataKey, passwordSecret, prefix);
			const instanceWrapped = Buffer.from(
				this.instance?.encrypt(dataKey.toString('base64url'), INSTANCE_SCOPE) ?? '',
				'ascii',
			);
			const length = Buffer.alloc(2);
			length.writeUInt16BE(instanceWrapped.byteLength);
			const header = Buffer.concat([prefix, passwordWrapped, length, instanceWrapped]);
			return Buffer.concat([header, encrypt(plain, dataKey, header)]);
		} finally {
			passwordSecret.fill(0);
			dataKey.fill(0);
		}
	}

	private instanceKey(wrapped: Uint8Array): Buffer | null {
		if (!wrapped.byteLength || !this.instance) {
			return null;
		}
		try {
			const encoded = this.instance.decrypt(Buffer.from(wrapped).toString('ascii'), INSTANCE_SCOPE);
			const key = Buffer.from(encoded, 'base64url');
			if (key.byteLength === KEY_BYTES && key.toString('base64url') === encoded) {
				return key;
			}
			key.fill(0);
			return null;
		} catch (cause) {
			if (cause instanceof SecretBoxFailure) {
				return null;
			}
			throw new SealedBytesFailure('unavailable', { cause });
		}
	}

	async decode(input: Uint8Array, password?: string): Promise<Uint8Array> {
		if (
			input.byteLength >
			this.maxPlainBytes + FIXED_HEADER_BYTES + MAX_INSTANCE_KEY_BYTES + NONCE_BYTES + TAG_BYTES
		) {
			throw new SealedBytesFailure('limit_exceeded');
		}
		const bytes = Buffer.from(input);
		if (
			bytes.length < FIXED_HEADER_BYTES + NONCE_BYTES + TAG_BYTES ||
			!bytes.subarray(0, MAGIC.length).equals(MAGIC)
		) {
			throw new SealedBytesFailure('invalid_input');
		}
		const instanceLength = bytes.readUInt16BE(FIXED_HEADER_BYTES - 2);
		const headerLength = FIXED_HEADER_BYTES + instanceLength;
		if (instanceLength > MAX_INSTANCE_KEY_BYTES || bytes.length < headerLength + NONCE_BYTES + TAG_BYTES) {
			throw new SealedBytesFailure('invalid_input');
		}
		if (bytes.length - headerLength - NONCE_BYTES - TAG_BYTES > this.maxPlainBytes) {
			throw new SealedBytesFailure('limit_exceeded');
		}
		const prefix = bytes.subarray(0, MAGIC.length + SALT_BYTES);
		const header = bytes.subarray(0, headerLength);
		let dataKey = this.instanceKey(bytes.subarray(FIXED_HEADER_BYTES, headerLength));
		if (!dataKey) {
			if (!password) {
				throw new SealedBytesFailure('password_required');
			}
			const key = await passwordKey(password, prefix.subarray(MAGIC.length));
			try {
				dataKey = decrypt(bytes.subarray(prefix.length, prefix.length + WRAPPED_KEY_BYTES), key, prefix);
			} catch (cause) {
				throw new SealedBytesFailure('authentication_failed', { cause });
			} finally {
				key.fill(0);
			}
		}
		try {
			return decrypt(bytes.subarray(headerLength), dataKey, header);
		} catch (cause) {
			throw new SealedBytesFailure('authentication_failed', { cause });
		} finally {
			dataKey.fill(0);
		}
	}
}
