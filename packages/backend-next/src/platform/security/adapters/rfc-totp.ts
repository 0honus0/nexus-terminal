import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import qrcode from 'qrcode';
import type { TotpPort, TotpSetup } from '../totp-port.js';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let output = '';
	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			output += ALPHABET[(value >>> bits) & 31];
		}
	}
	if (bits > 0) {
		output += ALPHABET[(value << (5 - bits)) & 31];
	}
	return output;
}

function decodeBase32(value: string): Buffer | null {
	if (!/^[A-Z2-7]{32}$/u.test(value)) {
		return null;
	}
	let buffer = 0;
	let bits = 0;
	const bytes: number[] = [];
	for (const char of value) {
		buffer = (buffer << 5) | ALPHABET.indexOf(char);
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >>> bits) & 0xff);
		}
	}
	return Buffer.from(bytes);
}

export class RfcTotp implements TotpPort {
	async generate(label: string, issuer: string): Promise<TotpSetup> {
		const secret = encodeBase32(randomBytes(20));
		const uri =
			'otpauth://totp/' +
			encodeURIComponent(label) +
			'?secret=' +
			secret +
			'&issuer=' +
			encodeURIComponent(issuer) +
			'&algorithm=SHA1&digits=6&period=30';
		return { secret, qrCodeUrl: await qrcode.toDataURL(uri) };
	}

	verify(secret: string, code: string, now: number): boolean {
		if (!/^[0-9]{6}$/u.test(code)) {
			return false;
		}
		const key = decodeBase32(secret);
		if (key === null) {
			return false;
		}
		const counter = Math.floor(now / 30_000);
		for (let delta = -1; delta <= 1; delta++) {
			const message = Buffer.alloc(8);
			message.writeBigUInt64BE(BigInt(counter + delta));
			const hmac = createHmac('sha1', key).update(message).digest();
			const lastByte = hmac[hmac.length - 1];
			if (lastByte === undefined) {
				throw new Error('Unexpected TOTP digest length');
			}
			const offset = lastByte & 15;
			const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
			if (timingSafeEqual(Buffer.from(String(value).padStart(6, '0')), Buffer.from(code))) {
				return true;
			}
		}
		return false;
	}
}
