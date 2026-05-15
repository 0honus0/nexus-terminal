import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './types';

// The worker sets `self.onmessage` on import. We mock `self.postMessage`
// to capture responses and then import the worker so its handler is registered.

// Capture messages posted by the worker
const postedMessages: WorkerResponse[] = [];

const postMessageSpy = vi.fn((data: WorkerResponse) => {
  postedMessages.push(data);
});

// Set up self.postMessage before importing the worker
Object.defineProperty(globalThis, 'postMessage', {
  value: postMessageSpy,
  writable: true,
  configurable: true,
});

// Import the worker - this registers self.onmessage
await import('./output-processor.worker');

// Helper to dispatch a message to the worker
function dispatch(request: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    const originalSpy = postMessageSpy.getMockImplementation();
    postMessageSpy.mockImplementationOnce((data: WorkerResponse) => {
      if (data.id === request.id) {
        resolve(data);
      }
      if (originalSpy) originalSpy(data);
    });

    const event = { data: request } as MessageEvent<WorkerRequest>;
    (globalThis as unknown as { onmessage: (e: MessageEvent) => void }).onmessage(event);
  });
}

// Generate a unique ID for test requests
let testIdCounter = 0;
function nextId(): string {
  return `test-id-${++testIdCounter}`;
}

// Reset config to defaults before each test by sending a configure message
beforeEach(async () => {
  postedMessages.length = 0;
  vi.clearAllMocks();
  // Reset to default config
  await dispatch({
    id: 'reset',
    type: 'configure',
    payload: {
      foldThreshold: 500,
      enableHighlight: true,
      enableTableFormat: true,
      enableLinkDetection: true,
    },
  });
  postedMessages.length = 0;
});

afterEach(() => {
  postedMessages.length = 0;
});

