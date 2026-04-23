import { describe, expect, it, vi } from 'vitest';
import { Request } from 'express';
import { SECURITY_CONFIG } from '../config/security.config';
import {
  mapPasskeyAuthenticationVerificationResult,
  mapPasskeyRegistrationVerificationResult,
  persistPasskeyChallengeSession,
  resolvePasskeyAuthenticationContext,
  resolvePasskeyCredentialId,
  resolvePasskeyRegistrationContext,
} from './auth-passkey-flow.utils';

describe('auth-passkey-flow.utils', () => {
  describe('persistPasskeyChallengeSession', () => {
    it('应写入 challenge 并保存 userHandle', async () => {
      const req = {
        session: {
          save: vi.fn((callback: (err?: Error) => void) => callback()),
        },
      } as unknown as Request;

      await persistPasskeyChallengeSession(req, {
        challenge: 'challenge-1',
        origin: 'https://nexus.example',
        userHandle: '7',
        now: 12345,
      });

      const session = req.session as unknown as {
        currentChallenge?: { challenge: string; timestamp: number; origin?: string };
        passkeyUserHandle?: string;
      };
      expect(session.currentChallenge).toEqual({
        challenge: 'challenge-1',
        timestamp: 12345,
        origin: 'https://nexus.example',
      });
      expect(session.passkeyUserHandle).toBe('7');
    });

    it('应按 clearUserHandle 清理旧 userHandle', async () => {
      const req = {
        session: {
          passkeyUserHandle: 'old',
          save: vi.fn((callback: (err?: Error) => void) => callback()),
        },
      } as unknown as Request;

      await persistPasskeyChallengeSession(req, {
        challenge: 'challenge-2',
        clearUserHandle: true,
      });

      const session = req.session as unknown as {
        passkeyUserHandle?: string;
      };
      expect(session.passkeyUserHandle).toBeUndefined();
    });
  });

  describe('resolvePasskeyRegistrationContext', () => {
    it('缺少 registrationResponse 时返回 400', () => {
      const req = {
        session: {},
      } as unknown as Request;

      const result = resolvePasskeyRegistrationContext({
        req,
        registrationResponse: undefined,
      });

      expect(result).toEqual({
        ok: false,
        failure: {
          statusCode: 400,
          body: { message: '注册响应不能为空。' },
        },
      });
    });

    it('缺少 challenge 时返回 400', () => {
      const req = {
        session: {
          passkeyUserHandle: '1',
        },
      } as unknown as Request;

      const result = resolvePasskeyRegistrationContext({
        req,
        registrationResponse: { id: 'cred-1' },
      });

      expect(result).toEqual({
        ok: false,
        failure: {
          statusCode: 400,
          body: { message: '会话中未找到质询信息，请重试注册流程。' },
        },
      });
    });

    it('challenge 过期时返回 400 并清理会话', () => {
      const now = Date.now();
      const req = {
        session: {
          currentChallenge: {
            challenge: 'ch',
            timestamp: now - SECURITY_CONFIG.CHALLENGE_TIMEOUT - 1,
          },
          passkeyUserHandle: '9',
        },
      } as unknown as Request;

      const result = resolvePasskeyRegistrationContext({
        req,
        registrationResponse: { id: 'cred-2' },
        now,
      });

      expect(result).toEqual({
        ok: false,
        failure: {
          statusCode: 400,
          body: { message: '注册质询已过期，请重新开始注册流程。' },
        },
      });
      const session = req.session as unknown as {
        currentChallenge?: unknown;
        passkeyUserHandle?: string;
      };
      expect(session.currentChallenge).toBeUndefined();
      expect(session.passkeyUserHandle).toBeUndefined();
    });

    it('有效上下文应返回 challenge/userHandle/origin', () => {
      const req = {
        session: {
          currentChallenge: {
            challenge: 'valid-challenge',
            timestamp: Date.now(),
            origin: 'https://session.example',
          },
          passkeyUserHandle: '11',
        },
      } as unknown as Request;

      const result = resolvePasskeyRegistrationContext({
        req,
        registrationResponse: { id: 'cred-3' },
        fallbackOrigin: 'https://fallback.example',
      });

      expect(result).toEqual({
        ok: true,
        registrationResponse: { id: 'cred-3' },
        expectedChallenge: 'valid-challenge',
        requestOrigin: 'https://session.example',
        userHandle: '11',
      });
    });
  });

  describe('mapPasskeyRegistrationVerificationResult', () => {
    it('验证成功时应映射为 verified', () => {
      const result = mapPasskeyRegistrationVerificationResult({
        verified: true,
        newPasskeyToSave: {
          user_id: 1,
          credential_id: 'cred-1',
          public_key: 'pub-key',
          counter: 0,
        },
      });

      expect(result).toEqual({
        status: 'verified',
        newPasskeyToSave: {
          user_id: 1,
          credential_id: 'cred-1',
          public_key: 'pub-key',
          counter: 0,
          transports: undefined,
          name: undefined,
          backed_up: undefined,
        },
      });
    });

    it('验证失败时应返回默认失败体并透传错误消息', () => {
      const result = mapPasskeyRegistrationVerificationResult({
        verified: false,
        error: { message: 'attestation invalid' },
      });

      expect(result).toEqual({
        status: 'failed',
        responseBody: {
          verified: false,
          message: 'Passkey 注册验证失败。',
          error: 'attestation invalid',
        },
      });
    });
  });

  describe('resolvePasskeyAuthenticationContext', () => {
    it('缺少 assertionResponse 时返回 400', () => {
      const req = {
        session: {},
      } as unknown as Request;

      const result = resolvePasskeyAuthenticationContext({
        req,
        assertionResponse: undefined,
      });

      expect(result).toEqual({
        ok: false,
        failure: {
          statusCode: 400,
          body: { message: '认证响应 (assertionResponse) 不能为空。' },
        },
      });
    });

    it('缺少 challenge 时返回 400', () => {
      const req = {
        session: {},
      } as unknown as Request;

      const result = resolvePasskeyAuthenticationContext({
        req,
        assertionResponse: { id: 'cred-a' },
      });

      expect(result).toEqual({
        ok: false,
        failure: {
          statusCode: 400,
          body: { message: '会话中未找到质询信息，请重试认证流程。' },
        },
      });
    });

    it('challenge 过期时返回 400 并仅清理 currentChallenge', () => {
      const now = Date.now();
      const req = {
        session: {
          currentChallenge: {
            challenge: 'expired',
            timestamp: now - SECURITY_CONFIG.CHALLENGE_TIMEOUT - 1,
          },
          passkeyUserHandle: 'remaining',
        },
      } as unknown as Request;

      const result = resolvePasskeyAuthenticationContext({
        req,
        assertionResponse: { id: 'cred-b' },
        now,
      });

      expect(result).toEqual({
        ok: false,
        failure: {
          statusCode: 400,
          body: { message: '认证质询已过期，请重新开始认证流程。' },
        },
      });
      const session = req.session as unknown as {
        currentChallenge?: unknown;
        passkeyUserHandle?: string;
      };
      expect(session.currentChallenge).toBeUndefined();
      expect(session.passkeyUserHandle).toBe('remaining');
    });

    it('有效上下文应返回 expectedChallenge 和 origin 回退', () => {
      const req = {
        session: {
          currentChallenge: {
            challenge: 'challenge-auth',
            timestamp: Date.now(),
          },
        },
      } as unknown as Request;

      const result = resolvePasskeyAuthenticationContext({
        req,
        assertionResponse: { id: 'cred-c' },
        fallbackOrigin: 'https://fallback-auth.example',
      });

      expect(result).toEqual({
        ok: true,
        authenticationResponseJSON: { id: 'cred-c' },
        expectedChallenge: 'challenge-auth',
        requestOrigin: 'https://fallback-auth.example',
      });
    });
  });

  describe('mapPasskeyAuthenticationVerificationResult', () => {
    it('验证成功时应映射为 verified', () => {
      const result = mapPasskeyAuthenticationVerificationResult({
        verified: true,
        userId: 3,
        passkey: {
          id: 5,
          credential_id: 'cred-z',
        },
      });

      expect(result).toEqual({
        status: 'verified',
        userId: 3,
        passkey: {
          id: 5,
          credential_id: 'cred-z',
        },
      });
    });

    it('验证失败时应映射为统一 401 响应体', () => {
      const result = mapPasskeyAuthenticationVerificationResult({
        verified: false,
      });

      expect(result).toEqual({
        status: 'failed',
        responseBody: {
          verified: false,
          message: 'Passkey 认证失败。',
        },
      });
    });
  });

  it('resolvePasskeyCredentialId 应提取 assertionResponse.id', () => {
    expect(resolvePasskeyCredentialId({ id: 'cred-id' })).toBe('cred-id');
    expect(resolvePasskeyCredentialId({ id: 123 })).toBeUndefined();
    expect(resolvePasskeyCredentialId(null)).toBeUndefined();
  });
});
