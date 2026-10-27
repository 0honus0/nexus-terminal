import type { AccessCaptchaProvider } from '@nexus-terminal/shared/access/values';

export interface CaptchaConfiguration {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	siteKey: string;
	secretKey: string;
	/** Exact public browser hostname; bind provider success to this application. */
	expectedHostname?: string;
}

export interface CaptchaPublicConfiguration {
	enabled: boolean;
	provider: AccessCaptchaProvider;
	hcaptchaSiteKey: string;
	recaptchaSiteKey: string;
}
