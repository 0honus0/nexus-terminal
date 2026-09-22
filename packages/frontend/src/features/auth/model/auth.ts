import type { AuthLoginRequestDto, AuthSetupRequestDto, AuthUserDto } from '@nexus-terminal/protocol/auth';

export type AuthUser = AuthUserDto;
export type LoginCredentials = AuthLoginRequestDto;
export type SetupCredentials = AuthSetupRequestDto;

export type LoginResult = { status: 'authenticated'; user: AuthUser } | { status: 'two-factor-required' };

export type SetupState = 'unknown' | 'required' | 'complete';
export type AuthSessionState = 'unknown' | 'anonymous' | 'authenticated';
