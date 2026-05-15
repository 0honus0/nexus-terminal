/**
 * 内置事件中间件
 * 提供日志记录和事件持久化功能
 */
import { logger } from '../utils/logger';
import { getDbInstance } from '../database/connection';
import {
  type AppEventPayload,
  type AppEventType,
  type EventMiddleware,
  PERSISTENT_EVENTS,
} from '../types/event.types';

/**
 * 日志中间件
 * 以 debug 级别记录事件触发信息，替代 emitEvent 中原有的 info 级别日志
 * 降低日志噪音，同时保留调试能力
 */
export const loggingMiddleware: EventMiddleware = (
  eventType: AppEventType,
  _payload: AppEventPayload,
  next: () => void
): void => {
  logger.debug(`[Event] ${eventType}`);
  next();
};

/**
 * 持久化中间件
 * 对 PERSISTENT_EVENTS 中的事件异步写入 event_logs 表
 * 采用 fire-and-forget 模式，不阻塞事件发送
 */
export const persistenceMiddleware: EventMiddleware = (
  eventType: AppEventType,
  payload: AppEventPayload,
  next: () => void
): void => {
  // 仅持久化关键事件
  if (!PERSISTENT_EVENTS.has(eventType)) {
    next();
    return;
  }

  // 先调用 next()，确保事件先发送给监听器
  next();

  // 异步持久化，不阻塞事件流
  persistEvent(eventType, payload).catch((error) => {
    logger.error(`[EventPersistence] 事件持久化失败: ${(error as Error).message}`, {
      eventType,
    });
  });
};

/**
 * 异步持久化事件到数据库
 */
async function persistEvent(eventType: AppEventType, payload: AppEventPayload): Promise<void> {
  const db = await getDbInstance();
  const userId = payload.userId ?? null;
  const payloadJson = JSON.stringify({
    userId: payload.userId,
    details: payload.details,
  });

  await new Promise<void>((resolve, reject) => {
    db.run(
      `INSERT INTO event_logs (event_type, user_id, payload) VALUES (?, ?, ?)`,
      [eventType, userId, payloadJson],
      (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}
