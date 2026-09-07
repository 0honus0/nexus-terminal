export interface AuthUser {
  id: number;
  username: string;
  twoFactorEnabled?: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
  captchaToken?: string;
}

export interface SetupCredentials {
  username: string;
  password: string;
  confirmPassword: string;
}

export type LoginResult = { status: 'authenticated'; user: AuthUser } | { status: 'two-factor-required' };

export type SetupState = 'unknown' | 'required' | 'complete';
export type AuthSessionState = 'unknown' | 'anonymous' | 'authenticated';
