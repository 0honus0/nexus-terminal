import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ==================== Mock Worker ====================

class MockWorker {
  static instances: MockWorker[] = [];

  url: URL | string;
  options?: { type?: string };
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(url: URL | string, options?: { type?: string }) {
    this.url = url;
    this.options = options;
    MockWorker.instances.push(this);
  }

  /** 模拟 Worker 发出成功响应 */
  simulateMessage(data: { id: string; type: string; payload: unknown; error?: string }) {
    const event = { data, target: this } as unknown as MessageEvent;
    if (this.onmessage) this.onmessage(event);
  }

  /** 模拟 Worker 发出错误事件 */
  simulateError(message: string) {
    const event = { message } as unknown as ErrorEvent;
    if (this.onerror) this.onerror(event);
  }
}

// ==================== Setup ====================

let originalWorker: typeof Worker;

beforeEach(() => {
  MockWorker.instances = [];
  vi.useFakeTimers();
  originalWorker = global.Worker;
  (global as unknown as Record<string, unknown>).Worker = MockWorker;
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  (global as unknown as Record<string, unknown>).Worker = originalWorker;
});

// ==================== Tests ====================

describe('createWorkerPool', () => {
  // Dynamic import after mocking Worker
  async function getCreateWorkerPool() {
    const { createWorkerPool } = await import('./createWorkerPool');
    return createWorkerPool;
  }

  const fakeUrl = new URL('https://example.com/worker.js');

  describe('初始化', () => {
    it('默认应创建 2 个 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl);
      expect(pool.size).toBe(2);
      pool.destroy();
    });

    it('指定 size 应创建对应数量的 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 3 });
      expect(pool.size).toBe(3);
      pool.destroy();
    });

    it('size 为 1 应创建 1 个 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });
      expect(pool.size).toBe(1);
      pool.destroy();
    });

    it('初始时所有 Worker 应为空闲状态', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('应使用 module 类型创建 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      createWorkerPool(fakeUrl, { size: 1 });
      const worker = MockWorker.instances[0];
      expect(worker.options?.type).toBe('module');
    });
  });

  describe('execute - Worker 可用时', () => {
    it('应将任务通过 postMessage 发送到 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      const promise = pool.execute('myTask', { data: 'test' });
      const worker = MockWorker.instances[0];

      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'myTask',
          payload: { data: 'test' },
        })
      );

      // Cleanup: simulate response to resolve promise
      const callArg = worker.postMessage.mock.calls[0][0];
      worker.simulateMessage({ id: callArg.id, type: 'myTask', payload: 'result' });

      await expect(promise).resolves.toBe('result');
      pool.destroy();
    });

    it('Worker 回复成功响应时应 resolve 对应 promise', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      const promise = pool.execute<string>('process', { text: 'hello' });
      const worker = MockWorker.instances[0];
      const callArg = worker.postMessage.mock.calls[0][0];

      worker.simulateMessage({ id: callArg.id, type: 'process', payload: 'processed result' });

      await expect(promise).resolves.toBe('processed result');
      pool.destroy();
    });

    it('Worker 回复错误响应时应 reject 对应 promise', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      const promise = pool.execute<string>('process', { text: 'hello' });
      const worker = MockWorker.instances[0];
      const callArg = worker.postMessage.mock.calls[0][0];

      worker.simulateMessage({
        id: callArg.id,
        type: 'process',
        payload: null,
        error: '处理失败',
      });

      await expect(promise).rejects.toThrow('处理失败');
      pool.destroy();
    });

    it('任务 ID 不匹配时应忽略响应', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      const promise = pool.execute<string>('process', { text: 'hello' });
      const worker = MockWorker.instances[0];

      // 发送不匹配的 ID
      worker.simulateMessage({ id: 'nonexistent-id', type: 'process', payload: 'ignored' });

      // 发送正确 ID
      const callArg = worker.postMessage.mock.calls[0][0];
      worker.simulateMessage({ id: callArg.id, type: 'process', payload: 'correct' });

      await expect(promise).resolves.toBe('correct');
      pool.destroy();
    });
  });

  describe('execute - 超时处理', () => {
    it('超时后应 reject 并包含超时错误信息', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1, timeout: 1000 });

      const promise = pool.execute<string>('slowTask', { data: 'test' });

      // 触发超时
      vi.advanceTimersByTime(1001);

      await expect(promise).rejects.toThrow('Worker 任务超时: slowTask (1000ms)');
      pool.destroy();
    });

    it('超时错误信息应包含任务类型和超时时间', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1, timeout: 500 });

      const promise = pool.execute<string>('specificTask', {});

      vi.advanceTimersByTime(501);

      await expect(promise).rejects.toThrow('Worker 任务超时: specificTask (500ms)');
      pool.destroy();
    });

    it('成功响应后不应触发超时', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1, timeout: 1000 });

      const promise = pool.execute<string>('fastTask', {});
      const worker = MockWorker.instances[0];
      const callArg = worker.postMessage.mock.calls[0][0];

      // 在超时前响应
      worker.simulateMessage({ id: callArg.id, type: 'fastTask', payload: 'done' });
      vi.advanceTimersByTime(1001);

      await expect(promise).resolves.toBe('done');
      pool.destroy();
    });
  });

  describe('execute - 降级处理', () => {
    it('无 Worker 且有 fallback 时应调用 fallback', async () => {
      // 临时禁用 Worker
      (global as unknown as Record<string, unknown>).Worker = undefined;

      const createWorkerPool = await getCreateWorkerPool();
      const mockFallback = vi.fn().mockReturnValue('fallback result');
      const pool = createWorkerPool(fakeUrl, { size: 2, fallback: mockFallback });

      const result = await pool.execute('process', { text: 'test' });

      expect(mockFallback).toHaveBeenCalledWith('process', { text: 'test' });
      expect(result).toBe('fallback result');
      pool.destroy();
    });

    it('无 Worker 且无 fallback 时应抛出错误', async () => {
      (global as unknown as Record<string, unknown>).Worker = undefined;

      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });

      await expect(pool.execute('process', {})).rejects.toThrow('Worker 不可用且未配置降级处理');
      pool.destroy();
    });
  });

  describe('execute - 销毁后', () => {
    it('销毁后调用 execute 应抛出错误', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });
      pool.destroy();

      await expect(pool.execute('task', {})).rejects.toThrow('Worker pool 已销毁');
    });
  });

  describe('destroy', () => {
    it('应终止所有 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });
      const workers = MockWorker.instances.slice(-2);

      pool.destroy();

      workers.forEach((w) => {
        expect(w.terminate).toHaveBeenCalled();
      });
    });

    it('销毁后 size 应为 0', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });
      pool.destroy();

      expect(pool.size).toBe(0);
    });

    it('销毁时应拒绝所有待处理请求', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      // 提交任务但不响应，让其处于 pending 状态
      const pendingPromise = pool.execute<string>('pendingTask', {});

      pool.destroy();

      await expect(pendingPromise).rejects.toThrow('Worker pool 已销毁');
    });

    it('重复调用 destroy 应是安全的', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      expect(() => {
        pool.destroy();
        pool.destroy();
      }).not.toThrow();
    });
  });

  describe('size 属性', () => {
    it('初始 size 应等于配置值', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 3 });
      expect(pool.size).toBe(3);
      pool.destroy();
    });

    it('destroy 后 size 应为 0', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });
      pool.destroy();
      expect(pool.size).toBe(0);
    });
  });

  describe('hasIdle 属性', () => {
    it('初始时应有空闲 Worker', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('Worker 处理任务时 hasIdle 应反映实际状态', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 1 });

      // 提交任务，Worker 变为忙碌
      const promise = pool.execute<string>('task', {});
      expect(pool.hasIdle).toBe(false);

      // 响应后 Worker 恢复空闲
      const worker = MockWorker.instances[MockWorker.instances.length - 1];
      const callArg = worker.postMessage.mock.calls[0][0];
      worker.simulateMessage({ id: callArg.id, type: 'task', payload: 'done' });

      await promise;
      expect(pool.hasIdle).toBe(true);
      pool.destroy();
    });

    it('destroy 后 hasIdle 应为 false（无 Worker）', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });
      pool.destroy();
      expect(pool.hasIdle).toBe(false);
    });
  });

  describe('Worker 错误事件', () => {
    it('Worker onerror 事件应记录错误到 console', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const createWorkerPool = await getCreateWorkerPool();
      createWorkerPool(fakeUrl, { size: 1 });

      const worker = MockWorker.instances[MockWorker.instances.length - 1];
      worker.simulateError('Worker 内部错误');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[WorkerPool] Worker 错误:',
        'Worker 内部错误'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('请求/响应 ID 关联', () => {
    it('多个并发任务应正确关联各自响应', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl, { size: 2 });

      const promise1 = pool.execute<string>('task', { n: 1 });
      const promise2 = pool.execute<string>('task', { n: 2 });

      const workers = MockWorker.instances.slice(-2);
      const id1 = workers[0].postMessage.mock.calls[0][0].id;
      const id2 = workers[1].postMessage.mock.calls[0][0].id;

      // 以相反顺序响应，验证 ID 正确匹配
      workers[1].simulateMessage({ id: id2, type: 'task', payload: 'result-2' });
      workers[0].simulateMessage({ id: id1, type: 'task', payload: 'result-1' });

      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect(r1).toBe('result-1');
      expect(r2).toBe('result-2');
      pool.destroy();
    });
  });

  describe('默认值', () => {
    it('默认 timeout 应为 30000ms', async () => {
      const createWorkerPool = await getCreateWorkerPool();
      const pool = createWorkerPool(fakeUrl);

      const promise = pool.execute<string>('longTask', {});

      // 29999ms 不应超时
      vi.advanceTimersByTime(29999);
      // Promise 还未 settle

      // 30001ms 应超时
      vi.advanceTimersByTime(2);

      await expect(promise).rejects.toThrow('30000ms');
      pool.destroy();
    });
  });
});