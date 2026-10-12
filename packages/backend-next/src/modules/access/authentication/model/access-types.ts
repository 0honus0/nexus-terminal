export interface AuthenticatedIdentity {
	userId: number;
	username: string;
	twoFactorEnabled: boolean;
}

export interface PasswordLogin {
	username: string;
	password: string;
	rememberMe: boolean;
	source: string;
	captchaToken?: string;
	/** Existing browser partial bearer, only for replacement after valid credentials. */
	previousPartialToken?: string | null;
	/** Response delivery cancelled; a dispatched DB write still needs unknown-outcome handling. */
	signal?: AbortSignal;
}

export type LoginAttempt =
	| {
			status: 'authenticated';
			token: string;
			identity: AuthenticatedIdentity;
			expiresAt: number;
			rememberMe: boolean;
	  }
	| { status: 'requires_two_factor'; token: string; expiresAt: number }
	| { status: 'invalid_credentials' }
	| { status: 'rate_limited' }
	| { status: 'limit_exceeded' }
	| { status: 'factor_unavailable' }
	| { status: 'captcha_invalid' };
