/**
 * 日志模块（改造后：仅保留 re-export 和类型定义，移除猴子补丁和脱敏实现）
 *
 * 脱敏逻辑已迁移到 logging/redaction.ts（独立模块）
 * 日志引擎统一由 utils/logger.ts（pino）提供
 */

// 脱敏函数 re-export（向后兼容，新代码应直接导入 logging/redaction.ts）
export { redactSensitiveData, redactLogArgs } from './redaction';

// LogLevel 类型供 settings.controller 使用
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