describe('output-processor.worker', () => {
  describe('process 消息', () => {
    it('应该处理 JSON 输出并返回正确类型', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: '{"key": "value", "count": 42}' },
      });

      expect(response.id).toBe(id);
      expect(response.type).toBe('process');
      expect(response.error).toBeUndefined();
      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('json');
    });

    it('应该处理 YAML 输出并返回正确类型', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'name: test\nversion: 1.0\ndescription: hello' },
      });

      const result = response.payload as { type: string };
      expect(result.type).toBe('yaml');
    });

    it('应该处理 LOG 输出并返回正确类型', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: '2024-01-15 10:30:00 INFO Server started' },
      });

      const result = response.payload as { type: string };
      expect(result.type).toBe('log');
    });

    it('应该处理普通文本并返回 text 类型', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'Hello world, plain text output' },
      });

      const result = response.payload as { type: string };
      expect(result.type).toBe('text');
    });

    it('应该包含 metadata 中的行数信息', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'line1\nline2\nline3' },
      });

      const result = response.payload as { metadata: { lineCount: number } };
      expect(result.metadata.lineCount).toBe(3);
    });

    it('应该包含 shouldFold 元数据', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'short text' },
      });

      const result = response.payload as { metadata: { shouldFold: boolean } };
      expect(result.metadata.shouldFold).toBe(false);
    });

    it('高亮启用时 JSON 内容应包含 ANSI 码', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: '{"key": "value"}' },
      });

      const result = response.payload as { content: string };
      expect(result.content).toContain('\x1b[');
    });

    it('应该去除输入中的 ANSI 码', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: '\x1b[31mred text\x1b[0m normal' },
      });

      const result = response.payload as { content: string };
      // 原有 ANSI 码被去除（内容不含原始颜色码 31m）
      expect(result.content).toContain('red text');
    });

    it('应该将选项合并到配置中', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: {
          text: '{"key": "value"}',
          options: { enableHighlight: false },
        },
      });

      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('json');
      // 禁用高亮后不应包含 ANSI 码
      expect(result.content).not.toContain('\x1b[');
    });

    it('自定义 foldThreshold 应影响 shouldFold', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: {
          text: 'line1\nline2\nline3',
          options: { foldThreshold: 2 },
        },
      });

      const result = response.payload as { metadata: { shouldFold: boolean; foldThreshold: number } };
      expect(result.metadata.shouldFold).toBe(true);
      expect(result.metadata.foldThreshold).toBe(2);
    });

    it('超过 5000 行时应跳过高亮并返回 text 类型', async () => {
      const id = nextId();
      const largeText = Array.from({ length: 5001 }, (_, i) => `line ${i}`).join('\n');
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: largeText },
      });

      const result = response.payload as { type: string; metadata: { lineCount: number } };
      expect(result.type).toBe('text');
      expect(result.metadata.lineCount).toBe(5001);
    });

    it('空文本应返回 text 类型', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: '' },
      });

      const result = response.payload as { type: string };
      expect(result.type).toBe('text');
    });

    it('CRLF 换行符应被规范化', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'line1\r\nline2\r\nline3' },
      });

      const result = response.payload as { metadata: { lineCount: number } };
      expect(result.metadata.lineCount).toBe(3);
    });
  });

  describe('configure 消息', () => {
    it('应该更新配置并返回 { ok: true }', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'configure',
        payload: { foldThreshold: 100 },
      });

      expect(response.id).toBe(id);
      expect(response.error).toBeUndefined();
      const result = response.payload as { ok: boolean };
      expect(result.ok).toBe(true);
    });

    it('更新后的 foldThreshold 应影响后续处理', async () => {
      // 设置 foldThreshold 为 1
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { foldThreshold: 1 },
      });

      // 处理 2 行文本
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'line1\nline2' },
      });

      const result = response.payload as { metadata: { shouldFold: boolean; foldThreshold: number } };
      expect(result.metadata.shouldFold).toBe(true);
      expect(result.metadata.foldThreshold).toBe(1);

      // 重置
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { foldThreshold: 500 },
      });
    });

    it('部分配置更新应合并现有配置', async () => {
      // 只禁用高亮
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { enableHighlight: false },
      });

      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: '{"key": "value"}' },
      });

      const result = response.payload as { content: string };
      // 高亮被禁用，无 ANSI 码
      expect(result.content).not.toContain('\x1b[');

      // 重置
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { enableHighlight: true },
      });
    });
  });

  describe('未知消息类型', () => {
    it('未知 type 应返回错误响应', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'unknownOperation',
        payload: {},
      });

      expect(response.id).toBe(id);
      expect(response.error).toContain('未知任务类型: unknownOperation');
      expect(response.payload).toBeNull();
    });
  });

  describe('错误处理', () => {
    it('响应 ID 应与请求 ID 匹配', async () => {
      const id = 'unique-test-id-abc';
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'test' },
      });

      expect(response.id).toBe(id);
    });

    it('响应 type 应与请求 type 匹配', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'test' },
      });

      expect(response.type).toBe('process');
    });
  });

  describe('TABLE 处理', () => {
    it('应该检测并处理管道符表格', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: {
          text: '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |',
        },
      });

      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('table');
      expect(result.content).toContain('\x1b[');
    });

    it('禁用表格格式化时应返回原始内容', async () => {
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { enableTableFormat: false },
      });

      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: {
          text: '| ID   | Name   | Code   |\n| 1    | test   | A01    |\n| 2    | dev    | B02    |',
        },
      });

      const result = response.payload as { type: string; content: string };
      expect(result.type).toBe('table');
      expect(result.content).not.toContain('\x1b[');

      // 重置
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { enableTableFormat: true },
      });
    });
  });

  describe('链接检测', () => {
    it('启用链接检测时应高亮 URL', async () => {
      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'Visit https://example.com for docs' },
      });

      const result = response.payload as { content: string };
      expect(result.content).toContain('https://example.com');
      expect(result.content).toContain('\x1b[');
    });

    it('禁用链接检测时不应高亮 URL', async () => {
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { enableLinkDetection: false },
      });

      const id = nextId();
      const response = await dispatch({
        id,
        type: 'process',
        payload: { text: 'Visit https://example.com for docs' },
      });

      const result = response.payload as { content: string };
      // 无 ANSI 码（text 类型且链接检测关闭）
      expect(result.content).not.toContain('\x1b[');

      // 重置
      await dispatch({
        id: nextId(),
        type: 'configure',
        payload: { enableLinkDetection: true },
      });
    });
  });
});