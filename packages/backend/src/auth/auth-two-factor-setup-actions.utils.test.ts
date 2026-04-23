import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { executeTwoFactorSetupAction } from './auth-two-factor-setup-actions.utils';
import {
  buildTwoFactorSetupPayload,
  createTwoFactorSecret,
  type SetupPayload,
} from './auth-two-factor-flow.utils';
import { saveTwoFactorSetupSessionSecret } from './auth-2fa-state-flow.utils';

vi.mock('./auth-two-factor-flow.utils', () => ({
  createTwoFactorSecret: vi.fn(),
  buildTwoFactorSetupPayload: vi.fn(),
}));

vi.mock('./auth-2fa-state-flow.utils', () => ({
  saveTwoFactorSetupSessionSecret: vi.fn(),
}));

describe('auth-two-factor-setup-actions.utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('会话已有临时密钥时应复用并返回 payload', async () => {
    const req = {
      session: {
        tempTwoFactorSecret: 'EXISTING_SECRET',
      },
    } as unknown as Request;

    const setupPayload: SetupPayload = {
      secret: 'EXISTING_SECRET',
      qrCodeUrl: 'data:image/png;base64,EXISTING_QR',
    };
    vi.mocked(buildTwoFactorSetupPayload).mockResolvedValueOnce(setupPayload);

    const action = await executeTwoFactorSetupAction({
      req,
      userId: 7,
      username: 'alice',
    });

    expect(action).toEqual({
      ok: true,
      reused: true,
      response: {
        statusCode: 200,
        body: setupPayload,
      },
      log: {
        level: 'debug',
        message: '[AuthController] 用户 7 复用已存在的临时 2FA 密钥，直接返回 setup payload。',
      },
    });
    expect(saveTwoFactorSetupSessionSecret).not.toHaveBeenCalled();
    expect(createTwoFactorSecret).not.toHaveBeenCalled();
  });

  it('无临时密钥且保存失败时应返回 failure', async () => {
    const req = {
      session: {},
    } as unknown as Request;
    vi.mocked(createTwoFactorSecret).mockReturnValueOnce('NEW_SECRET');
    vi.mocked(saveTwoFactorSetupSessionSecret).mockResolvedValueOnce({
      ok: false,
      failure: {
        statusCode: 500,
        body: { message: '保存两步验证状态失败，请重试。' },
      },
    });

    const action = await executeTwoFactorSetupAction({
      req,
      userId: 8,
      username: 'bob',
    });

    expect(action).toEqual({
      ok: false,
      failure: {
        statusCode: 500,
        body: { message: '保存两步验证状态失败，请重试。' },
      },
      log: {
        level: 'error',
        message: '[AuthController] 用户 8 保存临时 2FA 密钥到 session 失败',
      },
    });
    expect(buildTwoFactorSetupPayload).not.toHaveBeenCalled();
  });

  it('无临时密钥且保存成功时应生成新密钥并返回 payload', async () => {
    const req = {
      session: {},
    } as unknown as Request;
    vi.mocked(createTwoFactorSecret).mockReturnValueOnce('GENERATED_SECRET');
    vi.mocked(saveTwoFactorSetupSessionSecret).mockResolvedValueOnce({ ok: true });
    const setupPayload: SetupPayload = {
      secret: 'GENERATED_SECRET',
      qrCodeUrl: 'data:image/png;base64,NEW_QR',
    };
    vi.mocked(buildTwoFactorSetupPayload).mockResolvedValueOnce(setupPayload);

    const action = await executeTwoFactorSetupAction({
      req,
      userId: 9,
      username: 'carol',
    });

    expect(action).toEqual({
      ok: true,
      reused: false,
      response: {
        statusCode: 200,
        body: setupPayload,
      },
      log: {
        level: 'info',
        message: '[AuthController] 用户 9 生成新的临时 2FA 密钥并返回 setup payload。',
      },
    });
    expect(saveTwoFactorSetupSessionSecret).toHaveBeenCalledWith(req, 'GENERATED_SECRET');
  });
});
