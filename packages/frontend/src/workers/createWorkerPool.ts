/**
 * 通用 Worker 池管理器
 *
 * 提供 Promise-based 的 Worker 任务执行 API，支持：
 * - 多 Worker 并行处理
 * - 请求/响应 ID 关联
 * - 主线程降级兜底（Worker 不可用时）
 * - 资源清理
 */

import type { WorkerRequest, WorkerResponse } from './types';

/** 池中每个 Worker 的状态 */
interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

/** 待处理的请求队列项 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * 创建一个 Worker 池
 *
 * @param workerUrl - Worker 脚本的 URL（使用 Vite 的 `new URL(..., import.meta.url)` 模式）
 * @param options - 池配置
 * @returns 池控制对象
 */
export function createWorkerPool(
  workerUrl: URL,
  options: {
    /** 池大小，默认 2 */
    size?: number;
    /** 单个任务超时时间（毫秒），默认 30000 */
    timeout?: number;
    /** Worker 不可用时的降级处理函数 */
    fallback?: (type: string, payload: unknown) => unknown;
  } = {}
) {
  const { size = 2, timeout = 30000, fallback } = options;

  const workers: PoolWorker[] = [];
  const pending = new Map<string, PendingRequest>();
  let destroyed = false;

  /** 检测 Worker 是否可用 */
  const isWorkerAvailable = typeof Worker !== 'undefined';

  /** 初始化 Worker 池 */
  function init() {
    if (!isWorkerAvailable) return;

    for (let i = 0; i < size; i++) {
      try {
        const worker = new Worker(workerUrl, { type: 'module' });
        worker.onmessage = handleMessage;
        worker.onerror = handleWorkerError;
        workers.push({ worker, busy: false });
      } catch {
        // Worker 创建失败，静默忽略
      }
    }
  }

  /** 处理 Worker 响应 */
  function handleMessage(event: MessageEvent<WorkerResponse>) {
    const { id, error } = event.data;
    const request = pending.get(id);
    if (!request) return;

    pending.delete(id);
    clearTimeout(request.timeoutId);

    // 找到对应的 Worker 并标记为空闲
    const poolWorker = workers.find((w) => w.worker === event.target);
    if (poolWorker) poolWorker.busy = false;

    if (error) {
      request.reject(new Error(error));
    } else {
      request.resolve(event.data.payload);
    }

    // 尝试处理队列中的下一个请求
    processQueue();
  }

  /** 处理 Worker 错误 */
  function handleWorkerError(event: ErrorEvent) {
    console.error('[WorkerPool] Worker 错误:', event.message);
  }

  /** 处理等待队列 */
  function processQueue() {
    if (destroyed) return;

    // 找到空闲的 Worker
    const idleWorker = workers.find((w) => !w.busy);
    if (!idleWorker) return;

    // 从 pending 中找到等待最久的请求
    for (const [id, request] of pending) {
      // 跳过已超时的请求
      if (pending.has(id)) {
        idleWorker.busy = true;
        const message: WorkerRequest = {
          id,
          type: 'execute',
          payload: { requestType: id, data: request },
        };
        // 实际发送需要知道任务类型，这里通过 payload 传递
        // 由 execute 函数直接发送，此处仅处理队列调度
        break;
      }
    }
  }

  /**
   * 执行 Worker 任务
   *
   * @param taskType - 任务类型标识
   * @param payload - 任务载荷
   * @returns Promise<unknown> - 处理结果
   */
  async function execute<T>(taskType: string, payload: unknown): Promise<T> {
    // Worker 不可用时降级到主线程
    if (!isWorkerAvailable || workers.length === 0) {
      if (fallback) {
        return fallback(taskType, payload) as T;
      }
      throw new Error('Worker 不可用且未配置降级处理');
    }

    if (destroyed) {
      throw new Error('Worker pool 已销毁');
    }

    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();

      // 设置超时
      const timeoutId = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Worker 任务超时: ${taskType} (${timeout}ms)`));
      }, timeout);

      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      // 找到空闲 Worker 发送任务
      const idleWorker = workers.find((w) => !w.busy);
      if (idleWorker) {
        idleWorker.busy = true;
        const message: WorkerRequest = { id, type: taskType, payload };
        idleWorker.worker.postMessage(message);
      } else {
        // 所有 Worker 忙碌，等待空闲后自动发送
        // 通过轮询检查（简单实现，生产环境可用事件队列）
        const checkIdle = setInterval(() => {
          const worker = workers.find((w) => !w.busy);
          if (worker && pending.has(id)) {
            clearInterval(checkIdle);
            worker.busy = true;
            const message: WorkerRequest = { id, type: taskType, payload };
            worker.worker.postMessage(message);
          }
        }, 10);

        // 清理轮询（超时时自动清理）
        const origReject = reject;
        const origResolve = resolve;
        pending.set(id, {
          resolve: origResolve as (value: unknown) => void,
          reject: (err: Error) => {
            clearInterval(checkIdle);
            origReject(err);
          },
          timeoutId,
        });
      }
    });
  }

  /** 销毁 Worker 池，释放所有资源 */
  function destroy() {
    destroyed = true;

    // 拒绝所有待处理的请求
    for (const [id, request] of pending) {
      clearTimeout(request.timeoutId);
      request.reject(new Error('Worker pool 已销毁'));
    }
    pending.clear();

    // 终止所有 Worker
    for (const { worker } of workers) {
      worker.terminate();
    }
    workers.length = 0;
  }

  // 初始化
  init();

  return {
    /** 执行 Worker 任务 */
    execute,
    /** 销毁 Worker 池 */
    destroy,
    /** 当前池中 Worker 数量 */
    get size() {
      return workers.length;
    },
    /** 是否有空闲 Worker */
    get hasIdle() {
      return workers.some((w) => !w.busy);
    },
  };
}
