import type { AuthLoginRequestDto, AuthSetupRequestDto, AuthUserDto } from '@nexus-terminal/protocol/auth';
export type { AuthLoginRequestDto, AuthSetupRequestDto, AuthUserDto };

export type AuthLoginResultViewModel =
  { status: 'authenticated'; user: AuthUserDto } | { status: 'two-factor-required' };

export type SetupState = 'unknown' | 'required' | 'complete';
export type AuthSessionState = 'unknown' | 'anonymous' | 'authenticated';
