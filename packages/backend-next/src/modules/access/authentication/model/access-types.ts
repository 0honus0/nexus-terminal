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
	| { status: 'invalid_credentials' }
	| { status: 'rate_limited' }
	| { status: 'factor_unavailable' }
	| { status: 'captcha_invalid' };
