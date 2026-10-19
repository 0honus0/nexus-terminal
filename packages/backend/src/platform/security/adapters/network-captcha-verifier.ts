import type { CaptchaVerifier, CaptchaVerification } from '../captcha-verifier.js';
import { CaptchaTransportFailure } from '../captcha-verifier.js';

const MAX_PROVIDER_BODY_BYTES = 16_384;

async function readProviderBody(response: Response): Promise<string> {
	if (response.body === null) {
		throw new CaptchaTransportFailure();
	}
	const reader = response.body.getReader();
	const parts: Uint8Array[] = [];
	let length = 0;
	try {
		if (!response.ok) {
			throw new CaptchaTransportFailure();
		}
		for (;;) {
			const part = await reader.read();
			if (part.done) {
				break;
			}
			length += part.value.byteLength;
			if (length > MAX_PROVIDER_BODY_BYTES) {
				throw new CaptchaTransportFailure();
			}
			parts.push(part.value);
		}
		return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
	} catch (error) {
		try {
			await reader.cancel();
		} catch (cleanupError) {
			throw new CaptchaTransportFailure({
				cause: new AggregateError([error, cleanupError], 'CAPTCHA read and cancellation failed'),
			});
		}
		throw error;
	} finally {
		reader.releaseLock();
	}
}

export class NetworkCaptchaVerifier implements CaptchaVerifier {
	async verify(command: CaptchaVerification): Promise<boolean> {
		const endpoint =
			command.provider === 'hcaptcha'
				? 'https://api.hcaptcha.com/siteverify'
				: 'https://www.google.com/recaptcha/api/siteverify';
		const body = new URLSearchParams({
			secret: command.secret,
			response: command.token,
			remoteip: command.sourceIp,
		});
		if (command.provider === 'hcaptcha') {
			body.set('sitekey', command.siteKey);
		}
		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
				signal: command.signal
					? AbortSignal.any([command.signal, AbortSignal.timeout(10_000)])
					: AbortSignal.timeout(10_000),
				redirect: 'error',
			});
			const bodyText = await readProviderBody(response);
			const result: unknown = JSON.parse(bodyText);
			if (
				result === null ||
				typeof result !== 'object' ||
				Array.isArray(result) ||
				!('success' in result) ||
				typeof result.success !== 'boolean'
			) {
				throw new CaptchaTransportFailure();
			}
			if (!result.success) {
				return false;
			}
			// This integration accepts browser checkbox challenges only, not v3's
			// score/action protocol. A response for another host must fail closed.
			return (
				'hostname' in result &&
				result.hostname === command.expectedHostname &&
				(command.provider !== 'recaptcha' || (!('action' in result) && !('score' in result)))
			);
		} catch (error) {
			if (error instanceof CaptchaTransportFailure) {
				throw error;
			}
			throw new CaptchaTransportFailure({ cause: error });
		}
	}
}
