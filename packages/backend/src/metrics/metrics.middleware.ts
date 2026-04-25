/**
 * HTTP 请求延迟采集中间件
 * 在每个请求完成时记录处理耗时，写入 httpRequestDuration 直方图
 */

import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration } from './metrics.service';

/**
 * Express 中间件：记录每个 HTTP 请求的处理延迟
 * 放在路由注册之前调用，确保所有请求均被采集
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // 记录请求开始时间
  const end = httpRequestDuration.startTimer();

  // 监听响应完成事件，在响应结束时记录延迟
  res.on('finish', () => {
    // 优先使用路由级路径（如 /api/v1/connections/:id），避免高基数标签
    const route = req.route?.path || 'unmatched_route';
    end({
      method: req.method,
      route,
      status_code: String(res.statusCode),
    });
  });

  next();
};
