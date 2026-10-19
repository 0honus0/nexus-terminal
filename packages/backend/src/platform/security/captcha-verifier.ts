export type CaptchaProtocol = 'hcaptcha' | 'recaptcha';

export interface CaptchaVerification {
	provider: CaptchaProtocol;
	token: string;
	secret: string;
	siteKey: string;
	sourceIp: string;
	expectedHostname: string;
	signal?: AbortSignal;
}

export interface CaptchaVerifier {
	verify(command: CaptchaVerification): Promise<boolean>;
}

/** Technical provider/transport failures, not negative verification verdicts. */
export class CaptchaTransportFailure extends Error {
	constructor(options?: ErrorOptions) {
		super('CAPTCHA provider unavailable', options);
		this.name = 'CaptchaTransportFailure';
	}
}
