import pino from 'pino';

// 从环境变量读取日志级别，默认 info
// 支持的级别: debug < info < warn < error < silent
const initialLevel = process.env.LOG_LEVEL || 'info';

/**
 * 基于 pino 的结构化 JSON 日志实例
 * - 通过 LOG_LEVEL 环境变量控制输出级别
 * - 支持运行时通过 setLogLevel() 动态调整
 * - 输出格式为 JSON，便于日志聚合与检索
 * - 自动附加 ISO 8601 时间戳
 */
const pinoLogger = pino({
  level: initialLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * 运行时动态调整 pino 日志级别
 * 与 logging/logger.ts 的 setLogLevel 保持同步，
 * 确保通过 API 修改日志等级后，使用 utils/logger 的模块也能立即响应。
 *
 * @param level 目标日志级别
 */
export const setLogLevel = (level: string): void => {
  pinoLogger.level = level;
};

/**
 * 获取当前 pino 日志级别
 */
export const getLogLevel = (): string => pinoLogger.level;

/**
 * 统一日志工具
 * 导出 info / warn / error / debug 四个方法，可在任意模块中直接引用。
 *
 * 使用示例：
 *   import { logger } from '../utils/logger';
 *   logger.info('服务启动完成');
 *   logger.warn({ port }, '端口已被占用');
 *   logger.error(err, '数据库连接失败');
 *   logger.debug({ query }, '执行 SQL 查询');
 */
export const logger = {
  info: pinoLogger.info.bind(pinoLogger),
  warn: pinoLogger.warn.bind(pinoLogger),
  error: pinoLogger.error.bind(pinoLogger),
  debug: pinoLogger.debug.bind(pinoLogger),
};
