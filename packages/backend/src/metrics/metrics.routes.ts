/**
 * Prometheus Metrics 路由
 * 暴露 /api/v1/metrics 端点
 * 仅允许内网或通过 METRICS_TOKEN 认证的请求访问
 */

import express, { Request, Response, NextFunction } from 'express';
import { getMetrics } from './metrics.controller';

const router = express.Router();

/**
 * Metrics 访问控制中间件
 * - 生产环境：要求 X-Metrics-Token 头与 METRICS_TOKEN 环境变量匹配
 * - 开发环境：直接放行
 */
const metricsAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const requiredToken = process.env.METRICS_TOKEN;
  if (!requiredToken) {
    // 未配置 token 时拒绝访问，防止公网暴露
    res.status(403).json({ success: false, error: 'Metrics 端点未配置访问令牌' });
    return;
  }

  const providedToken = req.headers['x-metrics-token'];
  if (providedToken === requiredToken) {
    return next();
  }

  res.status(401).json({ success: false, error: 'Metrics 认证失败' });
};

/**
 * GET /api/v1/metrics
 * 返回 Prometheus 文本格式的全部指标（默认指标 + 自定义指标）
 */
router.get('/', metricsAuth, getMetrics);

export default router;
