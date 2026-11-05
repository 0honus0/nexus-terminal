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
	const pathname = new URL(url).pathname;
	const startedAt = performance.now();
	logger.trace({ path: pathname }, 'WebSocket transport opening');
	const socket = options.protocols ? new WebSocket(url, options.protocols) : new WebSocket(url);
	socket.addEventListener(
		'open',
		() =>
			logger.trace(
				{ path: pathname, durationMs: Math.round(performance.now() - startedAt) },
				'WebSocket transport opened',
			),
		{ once: true },
	);
	socket.addEventListener(
		'close',
		(event) =>
			logger.debug(
				{
					path: pathname,
					code: event.code,
					clean: event.wasClean,
					durationMs: Math.round(performance.now() - startedAt),
					bufferedBytes: socket.bufferedAmount,
				},
				'WebSocket transport closed',
			),
		{ once: true },
	);
	socket.addEventListener(
		'error',
		() =>
			logger.debug(
				{ path: pathname, state: socket.readyState, bufferedBytes: socket.bufferedAmount },
				'WebSocket transport failed',
			),
		{ once: true },
	);
	return socket;
};
