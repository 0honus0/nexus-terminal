import { logger } from '../logging/logger';

let nextTransportId = 0;

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
	const transportId = ++nextTransportId;
	logger.debug({ transportId, path: pathname }, 'WebSocket transport opening');
	const socket = options.protocols ? new WebSocket(url, options.protocols) : new WebSocket(url);
	let opened = false;
	socket.addEventListener(
		'open',
		() => {
			opened = true;
			logger.info(
				{ transportId, path: pathname, durationMs: Math.round(performance.now() - startedAt) },
				'WebSocket transport opened',
			);
		},
		{ once: true },
	);
	socket.addEventListener(
		'close',
		(event) => {
			const log =
				opened && ![1000, 1001, 1005].includes(event.code)
					? logger.warn.bind(logger)
					: logger.debug.bind(logger);
			log(
				{
					transportId,
					path: pathname,
					code: event.code,
					clean: event.wasClean,
					durationMs: Math.round(performance.now() - startedAt),
					bufferedBytes: socket.bufferedAmount,
				},
				'WebSocket transport closed',
			);
		},
		{ once: true },
	);
	socket.addEventListener(
		'error',
		() =>
			logger.debug(
				{ transportId, path: pathname, state: socket.readyState, bufferedBytes: socket.bufferedAmount },
				'WebSocket transport failed',
			),
		{ once: true },
	);
	return socket;
};
