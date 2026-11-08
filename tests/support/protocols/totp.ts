import { createHmac } from 'node:crypto';

// Independent RFC 6238 fixture; does not call the production verifier.
export function totpCode(secret: string, now = Date.now()): string {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid fixture TOTP secret');
	const bits = [...secret].map((char) => alphabet.indexOf(char).toString(2).padStart(5, '0')).join('');
	const bytes: number[] = [];
	for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
	const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
	return String((digest.readUInt32BE(digest[digest.length - 1] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function invalidTotpCode(secret: string): string {
	const now = Date.now();
	// Exclude adjacent windows too, so a clock boundary cannot make the negative case valid.
	const accepted = new Set([-2, -1, 0, 1, 2].map((offset) => totpCode(secret, now + offset * 30_000)));
	for (let candidate = 0; candidate < 1_000_000; candidate++) {
		const token = String(candidate).padStart(6, '0');
		if (!accepted.has(token)) return token;
	}
	throw new Error('Unable to choose an invalid TOTP fixture');
}
