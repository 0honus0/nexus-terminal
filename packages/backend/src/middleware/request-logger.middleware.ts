/**
 * 请求级日志中间件
 * 为每个请求生成 requestId 并注入 req，所有后续日志自动携带
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

// 跳过日志的高频低价值端点前缀
const SKIP_PATH_PREFIXES = ['/api/v1/health', '/api/v1/metrics'];

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  const startTime = Date.now();

  req.requestId = requestId;

  // 跳过健康检查等高频低价值端点（支持尾斜杠）
  const skip = SKIP_PATH_PREFIXES.some(
    (prefix) => req.path === prefix || req.path === prefix + '/'
  );

  if (!skip) {
    logger.info({ requestId, method: req.method, path: req.path }, '请求开始');
  }

  const logCompletion = () => {
    if (skip) return;
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      {
        requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
      },
      '请求完成'
    );
  };

  // 监听 finish（正常完成）和 close（客户端中断）
  res.on('finish', logCompletion);
  res.on('close', logCompletion);

  next();
};
