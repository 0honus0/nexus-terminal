/**
 * Auth Middleware 单元测试
 * 测试认证中间件的请求拦截逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

import { isAuthenticated } from './auth.middleware';

// 创建 mock Request
function createMockRequest(sessionData: Partial<{ userId?: number }> = {}): Partial<Request> {
  return {
    session: sessionData as any,
  };
}

// 创建 mock Response
function createMockResponse(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRes = createMockResponse();
    mockNext = vi.fn();
  });

  describe('isAuthenticated', () => {
    it('用户已登录时应调用 next()', () => {
      mockReq = createMockRequest({ userId: 1 });

      isAuthenticated(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockRes.json).not.toHaveBeenCalled();
    });

    it('session 存在但无 userId 时应返回 401', () => {
      mockReq = createMockRequest({});

      isAuthenticated(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '未授权：请先登录。' });
    });

    it('session 为 undefined 时应返回 401', () => {
      mockReq = { session: undefined } as Partial<Request>;

      isAuthenticated(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '未授权：请先登录。' });
    });

    it('session 为 null 时应返回 401', () => {
      mockReq = { session: null } as unknown as Partial<Request>;

      isAuthenticated(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('userId 为有效数字时应调用 next()', () => {
      mockReq = createMockRequest({ userId: 12345 });

      isAuthenticated(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('userId 为 0 时应返回 401（falsy 值）', () => {
      mockReq = createMockRequest({ userId: 0 });

      isAuthenticated(mockReq as Request, mockRes as Response, mockNext);

      // userId = 0 是 falsy，所以应该返回 401
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });
});
