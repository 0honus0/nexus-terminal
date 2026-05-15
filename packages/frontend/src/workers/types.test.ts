import { describe, it, expect } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './types';

/**
 * Tests for the Worker message protocol type definitions.
 * These verify that the type shapes can be constructed correctly at runtime
 * (TypeScript interface compliance is enforced at compile time, but we can
 * validate the runtime shape expectations here).
 */
describe('Worker 消息协议类型', () => {
  describe('WorkerRequest 结构', () => {
    it('应该能够构造包含所有必要字段的 WorkerRequest', () => {
      const request: WorkerRequest = {
        id: 'test-id-001',
        type: 'process',
        payload: { text: 'hello world' },
      };

      expect(request.id).toBe('test-id-001');
      expect(request.type).toBe('process');
      expect(request.payload).toEqual({ text: 'hello world' });
    });

    it('WorkerRequest payload 应接受任意类型', () => {
      const requestWithNull: WorkerRequest = { id: '1', type: 'ping', payload: null };
      const requestWithString: WorkerRequest = { id: '2', type: 'echo', payload: 'hello' };
      const requestWithNumber: WorkerRequest = { id: '3', type: 'compute', payload: 42 };
      const requestWithArray: WorkerRequest = { id: '4', type: 'batch', payload: [1, 2, 3] };

      expect(requestWithNull.payload).toBeNull();
      expect(requestWithString.payload).toBe('hello');
      expect(requestWithNumber.payload).toBe(42);
      expect(requestWithArray.payload).toEqual([1, 2, 3]);
    });

    it('WorkerRequest id 应为字符串类型', () => {
      const request: WorkerRequest = { id: 'uuid-1234-5678', type: 'op', payload: {} };
      expect(typeof request.id).toBe('string');
    });

    it('WorkerRequest type 应为字符串类型', () => {
      const request: WorkerRequest = { id: '1', type: 'my-task-type', payload: {} };
      expect(typeof request.type).toBe('string');
    });
  });

  describe('WorkerResponse 结构', () => {
    it('应该能够构造包含必要字段的成功响应', () => {
      const response: WorkerResponse = {
        id: 'req-123',
        type: 'process',
        payload: { result: 'done' },
      };

      expect(response.id).toBe('req-123');
      expect(response.type).toBe('process');
      expect(response.payload).toEqual({ result: 'done' });
      expect(response.error).toBeUndefined();
    });

    it('应该能够构造包含 error 字段的失败响应', () => {
      const response: WorkerResponse = {
        id: 'req-456',
        type: 'process',
        payload: null,
        error: '处理失败：超时',
      };

      expect(response.id).toBe('req-456');
      expect(response.error).toBe('处理失败：超时');
      expect(response.payload).toBeNull();
    });

    it('error 字段应为可选的', () => {
      const successResponse: WorkerResponse = {
        id: '1',
        type: 'op',
        payload: 'result',
      };

      expect(successResponse.error).toBeUndefined();
    });

    it('WorkerResponse payload 应接受任意类型', () => {
      const withNull: WorkerResponse = { id: '1', type: 'a', payload: null };
      const withObject: WorkerResponse = { id: '2', type: 'b', payload: { key: 'val' } };
      const withBoolean: WorkerResponse = { id: '3', type: 'c', payload: true };

      expect(withNull.payload).toBeNull();
      expect(withObject.payload).toEqual({ key: 'val' });
      expect(withBoolean.payload).toBe(true);
    });
  });

  describe('请求/响应 ID 关联', () => {
    it('响应的 id 应与请求的 id 匹配（按惯例）', () => {
      const request: WorkerRequest = {
        id: 'correlation-id-xyz',
        type: 'task',
        payload: {},
      };

      const response: WorkerResponse = {
        id: request.id,
        type: request.type,
        payload: { result: 'success' },
      };

      expect(response.id).toBe(request.id);
      expect(response.type).toBe(request.type);
    });

    it('响应的 type 通常与请求的 type 匹配', () => {
      const types = ['process', 'configure', 'compute', 'validate'];

      types.forEach((type) => {
        const req: WorkerRequest = { id: '1', type, payload: {} };
        const res: WorkerResponse = { id: '1', type, payload: null };
        expect(res.type).toBe(req.type);
      });
    });
  });
});
