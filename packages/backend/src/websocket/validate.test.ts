import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateWebSocketMessage } from './validate';
import * as schemas from './schemas';

// Mock schemas registry
vi.mock('./schemas', () => ({
  messageSchemaRegistry: {
    'ssh:connect': {
      parse: vi.fn((data) => {
        if (!data.payload?.connectionId) {
          throw new Error('Missing connectionId');
        }
        return data;
      }),
    },
    'ssh:input': {
      parse: vi.fn((data) => {
        if (!data.payload?.data) {
          throw new Error('Missing data');
        }
        return data;
      }),
    },
    'sftp:readdir': {
      parse: vi.fn((data) => data),
    },
  },
  SupportedMessageType: {},
}));

describe('WebSocket Validate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateWebSocketMessage', () => {
    it('应拒绝非对象消息', () => {
      const result = validateWebSocketMessage('invalid');

      expect(result.success).toBe(false);
      expect(result.error).toBe('消息格式错误：必须是有效的 JSON 对象');
    });

    it('应拒绝null消息', () => {
      const result = validateWebSocketMessage(null);

      expect(result.success).toBe(false);
      expect(result.error).toBe('消息格式错误：必须是有效的 JSON 对象');
    });

    it('应拒绝缺少type字段的消息', () => {
      const result = validateWebSocketMessage({
        payload: { data: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('消息格式错误：缺少有效的 type 字段');
    });

    it('应拒绝type字段不是字符串的消息', () => {
      const result = validateWebSocketMessage({
        type: 123,
        payload: { data: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('消息格式错误：缺少有效的 type 字段');
    });

    it('应拒绝不支持的消息类型', () => {
      const result = validateWebSocketMessage({
        type: 'unknown:type',
        payload: { data: 'test' },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('不支持的消息类型: unknown:type');
    });

    it('应成功验证有效的ssh:connect消息', () => {
      const message = {
        type: 'ssh:connect',
        payload: {
          connectionId: 1,
        },
      };

      const result = validateWebSocketMessage(message);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(message);
    });

    it('应拒绝无效的ssh:input消息', () => {
      const message = {
        type: 'ssh:input',
        payload: {},
      };

      const result = validateWebSocketMessage(message);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing data');
    });

    it('应成功验证sftp:readdir消息', () => {
      const message = {
        type: 'sftp:readdir',
        payload: {
          path: '/home/user',
        },
        requestId: 'req-123',
      };

      const result = validateWebSocketMessage(message);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(message);
    });

    it('应处理Schema解析错误', () => {
      // 测试无效的ssh:input消息（缺少data字段）
      const result = validateWebSocketMessage({
        type: 'ssh:input',
        payload: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing data');
    });

    it('应防止原型污染攻击', () => {
      const maliciousMessage = {
        type: 'constructor',
        payload: {},
      };

      const result = validateWebSocketMessage(maliciousMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('不支持的消息类型: constructor');
    });

    it('应防止__proto__注入', () => {
      const maliciousMessage = {
        type: '__proto__',
        payload: {},
      };

      const result = validateWebSocketMessage(maliciousMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('不支持的消息类型: __proto__');
    });

    it('应处理非 Error 类型的异常', () => {
      // 临时替换 mock，让它抛出字符串错误而非 Error 对象
      vi.mocked(schemas.messageSchemaRegistry['ssh:connect'].parse).mockImplementationOnce(() => {
        throw 'String error thrown';
      });

      const result = validateWebSocketMessage({
        type: 'ssh:connect',
        payload: { connectionId: 1 },
      });

      expect(result.success).toBe(false);
      // 非 Error 类型的异常会被处理为 "未知错误"
      expect(result.error).toBe('消息校验失败: 未知错误');
    });

    it('应返回完整的验证数据', () => {
      const message = {
        type: 'sftp:readdir',
        payload: {
          path: '/home/user',
        },
        requestId: 'req-123',
      };

      const result = validateWebSocketMessage(message);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(message);
      expect(result.error).toBeUndefined();
      expect(result.errorDetails).toBeUndefined();
    });

    it('应处理嵌套的payload验证错误', () => {
      // 测试无效的ssh:input消息（payload.data缺失）
      const result = validateWebSocketMessage({
        type: 'ssh:input',
        payload: {
          wrongField: 'value',
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing data');
    });
  });
});
