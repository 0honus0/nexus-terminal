import type { CaptchaConfiguration, CaptchaPublicConfiguration } from '../model/captcha-types.js';
import type { CaptchaModel } from '../model/captcha-model.js';
import { AccessFailure } from '../../authentication/model/access-failure.js';
import { ACCESS_CAPTCHA_TOKEN_MAX_BYTES } from '@nexus-terminal/shared/access/values';

export class CaptchaService {
	private readonly config: CaptchaConfiguration;

	constructor(
		config: CaptchaConfiguration,
		private readonly model: CaptchaModel,
	) {
		if (
			typeof config.enabled !== 'boolean' ||
			!['none', 'hcaptcha', 'recaptcha'].includes(config.provider) ||
			(config.enabled &&
				(config.provider === 'none' ||
					!config.siteKey.trim() ||
					!config.secretKey.trim() ||
					!config.expectedHostname ||
					!/^[a-z0-9.-]+$/iu.test(config.expectedHostname))) ||
			Buffer.byteLength(config.siteKey, 'utf8') > 1024 ||
			Buffer.byteLength(config.secretKey, 'utf8') > 1024 ||
			(config.expectedHostname !== undefined && Buffer.byteLength(config.expectedHostname, 'utf8') > 253)
		) {
			throw new Error('Invalid Access CAPTCHA configuration');
		}
		this.config = {
			enabled: config.enabled,
			provider: config.provider,
			siteKey: config.siteKey,
			secretKey: config.secretKey,
			expectedHostname: config.expectedHostname,
		};
	}

	publicConfig(): CaptchaPublicConfiguration {
		const { enabled, provider, siteKey } = this.config;
		return {
			enabled,
			provider,
			hcaptchaSiteKey: provider === 'hcaptcha' ? siteKey : '',
			recaptchaSiteKey: provider === 'recaptcha' ? siteKey : '',
		};
	}

	async verify(token: string | undefined, sourceIp: string, signal?: AbortSignal): Promise<boolean> {
		if (!this.config.enabled) {
			return true;
		}
		if (
			typeof token !== 'string' ||
			token.length === 0 ||
			Buffer.byteLength(token, 'utf8') > ACCESS_CAPTCHA_TOKEN_MAX_BYTES
		) {
			throw new AccessFailure('invalid_input');
		}
		return this.model.verify(this.config, token, sourceIp, signal);
	}
}
