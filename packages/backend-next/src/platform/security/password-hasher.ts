import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function derive(password: string, salt: Buffer): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		scrypt(password, salt, KEY_LENGTH, COST, (error, derived) => {
			if (error) {
				reject(error);
			} else {
				resolve(derived);
			}
		});
	});
}

export interface PasswordHasher {
	hash(password: string): Promise<string>;
	verify(password: string, encodedHash: string): Promise<boolean>;
}

/** A versioned, salted memory-hard verifier. Never expose hashes to HTTP or public account views. */
export class ScryptPasswordHasher implements PasswordHasher {
	async hash(password: string): Promise<string> {
		const salt = randomBytes(16);
		const digest = await derive(password, salt);
		return ['scrypt', '1', salt.toString('base64url'), digest.toString('base64url')].join('$');
	}

	async verify(password: string, encodedHash: string): Promise<boolean> {
		const fields = encodedHash.split('$');
		if (fields.length !== 4 || fields[0] !== 'scrypt' || fields[1] !== '1') {
			throw new Error('Unsupported password hash format');
		}
		const salt = Buffer.from(fields[2], 'base64url');
		const expected = Buffer.from(fields[3], 'base64url');
		if (salt.length !== 16 || expected.length !== KEY_LENGTH) {
			throw new Error('Corrupt password verifier');
		}
		const actual = await derive(password, salt);
		return timingSafeEqual(expected, actual);
	}
}
