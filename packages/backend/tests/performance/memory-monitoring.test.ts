/**
 * 内存监控测试
 *
 * 监控不同负载下的内存占用情况，验证：
 * - 空闲状态内存占用是否在合理范围
 * - SSH/SFTP 会话是否存在内存泄漏
 * - 并发连接数增加时内存增长是否线性
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PERFORMANCE_THRESHOLDS } from './thresholds';
import { EventEmitter } from 'events';

/**
 * 获取当前内存使用情况（字节）
 */
function getMemoryUsage(): {
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
} {
  const usage = process.memoryUsage();
  return {
    rss: usage.rss,
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    external: usage.external,
  };
}

/**
 * 格式化内存大小
 */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 模拟 SSH 会话（用于内存占用测试）
 */
class MockSSHSession extends EventEmitter {
  private buffer: Buffer;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    // 模拟会话缓冲区（约 2MB）
    this.buffer = Buffer.alloc(2 * 1024 * 1024);
  }

  start() {
    // 模拟周期性数据流（防止被 GC 清理）
    this.timer = setInterval(() => {
      this.emit('data', Buffer.from('test data'));
    }, 1000);
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeAllListeners();
  }
}

/**
 * 等待垃圾回收并稳定内存
 */
async function waitForGC(iterations = 3): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    if (global.gc) {
      global.gc();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Memory Monitoring Tests', () => {
  beforeEach(async () => {
    // 每个测试前强制 GC
    await waitForGC();
  });

  afterEach(async () => {
    // 每个测试后清理内存
    await waitForGC();
  });

  it('空闲状态内存占用应该 < 100MB（heapUsed）', async () => {
    await waitForGC();
    const baseline = getMemoryUsage();

    console.log(`空闲状态内存占用:
      - RSS: ${formatBytes(baseline.rss)}
      - Heap Used: ${formatBytes(baseline.heapUsed)}
      - Heap Total: ${formatBytes(baseline.heapTotal)}
      - External: ${formatBytes(baseline.external)}
    `);

    // 注意：这里只检查 heapUsed，因为 RSS 包含 V8 引擎本身的开销
    expect(baseline.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.memory.backendIdle);
  });

  it('单个 SSH 会话内存增量应该 < 5MB', async () => {
    const baseline = getMemoryUsage();

    const session = new MockSSHSession();
    session.start();

    // 等待会话稳定
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const afterSession = getMemoryUsage();
    const increment = afterSession.heapUsed - baseline.heapUsed;

    console.log(`SSH 会话内存增量:
      - 基线: ${formatBytes(baseline.heapUsed)}
      - 会话后: ${formatBytes(afterSession.heapUsed)}
      - 增量: ${formatBytes(increment)}
    `);

    session.destroy();
    await waitForGC();

    expect(increment).toBeLessThan(PERFORMANCE_THRESHOLDS.memory.sshSessionIncrement);
  }, 10000);

  it('10 个并发 SSH 会话内存占用应该 < 150MB（基线 + 10 * 5MB）', async () => {
    const baseline = getMemoryUsage();
    const sessions: MockSSHSession[] = [];

    // 创建 10 个会话
    for (let i = 0; i < 10; i++) {
      const session = new MockSSHSession();
      session.start();
      sessions.push(session);
    }

    // 等待所有会话稳定
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const afterSessions = getMemoryUsage();
    const totalIncrement = afterSessions.heapUsed - baseline.heapUsed;

    console.log(`10 个并发 SSH 会话内存占用:
      - 基线: ${formatBytes(baseline.heapUsed)}
      - 会话后: ${formatBytes(afterSessions.heapUsed)}
      - 总增量: ${formatBytes(totalIncrement)}
      - 平均每会话: ${formatBytes(totalIncrement / 10)}
    `);

    // 清理所有会话
    sessions.forEach((session) => session.destroy());
    await waitForGC();

    // 验证清理后内存是否恢复
    const afterCleanup = getMemoryUsage();
    const residual = afterCleanup.heapUsed - baseline.heapUsed;

    console.log(`清理后内存残留: ${formatBytes(residual)}`);

    const expectedMaxIncrement = 10 * PERFORMANCE_THRESHOLDS.memory.sshSessionIncrement;
    expect(totalIncrement).toBeLessThan(expectedMaxIncrement);

    // 清理后残留应小于单个会话的增量（容忍一定误差）
    expect(residual).toBeLessThan(PERFORMANCE_THRESHOLDS.memory.sshSessionIncrement * 2);
  }, 15000);

  it('内存泄漏检测：创建/销毁 100 个会话后内存应恢复', async () => {
    const baseline = getMemoryUsage();

    for (let i = 0; i < 100; i++) {
      const session = new MockSSHSession();
      session.start();
      await new Promise((resolve) => setTimeout(resolve, 10));
      session.destroy();
    }

    await waitForGC(5); // 多次 GC 确保清理干净

    const afterTest = getMemoryUsage();
    const growth = afterTest.heapUsed - baseline.heapUsed;

    console.log(`内存泄漏检测结果:
      - 基线: ${formatBytes(baseline.heapUsed)}
      - 测试后: ${formatBytes(afterTest.heapUsed)}
      - 增长: ${formatBytes(growth)}
    `);

    // 允许 10MB 内存增长（考虑测试过程中的正常内存波动）
    expect(growth).toBeLessThan(10 * 1024 * 1024);
  }, 20000);

  it('峰值内存占用应该 < 500MB（50 个并发连接）', async () => {
    const sessions: MockSSHSession[] = [];

    // 创建 50 个并发会话（达到阈值上限）
    for (let i = 0; i < PERFORMANCE_THRESHOLDS.concurrent.sshConnections; i++) {
      const session = new MockSSHSession();
      session.start();
      sessions.push(session);
    }

    // 等待所有会话稳定
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const peakMemory = getMemoryUsage();

    console.log(`峰值内存占用（${PERFORMANCE_THRESHOLDS.concurrent.sshConnections} 个会话）:
      - RSS: ${formatBytes(peakMemory.rss)}
      - Heap Used: ${formatBytes(peakMemory.heapUsed)}
      - Heap Total: ${formatBytes(peakMemory.heapTotal)}
    `);

    // 清理所有会话
    sessions.forEach((session) => session.destroy());
    await waitForGC();

    expect(peakMemory.heapUsed).toBeLessThan(PERFORMANCE_THRESHOLDS.memory.maxTotalMemory);
  }, 30000);
});
