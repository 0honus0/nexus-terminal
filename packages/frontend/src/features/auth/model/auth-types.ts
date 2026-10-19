import type { AccessLoginRequest, AccessSetupRequest } from '@nexus-terminal/shared/access/http';

export type AuthLoginRequest = AccessLoginRequest;

export type AuthSetupRequest = AccessSetupRequest;

/** Browser application state, explicitly projected from the Access wire object. */
export interface AuthUser {
	id: number;
	username: string;
	twoFactorEnabled: boolean;
}

export type AuthLoginResult = { status: 'authenticated'; user: AuthUser } | { status: 'two-factor-required' };

export type SetupState = 'unknown' | 'required' | 'complete';

export type AuthSessionState = 'unknown' | 'anonymous' | 'authenticated';

export interface PasskeyLoginInput {
	username?: string;
	rememberMe: boolean;
}
