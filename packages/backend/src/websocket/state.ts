import WebSocket from 'ws';
import { ClientState, AuthenticatedWebSocket } from './types';
import { SftpService } from '../sftp/sftp.service';
import { StatusMonitorService } from '../services/status-monitor.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { DockerService } from '../docker/docker.service';
import { settingsService } from '../settings/settings.service'; // 添加导入
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';

// 存储所有活动客户端的状态 (key: sessionId)
export const clientStates = new Map<string, ClientState>();

// 注意：userSockets 支持同一用户多设备连接（多 WebSocket），但 clientStates 按 sessionId（1:1）映射。
// 这意味着同一用户在不同设备上会创建独立的 SSH 会话（各自有独立的 clientStates 条目），
// 但共享同一 userId 的 WebSocket 广播通道。切换设备不会自动迁移或同步 SSH 会话状态。
// 如需跨设备会话列表，可通过 /api/v1/ssh-suspend/suspended-sessions 获取当前用户的挂起会话。

// --- Per-session 互斥锁 ---
// Map 中的 ClientState 可能被多个异步上下文（WebSocket 消息处理器、定时器、SFTP 操作等）并发访问。
// 为每个 sessionId 维护一个 Promise 链，确保对同一会话的状态操作串行执行，
// 消除 await 点产生的交错窗口，防止状态不一致或竞态条件。
const sessionLocks = new Map<string, Promise<void>>();

/**
 * 获取指定 sessionId 的互斥锁。
 * 返回一个 Promise，在获取锁时 resolve，调用方应在锁内执行关键操作。
 * 操作完成后必须调用 release() 释放锁。
 * @param sessionId 会话标识符
 * @returns {{ lock: Promise<void>, release: () => void }}
 */
export function acquireSessionLock(sessionId: string): {
  lock: Promise<void>;
  release: () => void;
} {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = () => {
      resolve();
      sessionLocks.delete(sessionId);
    };
  });
  // 链接前一个锁，确保串行执行
  sessionLocks.set(
    sessionId,
    prev.then(() => next)
  );
  return { lock: prev, release };
}

// 存储 userId 到 WebSocket 连接集合的映射 (支持一个用户多个连接)
export const userSockets = new Map<number, Set<AuthenticatedWebSocket>>();

/**
 * 注册用户 WebSocket 连接
 * 当新的 WebSocket 连接建立时调用
 * @param userId 用户 ID
 * @param ws WebSocket 连接实例
 */
export function registerUserSocket(userId: number, ws: AuthenticatedWebSocket): void {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  const sockets = userSockets.get(userId);
  if (!sockets) {
    return;
  }
  sockets.add(ws);
  logger.info(`[WebSocket 状态] 用户 ${userId} 的连接已注册，当前连接数: ${sockets.size}`);
}

/**
 * 注销用户 WebSocket 连接
 * 当 WebSocket 连接断开时调用
 * @param userId 用户 ID
 * @param ws WebSocket 连接实例
 */
export function unregisterUserSocket(userId: number, ws: AuthenticatedWebSocket): void {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) {
      userSockets.delete(userId);
      logger.info(`[WebSocket 状态] 用户 ${userId} 的所有连接已断开，已清理映射。`);
    } else {
      logger.info(`[WebSocket 状态] 用户 ${userId} 的一个连接已断开，剩余连接数: ${sockets.size}`);
    }
  }
}

/**
 * 向指定用户的所有活动 WebSocket 连接广播消息
 * @param userId 用户 ID
 * @param message 要发送的消息对象（将自动序列化为 JSON）
 * @returns 成功发送的连接数
 */
export function broadcastToUser(userId: number, message: unknown): number {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) {
    logger.warn(`[WebSocket 广播] 用户 ${userId} 没有活动连接，消息未发送。`);
    return 0;
  }

  let successCount = 0;
  const messageStr = JSON.stringify(message);
  const deadSockets: AuthenticatedWebSocket[] = [];

  sockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(messageStr);
        successCount++;
      } catch (error: unknown) {
        logger.error(
          `[WebSocket 广播] 向用户 ${userId} 的一个连接发送消息失败:`,
          getErrorMessage(error)
        );
        deadSockets.push(ws);
      }
    } else {
      // 连接未打开（已关闭或正在关闭），标记为死连接
      deadSockets.push(ws);
    }
  });

  // 清理死连接
  if (deadSockets.length > 0) {
    deadSockets.forEach((ws) => sockets.delete(ws));
    logger.info(`[WebSocket 广播] 已清理用户 ${userId} 的 ${deadSockets.length} 个死连接。`);

    // 如果所有连接都已死亡，清理整个映射
    if (sockets.size === 0) {
      userSockets.delete(userId);
    }
  }

  logger.info(
    `[WebSocket 广播] 已向用户 ${userId} 的 ${successCount}/${sockets.size + deadSockets.length} 个连接发送消息。`
  );
  return successCount;
}

// --- 服务实例化 ---
// 将 clientStates 传递给需要访问共享状态的服务
export const sftpService = new SftpService(clientStates);
export const statusMonitorService = new StatusMonitorService(clientStates);
export const auditLogService = new AuditLogService(); // 实例化 AuditLogService
export const notificationService = new NotificationService(); // 添加实例
export const dockerService = new DockerService(); // 实例化 DockerService (主要用于类型或未来可能的本地调用)
export { settingsService }; // 导出 settingsService
