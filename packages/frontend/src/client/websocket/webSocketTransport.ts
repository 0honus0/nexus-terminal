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
  return options.protocols ? new WebSocket(url, options.protocols) : new WebSocket(url);
};
