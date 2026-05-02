/**
 * Prometheus Metrics 控制器
 * 处理 /api/v1/metrics 端点的请求与响应
 */

import { Request, Response } from 'express';
import { registry } from './metrics.service';
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';

/**
 * GET /api/v1/metrics
 * 返回 Prometheus 文本格式的全部指标（默认指标 + 自定义指标）
 * 此端点不需要认证，供 Prometheus 服务器定期抓取
 */
export const getMetrics = async (_req: Request, res: Response): Promise<void> => {
  try {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (error: unknown) {
    logger.error(`[Metrics] 生成指标数据失败: ${getErrorMessage(error)}`);
    res.status(500).end('指标采集失败');
  }
};
