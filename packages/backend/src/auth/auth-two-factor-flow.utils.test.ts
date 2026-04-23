import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import qrcode from 'qrcode';
import speakeasy from 'speakeasy';
import {
  createTwoFactorSecret,
  resolveTwoFactorEffectiveSecret,
  respondWithExistingTwoFactorSetup,
  saveTwoFactorSecretAndRespond,
  verifyTwoFactorTokenWithSkew,
} from './auth-two-factor-flow.utils';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,MOCK_QR'),
  },
  toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,MOCK_QR'),
}));

vi.mock('speakeasy', () => ({
  default: {
    generateSecret: vi.fn(() => ({ base32: 'MOCK_BASE32_SECRET' })),
    otpauthURL: vi.fn(() => 'otpauth://mock-url'),
    totp: {
      verifyDelta: vi.fn(),
    },
  },
}));

describe('auth-two-factor-flow.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createTwoFactorSecret 应返回 base32 密钥', () => {
    const result = createTwoFactorSecret('alice');
    expect(result).toBe('MOCK_BASE32_SECRET');
    expect(vi.mocked(speakeasy.generateSecret)).toHaveBeenCalled();
  });

  it('respondWithExistingTwoFactorSetup 在无会话密钥时返回 false', async () => {
    const req = {
      session: {},
    } as unknown as Request;
    const res = {
      json: vi.fn(),
    } as unknown as Response;

    const reused = await respondWithExistingTwoFactorSetup(req, res, 'alice');
    expect(reused).toBe(false);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('respondWithExistingTwoFactorSetup 在有会话密钥时返回 true 并发送 payload', async () => {
    const req = {
      session: {
        tempTwoFactorSecret: 'EXISTING_SECRET',
      },
    } as unknown as Request;
    const res = {
      json: vi.fn(),
    } as unknown as Response;

    const reused = await respondWithExistingTwoFactorSetup(req, res, 'alice');
    expect(reused).toBe(true);
    expect(vi.mocked(qrcode.toDataURL)).toHaveBeenCalledWith('otpauth://mock-url');
    expect(res.json).toHaveBeenCalledWith({
      secret: 'EXISTING_SECRET',
      qrCodeUrl: 'data:image/png;base64,MOCK_QR',
    });
  });

  it('saveTwoFactorSecretAndRespond 在 save 失败时返回 500', async () => {
    const req = {
      session: {
        save: vi.fn((callback: (err?: Error) => void) => callback(new Error('save failed'))),
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    await saveTwoFactorSecretAndRespond(req, res, {
      userId: 1,
      username: 'alice',
      secret: 'NEW_SECRET',
    });

    expect((req.session as unknown as { tempTwoFactorSecret?: string }).tempTwoFactorSecret).toBe(
      'NEW_SECRET'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: '保存两步验证状态失败，请重试。' });
  });

  it('saveTwoFactorSecretAndRespond 在 save 成功时返回 payload', async () => {
    const req = {
      session: {
        save: vi.fn((callback: (err?: Error) => void) => callback()),
      },
    } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    await saveTwoFactorSecretAndRespond(req, res, {
      userId: 1,
      username: 'alice',
      secret: 'NEW_SECRET',
    });

    expect(res.json).toHaveBeenCalledWith({
      secret: 'NEW_SECRET',
      qrCodeUrl: 'data:image/png;base64,MOCK_QR',
    });
  });

  it('resolveTwoFactorEffectiveSecret 应优先采用 providedSecret 并同步 session', () => {
    const req = {
      session: {
        tempTwoFactorSecret: 'SESSION_SECRET',
      },
    } as unknown as Request;

    const result = resolveTwoFactorEffectiveSecret({
      req,
      tempSecret: 'SESSION_SECRET',
      providedSecret: 'PROVIDED_SECRET',
    });

    expect(result).toEqual({
      effectiveSecret: 'PROVIDED_SECRET',
      secretProvidedByBody: true,
      sessionSecretMismatched: true,
    });
    expect((req.session as unknown as { tempTwoFactorSecret?: string }).tempTwoFactorSecret).toBe(
      'PROVIDED_SECRET'
    );
  });

  describe('verifyTwoFactorTokenWithSkew', () => {
    it('strict 验证成功时返回 verified', () => {
      vi.mocked(speakeasy.totp.verifyDelta).mockReturnValueOnce({ delta: 1 });

      const result = verifyTwoFactorTokenWithSkew({
        secret: 'SECRET',
        token: '123456',
        verifyWindow: 1,
        skewDetectWindow: 20,
        skewWarnThreshold: 2,
      });

      expect(result).toEqual({ status: 'verified', delta: 1 });
    });

    it('strict 失败且 relaxed 偏差较大时返回 time_skew', () => {
      vi.mocked(speakeasy.totp.verifyDelta)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({ delta: 3 });

      const result = verifyTwoFactorTokenWithSkew({
        secret: 'SECRET',
        token: '123456',
        verifyWindow: 1,
        skewDetectWindow: 20,
        skewWarnThreshold: 2,
      });

      expect(result).toEqual({ status: 'time_skew', delta: 3, skewSeconds: 90 });
    });

    it('两次验证都失败时返回 invalid', () => {
      vi.mocked(speakeasy.totp.verifyDelta)
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce(undefined);

      const result = verifyTwoFactorTokenWithSkew({
        secret: 'SECRET',
        token: '123456',
        verifyWindow: 1,
        skewDetectWindow: 20,
        skewWarnThreshold: 2,
      });

      expect(result).toEqual({ status: 'invalid' });
    });
  });
});
