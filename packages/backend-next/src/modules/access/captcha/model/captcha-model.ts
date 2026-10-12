import type { CaptchaVerifier } from '../../../../platform/security/captcha-verifier.js';
import { AccessFailure } from '../../access-failure.js';
import type { CaptchaConfiguration } from './captcha-types.js';

/** The Model owns the technical call and maps provider failure to application failure. */
export class CaptchaModel {
	constructor(private readonly verifier: CaptchaVerifier) {}

	async verify(
		config: CaptchaConfiguration,
		token: string,
		sourceIp: string,
		signal?: AbortSignal,
	): Promise<boolean> {
		if (config.provider === 'none') {
			throw new AccessFailure('invalid_input');
		}
		try {
			return await this.verifier.verify({
				provider: config.provider,
				token,
				secret: config.secretKey,
				siteKey: config.siteKey,
				sourceIp,
				expectedHostname: config.expectedHostname ?? '',
				signal,
			});
		} catch (error) {
			throw new AccessFailure('captcha_unavailable', { cause: error });
		}
	}
}
