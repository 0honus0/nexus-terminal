/**
 * 前端统一日志工具
 *
 * 设计原则：
 * - dev 模式下所有日志通过 console 输出，不依赖外部服务
 * - prod 模式下 debug 级别日志被静默丢弃（import.meta.env.DEV 守卫在构建时消除）
 * - ?log=debug URL 参数可激活 debug 级别输出
 * - localStorage key 'nexus-terminal:verbose' 持久化 verbose 开关
 */

const VERBOSE_KEY = 'nexus-terminal:verbose';

let _isVerbose = false;

/** 初始化 verbose 状态：从 URL 参数或 localStorage 读取 */
function initVerbose(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('log') === 'debug') {
    _isVerbose = true;
    try {
      localStorage.setItem(VERBOSE_KEY, 'true');
    } catch {
      // localStorage 不可用时静默忽略
    }
  } else {
    try {
      _isVerbose = localStorage.getItem(VERBOSE_KEY) === 'true';
    } catch {
      _isVerbose = false;
    }
  }
}

// 模块加载时立即初始化
initVerbose();

/** 获取当前 verbose 状态 */
export function isVerbose(): boolean {
  return _isVerbose;
}

/** 设置 verbose 状态并持久化 */
export function setVerbose(enabled: boolean): void {
  _isVerbose = enabled;
  try {
    if (enabled) {
      localStorage.setItem(VERBOSE_KEY, 'true');
    } else {
      localStorage.removeItem(VERBOSE_KEY);
    }
  } catch {
    // localStorage 不可用时静默忽略
  }
}

/**
 * 日志工具对象
 *
 * - info / warn / error：始终输出
 * - debug：dev 模式下需 verbose 激活（?log=debug）；prod 模式下不输出
 *
 * 使用示例：
 *   import { log } from '@/utils/log';
 *   log.info('WebSocket 已连接');
 *   log.warn({ sessionId }, '会话即将超时');
 *   log.error(err, '连接断开');
 *   log.debug({ payload }, '收到消息');
 */
export const log = {
  info: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.info(...args);
  },
  warn: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.warn(...args);
  },
  error: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.error(...args);
  },
  debug: (...args: unknown[]) => {
    if (import.meta.env.DEV && _isVerbose) {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  },
};
