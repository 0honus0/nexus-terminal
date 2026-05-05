import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock TransfersService
const mockTransfersService = vi.hoisted(() => ({
  initiateNewTransfer: vi.fn(),
  getAllTransferTasks: vi.fn(),
  getTransferTaskDetails: vi.fn(),
  cancelTransferTask: vi.fn(),
}));

vi.mock('./transfers.service', () => ({
  TransfersService: vi.fn(() => mockTransfersService),
}));

vi.mock('./transfers.schema', () => ({
  initiateTransferPayloadSchema: {
    safeParse: vi.fn(),
  },
}));

import { TransfersController } from './transfers.controller';
import { initiateTransferPayloadSchema } from './transfers.schema';

describe('transfers.controller', () => {
  let controller: TransfersController;

  const mockReq = (overrides: Record<string, any> = {}) =>
    ({
      session: { userId: 1 },
      params: {},
      body: {},
      ...overrides,
    }) as unknown as Request;

  const mockRes = () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    return res;
  };

  const mockNext = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new TransfersController();
  });

  describe('initiateTransfer', () => {
    it('未认证应返回 401', async () => {
      const req = mockReq({ session: {} });
      const res = mockRes();

      await controller.initiateTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ message: '用户未认证或会话无效。' });
    });

    it('Zod 验证失败应返回 400', async () => {
      vi.mocked(initiateTransferPayloadSchema.safeParse).mockReturnValue({
        success: false,
        error: {
          issues: [{ path: ['sourceConnectionId'], message: 'Required' }],
        },
      } as any);

      const req = mockReq({ body: { invalid: true } });
      const res = mockRes();

      await controller.initiateTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('请求参数验证失败') })
      );
    });

    it('创建成功应返回 202', async () => {
      vi.mocked(initiateTransferPayloadSchema.safeParse).mockReturnValue({
        success: true,
        data: { sourceConnectionId: 1, connectionIds: [2] },
      } as any);
      const mockTask = { taskId: 'task-1', status: 'queued' };
      mockTransfersService.initiateNewTransfer.mockResolvedValue(mockTask);

      const req = mockReq({ body: { sourceConnectionId: 1, connectionIds: [2] } });
      const res = mockRes();

      await controller.initiateTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(mockTask);
    });

    it('服务异常应返回 500', async () => {
      vi.mocked(initiateTransferPayloadSchema.safeParse).mockReturnValue({
        success: true,
        data: { sourceConnectionId: 1, connectionIds: [2] },
      } as any);
      mockTransfersService.initiateNewTransfer.mockRejectedValue(
        new Error('SSH connection failed')
      );

      const req = mockReq({ body: { sourceConnectionId: 1, connectionIds: [2] } });
      const res = mockRes();

      await controller.initiateTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Failed to initiate transfer.' })
      );
    });
  });

  describe('getAllStatuses', () => {
    it('未认证应返回 401', async () => {
      const req = mockReq({ session: {} });
      const res = mockRes();

      await controller.getAllStatuses(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('应返回当前用户的任务列表', async () => {
      const mockTasks = [{ taskId: 't1' }, { taskId: 't2' }];
      mockTransfersService.getAllTransferTasks.mockResolvedValue(mockTasks);

      const req = mockReq();
      const res = mockRes();

      await controller.getAllStatuses(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockTasks);
      expect(mockTransfersService.getAllTransferTasks).toHaveBeenCalledWith(1);
    });

    it('服务异常应返回 500', async () => {
      mockTransfersService.getAllTransferTasks.mockRejectedValue(new Error('DB error'));

      const req = mockReq();
      const res = mockRes();

      await controller.getAllStatuses(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getTaskStatus', () => {
    it('未认证应返回 401', async () => {
      const req = mockReq({ session: {}, params: { taskId: 't1' } });
      const res = mockRes();

      await controller.getTaskStatus(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('缺少 taskId 应返回 400', async () => {
      const req = mockReq({ params: {} });
      const res = mockRes();

      await controller.getTaskStatus(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Task ID is required.' });
    });

    it('任务存在应返回 200', async () => {
      const mockTask = { taskId: 't1', status: 'completed' };
      mockTransfersService.getTransferTaskDetails.mockResolvedValue(mockTask);

      const req = mockReq({ params: { taskId: 't1' } });
      const res = mockRes();

      await controller.getTaskStatus(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockTask);
    });

    it('任务不存在应返回 404', async () => {
      mockTransfersService.getTransferTaskDetails.mockResolvedValue(null);

      const req = mockReq({ params: { taskId: 'nonexistent' } });
      const res = mockRes();

      await controller.getTaskStatus(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('服务异常应返回 500', async () => {
      mockTransfersService.getTransferTaskDetails.mockRejectedValue(new Error('Error'));

      const req = mockReq({ params: { taskId: 't1' } });
      const res = mockRes();

      await controller.getTaskStatus(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('cancelTransfer', () => {
    it('未认证应返回 401', async () => {
      const req = mockReq({ session: {}, params: { taskId: 't1' } });
      const res = mockRes();

      await controller.cancelTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('缺少 taskId 应返回 400', async () => {
      const req = mockReq({ params: {} });
      const res = mockRes();

      await controller.cancelTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'Task ID is required for cancellation.' });
    });

    it('取消成功应返回 200', async () => {
      mockTransfersService.cancelTransferTask.mockResolvedValue(true);

      const req = mockReq({ params: { taskId: 't1' } });
      const res = mockRes();

      await controller.cancelTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'Transfer task t1 cancellation initiated.',
      });
    });

    it('取消失败应返回 404', async () => {
      mockTransfersService.cancelTransferTask.mockResolvedValue(false);

      const req = mockReq({ params: { taskId: 't1' } });
      const res = mockRes();

      await controller.cancelTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('服务异常应返回 500', async () => {
      mockTransfersService.cancelTransferTask.mockRejectedValue(new Error('Error'));

      const req = mockReq({ params: { taskId: 't1' } });
      const res = mockRes();

      await controller.cancelTransfer(req, res, mockNext);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
