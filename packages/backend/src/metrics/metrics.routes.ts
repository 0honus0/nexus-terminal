/**
 * Prometheus Metrics 路由
 * 暴露 /api/v1/metrics 端点，无需认证
 */

import express from 'express';
import { getMetrics } from './metrics.controller';

const router = express.Router();

/**
 * GET /api/v1/metrics
 * 返回 Prometheus 文本格式的全部指标（默认指标 + 自定义指标）
 * 此端点不需要认证，供 Prometheus 服务器定期抓取
 */
router.get('/', getMetrics);

export default router;
