/**
 * Prometheus Metrics 路由
 * 暴露 /api/v1/metrics 端点，无需认证
 */

import express, { Request, Response } from 'express';
import { registry } from './metrics.service';
import { logger } from '../utils/logger';

const router = express.Router();

/**
 * GET /api/v1/metrics
 * 返回 Prometheus 文本格式的全部指标（默认指标 + 自定义指标）
 * 此端点不需要认证，供 Prometheus 服务器定期抓取
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    res.setHeader('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (error) {
    logger.error(error as Error, '[Metrics] 生成指标数据失败');
    res.status(500).end('指标采集失败');
  }
});

export default router;
