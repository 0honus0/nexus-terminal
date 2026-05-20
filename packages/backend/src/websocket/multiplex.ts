/**
 * WebSocket 多路复用传输管理器
 * 管理单个物理 WebSocket 连接上的多个逻辑 SSH 会话通道
 *
 * 设计思路：
 * - 每个逻辑通道通过 sid (Session ID) 标识
 * - 消息中携带 sid 字段实现路由
 * - 物理连接断开时，所有通道自动清理
 * - 通过 ENABLE_MULTIPLEX 环境变量控制开关
 */

import WebSocket from 'ws';
import { logger } from '../utils/logger';
import { destroyBatcher } from './output-batcher';

/** 逻辑通道状态 */
export interface ChannelState {
  sid: string;
  createdAt: number;
  isAlive: boolean;
}

/** 多路复用管理器接口 */
export interface MultiplexTransport {
  /** 物理 WebSocket 连接 */
  ws: WebSocket;
  /** 逻辑通道映射 (sid -> ChannelState) */
  channels: Map<string, ChannelState>;
  /** 创建逻辑通道 */
  createChannel(sid: string): ChannelState;
  /** 移除逻辑通道 */
  removeChannel(sid: string): void;
  /** 向指定通道发送消息 */
  sendToChannel(sid: string, message: unknown): boolean;
  /** 向所有通道广播消息 */
  broadcast(message: unknown): number;
  /** 获取通道数量 */
  getChannelCount(): number;
  /** 检查通道是否存在 */
  hasChannel(sid: string): boolean;
  /** 清理所有通道 */
  cleanup(): void;
}

/**
 * 创建多路复用传输管理器
 * @param ws 共享的物理 WebSocket 连接
 * @returns MultiplexTransport 实例
 */
export function createMultiplexTransport(ws: WebSocket): MultiplexTransport {
  const channels = new Map<string, ChannelState>();

  const createChannel = (sid: string): ChannelState => {
    if (channels.has(sid)) {
      logger.warn({ sid }, '通道已存在，将覆盖旧通道');
    }

    const channel: ChannelState = {
      sid,
      createdAt: Date.now(),
      isAlive: true,
    };
    channels.set(sid, channel);

    logger.debug({ sid, channelCount: channels.size }, '创建通道');
    return channel;
  };

  const removeChannel = (sid: string): void => {
    if (channels.delete(sid)) {
      logger.debug({ sid, remaining: channels.size }, '移除通道');
    }
  };

  const sendToChannel = (sid: string, message: unknown): boolean => {
    if (!channels.has(sid)) {
      logger.warn({ sid }, '尝试向不存在的通道发送消息');
      return false;
    }

    if (ws.readyState !== WebSocket.OPEN) {
      logger.warn({ sid }, '物理连接未打开，无法向通道发送消息');
      return false;
    }

    try {
      const messageWithSid =
        typeof message === 'object' && message !== null
          ? { ...(message as Record<string, unknown>), sid }
          : { sid, payload: message };
      ws.send(JSON.stringify(messageWithSid));
      return true;
    } catch (error) {
      logger.error({ sid, err: error }, '向通道发送消息失败');
      return false;
    }
  };

  const broadcast = (message: unknown): number => {
    if (ws.readyState !== WebSocket.OPEN) {
      return 0;
    }

    let successCount = 0;

    channels.forEach((_channel, sid) => {
      try {
        const messageWithSid =
          typeof message === 'object' && message !== null
            ? { ...(message as Record<string, unknown>), sid }
            : { sid, payload: message };
        ws.send(JSON.stringify(messageWithSid));
        successCount++;
      } catch (error) {
        logger.error({ sid, err: error }, '广播到通道失败');
      }
    });

    return successCount;
  };

  const getChannelCount = (): number => channels.size;

  const hasChannel = (sid: string): boolean => channels.has(sid);

  const cleanup = (): void => {
    const count = channels.size;
    channels.forEach((_channel, sid) => {
      logger.debug({ sid }, '清理通道');
      destroyBatcher(sid);
      channels.delete(sid);
    });
    logger.info({ count }, '已清理通道');
  };

  return {
    ws,
    channels,
    createChannel,
    removeChannel,
    sendToChannel,
    broadcast,
    getChannelCount,
    hasChannel,
    cleanup,
  };
}

/**
 * 全局多路复用传输管理
 * 存储所有活跃的多路复用连接 (ws -> transport)
 */
const activeTransports = new Map<WebSocket, MultiplexTransport>();

/**
 * 注册多路复用传输
 */
export function registerTransport(ws: WebSocket, transport: MultiplexTransport): void {
  activeTransports.set(ws, transport);
  logger.debug({ activeCount: activeTransports.size }, '注册传输');
}

/**
 * 注销多路复用传输
 */
export function unregisterTransport(ws: WebSocket): void {
  if (activeTransports.delete(ws)) {
    logger.debug({ remaining: activeTransports.size }, '注销传输');
  }
}

/**
 * 获取指定 WebSocket 的多路复用传输
 */
export function getTransport(ws: WebSocket): MultiplexTransport | undefined {
  return activeTransports.get(ws);
}

/**
 * 清理所有多路复用传输
 */
export function cleanupAllTransports(): void {
  activeTransports.forEach((transport) => {
    transport.cleanup();
  });
  activeTransports.clear();
  logger.info('已清理所有传输');
}

/**
 * 检查是否启用多路复用
 * 支持 'true' 和 '1' 两种写法，与 env validator 保持一致
 */
export function isMultiplexEnabled(): boolean {
  const val = process.env.ENABLE_MULTIPLEX;
  return val === 'true' || val === '1';
}
