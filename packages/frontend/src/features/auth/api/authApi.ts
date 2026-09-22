import axios from 'axios';
import type {
  AuthLoginRequestDto,
  AuthLoginResponseDto,
  AuthNeedsSetupResponseDto,
  AuthSetupRequestDto,
  AuthStatusResponseDto,
  AuthTwoFactorLoginRequestDto,
  AuthTwoFactorLoginResponseDto,
} from '@nexus-terminal/protocol/auth';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';
import type { AuthUserDto, AuthLoginResultViewModel } from '../model/auth';

export interface AuthApi {
  needsSetup(): Promise<boolean>;
  readSession(): Promise<AuthUserDto | null>;
  setup(credentials: AuthSetupRequestDto): Promise<void>;
  login(credentials: AuthLoginRequestDto): Promise<AuthLoginResultViewModel>;
  verifyTwoFactor(token: string): Promise<AuthUserDto>;
  logout(): Promise<void>;
}

export const authApi: AuthApi = {
  async needsSetup() {
    const response = await httpClient.get<AuthNeedsSetupResponseDto>('/auth/needs-setup');
    return response.data.needsSetup;
  },

  async readSession() {
    try {
      const response = await httpClient.get<AuthStatusResponseDto>('/auth/status');
      return response.data.isAuthenticated ? response.data.user : null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) return null;
      throw error;
    }
  },

  async setup(credentials) {
    const request: AuthSetupRequestDto = credentials;
    await httpClient.post<MessageResponseDto>('/auth/setup', request);
  },

  async login(credentials) {
    const request: AuthLoginRequestDto = credentials;
    const response = await httpClient.post<AuthLoginResponseDto>('/auth/login', request);
    if (response.data.requiresTwoFactor) return { status: 'two-factor-required' };
    if (!response.data.user) throw new Error('Authentication response did not include a user.');
    return { status: 'authenticated', user: response.data.user };
  },

  async verifyTwoFactor(token) {
    const request: AuthTwoFactorLoginRequestDto = { token };
    const response = await httpClient.post<AuthTwoFactorLoginResponseDto>('/auth/login/2fa', request);
    return response.data.user;
  },

  async logout() {
    await httpClient.post<MessageResponseDto>('/auth/logout');
  },
};
