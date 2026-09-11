import { logger } from '../logging/logger';

export interface WebSocketOpenOptions {
  protocols?: string | string[];
}

export const createWebSocketUrl = (path: string): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}//${window.location.host}${normalizedPath}`;
};

export const openWebSocket = (path: string, options: WebSocketOpenOptions = {}): WebSocket => {
  const url = createWebSocketUrl(path);
  logger.trace({ path: path.split(/[?#]/, 1)[0] || '/' }, 'WebSocket transport opening');
  return options.protocols ? new WebSocket(url, options.protocols) : new WebSocket(url);
};
