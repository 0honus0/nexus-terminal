import { describe, expect, it } from 'vitest';
import { Request } from 'express';
import {
  clearPasskeyAuthenticationChallengeSession,
  clearPasskeyRegistrationSession,
  resolvePasskeyAuthenticationVerificationOutcome,
  resolvePasskeyRegistrationVerificationOutcome,
} from './auth-passkey-register-auth-flow.utils';

describe('auth-passkey-register-auth-flow.utils', () => {
  it('注册失败映射应保持 400 语义字段', () => {
    const result = resolvePasskeyRegistrationVerificationOutcome({
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

  it('认证失败映射应保持 401 响应体语义', () => {
    const result = resolvePasskeyAuthenticationVerificationOutcome({
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

  it('clearPasskeyRegistrationSession 应清理 challenge 与 userHandle', () => {
    const req = {
      session: {
        currentChallenge: {
          challenge: 'abc',
          timestamp: Date.now(),
          origin: 'https://nexus.example',
        },
        passkeyUserHandle: '9',
      },
    } as unknown as Request;

    clearPasskeyRegistrationSession(req);

    const session = req.session as unknown as {
      currentChallenge?: unknown;
      passkeyUserHandle?: string;
    };
    expect(session.currentChallenge).toBeUndefined();
    expect(session.passkeyUserHandle).toBeUndefined();
  });

  it('clearPasskeyAuthenticationChallengeSession 仅清理 challenge', () => {
    const req = {
      session: {
        currentChallenge: {
          challenge: 'xyz',
          timestamp: Date.now(),
        },
        passkeyUserHandle: 'keep-me',
      },
    } as unknown as Request;

    clearPasskeyAuthenticationChallengeSession(req);

    const session = req.session as unknown as {
      currentChallenge?: unknown;
      passkeyUserHandle?: string;
    };
    expect(session.currentChallenge).toBeUndefined();
    expect(session.passkeyUserHandle).toBe('keep-me');
  });
});
