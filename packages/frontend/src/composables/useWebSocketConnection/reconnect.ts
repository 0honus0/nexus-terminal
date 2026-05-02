/**
 * WebSocket 重连逻辑
 * 从 useWebSocketConnection.ts 提取，负责重连策略与状态管理
 */

export interface ReconnectState {
  attempts: number;
  maxAttempts: number;
  timeoutId: ReturnType<typeof setTimeout> | null;
  intentionalDisconnect: boolean;
  lastUrl: string;
}

/**
 * 创建重连状态管理器
 */
export function createReconnectManager(options?: { maxAttempts?: number }) {
  const state: ReconnectState = {
    attempts: 0,
    maxAttempts: options?.maxAttempts ?? 5,
    timeoutId: null,
    intentionalDisconnect: false,
    lastUrl: '',
  };

  /**
   * 计算指数退避延迟（含随机抖动）
   */
  const getBackoffDelay = (attempt: number): number => {
    return 2 ** attempt * 1000 + Math.random() * 1000;
  };

  /**
   * 检查是否应该尝试重连
   */
  const shouldReconnect = (): boolean => {
    if (state.intentionalDisconnect) return false;
    if (state.attempts >= state.maxAttempts) return false;
    return true;
  };

  /**
   * 增加重连尝试次数
   */
  const incrementAttempts = (): number => {
    state.attempts++;
    return state.attempts;
  };

  /**
   * 重置重连状态（连接成功时调用）
   */
  const reset = (): void => {
    state.attempts = 0;
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
  };

  /**
   * 清除重连定时器
   */
  const clearTimer = (): void => {
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
  };

  /**
   * 设置重连定时器
   */
  const scheduleTimer = (callback: () => void, delay: number): void => {
    clearTimer();
    state.timeoutId = setTimeout(callback, delay);
  };

  return {
    state,
    getBackoffDelay,
    shouldReconnect,
    incrementAttempts,
    reset,
    clearTimer,
    scheduleTimer,
  };
}
