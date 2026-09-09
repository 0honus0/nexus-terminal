import axios from 'axios';
import { httpClient } from '@/client/http';
import type { AuthUser, LoginCredentials, LoginResult, SetupCredentials } from '../model/auth';

type NeedsSetupResponse = { needsSetup: boolean };
type AuthStatusResponse = { isAuthenticated: boolean; user?: AuthUser };
type LoginResponse = { user?: AuthUser; requiresTwoFactor?: boolean };
type TwoFactorLoginResponse = { user: AuthUser };

export interface AuthApi {
  needsSetup(): Promise<boolean>;
  readSession(): Promise<AuthUser | null>;
  setup(credentials: SetupCredentials): Promise<void>;
  login(credentials: LoginCredentials): Promise<LoginResult>;
  verifyTwoFactor(token: string): Promise<AuthUser>;
  logout(): Promise<void>;
}

export const authApi: AuthApi = {
  async needsSetup() {
    const response = await httpClient.get<NeedsSetupResponse>('/auth/needs-setup');
    return response.data.needsSetup;
  },

  async readSession() {
    try {
      const response = await httpClient.get<AuthStatusResponse>('/auth/status');
      return response.data.isAuthenticated ? (response.data.user ?? null) : null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) return null;
      throw error;
    }
  },

  async setup(credentials) {
    await httpClient.post('/auth/setup', credentials);
  },

  async login(credentials) {
    const response = await httpClient.post<LoginResponse>('/auth/login', credentials);
    if (response.data.requiresTwoFactor) return { status: 'two-factor-required' };
    if (!response.data.user) throw new Error('Authentication response did not include a user.');
    return { status: 'authenticated', user: response.data.user };
  },

  async verifyTwoFactor(token) {
    const response = await httpClient.post<TwoFactorLoginResponse>('/auth/login/2fa', { token });
    return response.data.user;
  },

  async logout() {
    await httpClient.post('/auth/logout');
  },
};
