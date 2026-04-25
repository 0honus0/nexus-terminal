/**
 * Prometheus Metrics 服务
 * 负责初始化 prom-client 默认指标与自定义业务指标
 */

import * as promClient from 'prom-client';
import { clientStates } from '../websocket/state';

// 创建独立注册表，避免与默认全局注册表冲突
const registry = new promClient.Registry();

// 设置默认标签（应用名称），所有指标都会附加此标签
registry.setDefaultLabels({ app: 'nexus-terminal' });

/**
 * 启用默认指标采集
 * 包含：process_cpu_user_seconds_total、process_resident_memory_bytes、
 *       nodejs_heap_used_bytes、nodejs_heap_total_bytes 等 Node.js 运行时指标
 */
promClient.collectDefaultMetrics({ register: registry });

// --- 自定义指标 ---

/**
 * HTTP 请求延迟直方图
 * 标签：method（HTTP 方法）、route（路由路径）、status_code（响应状态码）
 */
export const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP 请求延迟分布（秒）',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

/**
 * 活跃 WebSocket 连接数（仪表盘指标）
 * 通过 collect 回调在每次抓取时实时计算，无需手动增减
 */
export const websocketActiveConnections = new promClient.Gauge({
  name: 'websocket_active_connections',
  help: '当前活跃的 WebSocket 连接数',
  registers: [registry],
  collect() {
    // 每次 Prometheus 抓取时，从 clientStates 实时读取连接数
    this.set(clientStates.size);
  },
});

/**
 * 活跃 SSH 会话数（仪表盘指标）
 * 统计已建立 SSH Shell 连接的客户端数量
 */
export const sshActiveSessions = new promClient.Gauge({
  name: 'ssh_active_sessions',
  help: '当前活跃的 SSH 会话数',
  registers: [registry],
  collect() {
    // 统计拥有 sshShellStream 的客户端数量
    let count = 0;
    clientStates.forEach((state) => {
      if (state.sshShellStream) {
        count++;
      }
    });
    this.set(count);
  },
});

/**
 * 获取注册表实例，供路由层使用
 */
export { registry };
