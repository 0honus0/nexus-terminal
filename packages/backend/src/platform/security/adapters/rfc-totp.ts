import { generateSecret, generateURI, verifySync } from 'otplib';
import qrcode from 'qrcode';
import type { TotpPort, TotpSetup } from '../totp-port.js';

export class RfcTotp implements TotpPort {
	async generate(label: string, issuer: string): Promise<TotpSetup> {
		const secret = generateSecret({ length: 20 });
		const uri = generateURI({ secret, label, issuer, algorithm: 'sha1', digits: 6, period: 30 });
		return { secret, qrCodeUrl: await qrcode.toDataURL(uri) };
	}

	verify(secret: string, code: string, now: number): boolean {
		if (!/^[A-Z2-7]{32}$/u.test(secret) || !/^[0-9]{6}$/u.test(code) || !Number.isSafeInteger(now) || now < 0) {
			return false;
		}
		return verifySync({
			secret,
			token: code,
			algorithm: 'sha1',
			digits: 6,
			period: 30,
			epoch: Math.floor(now / 1000),
			epochTolerance: 30,
		}).valid;
	}
}
