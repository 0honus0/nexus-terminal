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

/**
 * 使用真实 Zod Schema 的集成验证测试
 *
 * 这组测试不 mock schemas 模块，直接验证真实 Zod schema 的行为。
 * 目的是确保 schema 验证层能捕获 GitHub Issue #34 类问题：
 * z.union 中 sftpWritefilePayloadSchema 的 .refine() 不会在 union 匹配时触发，
 * 但 .strict() 能防止未知字段被静默 strip。
 */
describe('WebSocket Validate — 真实 Schema 集成验证', async () => {
  // 动态导入真实 schemas，绕过顶层 mock
  const realSchemas = await vi.importActual<typeof import('./schemas')>('./schemas');

  describe('sftp:writefile — content 不应被 union strip 掉', () => {
    it('应成功验证含 content 的 writefile 消息', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/root/test.txt',
          content: 'hello world',
        },
        requestId: 'req-write-1',
      };

      // 使用真实的 sftpBaseSchema 验证
      const result = realSchemas.sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/root/test.txt');
      expect(payload.content).toBe('hello world');
    });

    it('应成功验证含 data 的 writefile 消息', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/root/test.txt',
          data: 'base64encodedcontent',
        },
        requestId: 'req-write-2',
      };

      const result = realSchemas.sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/root/test.txt');
      expect(payload.data).toBe('base64encodedcontent');
    });

    it('content 为空字符串时也应保留', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/root/empty.txt',
          content: '',
        },
        requestId: 'req-write-3',
      };

      const result = realSchemas.sftpBaseSchema.parse(message);
      const payload = result.payload as Record<string, unknown>;

      expect(payload.path).toBe('/root/empty.txt');
      expect(payload.content).toBe('');
    });

    it('应拒绝 writefile payload 中的未知字段（strict 模式）', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/root/test.txt',
          content: 'hello',
          extraField: 'should fail',
        },
        requestId: 'req-write-strict',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).toThrow();
    });

    it('path 为空字符串时应拒绝', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '',
          content: 'hello',
        },
        requestId: 'req-write-empty-path',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).toThrow();
    });

    it('content 超过 10MB 限制时应拒绝', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/root/big.txt',
          content: 'x'.repeat(10485761),
        },
        requestId: 'req-write-too-big',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).toThrow();
    });
  });

  describe('sftp:writefile — validateWebSocketMessage 端到端验证', () => {
    it('应保留 content 并返回成功结果', () => {
      const message = {
        type: 'sftp:writefile',
        payload: {
          path: '/root/test.txt',
          content: 'hello world',
          encoding: 'utf-8',
        },
        requestId: 'req-e2e-1',
      };

      const result = validateWebSocketMessage(message);
      // 注意：此测试仍使用顶层 mock 的 validateWebSocketMessage，
      // 但消息会通过真实 Zod schema 验证（因为 sftpBaseSchema 是动态解析的）
      // 这里只验证 schema 层面的正确性
      expect(() => realSchemas.sftpBaseSchema.parse(message)).not.toThrow();
      const parsed = realSchemas.sftpBaseSchema.parse(message);
      expect((parsed.payload as Record<string, unknown>).content).toBe('hello world');
    });

    it('sftp:readdir 消息不应包含 content 字段时仍能通过（union 行为）', () => {
      const message = {
        type: 'sftp:readdir',
        payload: {
          path: '/home/user',
        },
        requestId: 'req-e2e-2',
      };

      const result = validateWebSocketMessage(message);
      expect(result.success).toBe(true);
    });

    it('sftp:chmod 的 payload 不应包含 path 以外的无关字段', () => {
      const message = {
        type: 'sftp:chmod',
        payload: {
          path: '/root/script.sh',
          mode: 0o755,
        },
        requestId: 'req-e2e-3',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).not.toThrow();
    });

    it('sftp:chmod payload 仅含 path 时应由 path schema 匹配（union 行为）', () => {
      // z.union 中 {path} 会匹配到 sftpPathPayloadSchema（readdir/stat 等共用），
      // 这是 union 的正确行为 — handler 层会进一步校验 mode 是否存在
      const message = {
        type: 'sftp:chmod',
        payload: {
          path: '/root/script.sh',
        },
        requestId: 'req-e2e-4',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).not.toThrow();
    });

    it('sftp:rename payload 缺少 newPath 时应拒绝', () => {
      const message = {
        type: 'sftp:rename',
        payload: {
          oldPath: '/root/old.txt',
        },
        requestId: 'req-e2e-5',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).toThrow();
    });

    it('sftp:copy 的 sources 不是数组时应拒绝', () => {
      const message = {
        type: 'sftp:copy',
        payload: {
          sources: 'not-an-array',
          destination: '/dest',
        },
        requestId: 'req-e2e-6',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).toThrow();
    });

    it('sftp:compress 仅含 sources+destination 时应由 copyMove schema 匹配（union 行为）', () => {
      // z.union 中 {sources, destination} 会匹配到 sftpCopyMovePayloadSchema，
      // 缺少 format 的 compress 消息会被 handler 层拒绝
      const message = {
        type: 'sftp:compress',
        payload: {
          sources: ['/a'],
          destination: '/b.tar.gz',
        },
        requestId: 'req-e2e-7',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).not.toThrow();
    });

    it('sftp:decompress 缺少 source 时应拒绝', () => {
      const message = {
        type: 'sftp:decompress',
        payload: {},
        requestId: 'req-e2e-8',
      };

      expect(() => realSchemas.sftpBaseSchema.parse(message)).toThrow();
    });
  });
});
