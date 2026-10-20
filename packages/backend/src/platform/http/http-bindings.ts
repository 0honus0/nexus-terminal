import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_WEBSOCKET_FRAME_BYTES } from './http-limits.js';
import type { HttpBindings, HttpWebSocketRoute } from './http-types.js';
import { compileHttpRoutes } from './http-router.js';
import { createHttpRequestHandler } from './http-request.js';

export interface CompiledHttpBindings {
	origins: readonly URL[];
	webSockets: ReadonlyMap<string, HttpWebSocketRoute>;
	handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

/** Build the whole replacement before publication; invalid routes cannot partially rebind a listener. */
export function compileHttpBindings(
	publicOrigin: string,
	bindings: HttpBindings,
	trust: (address: string, index: number) => boolean,
): CompiledHttpBindings {
	const origin = new URL(publicOrigin);
	if (
		!['http:', 'https:'].includes(origin.protocol) ||
		origin.pathname !== '/' ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password
	) {
		throw new Error('Invalid external HTTP origin');
	}
	const origins = [origin];
	for (const raw of bindings.allowedOrigins ?? []) {
		const extra = new URL(raw);
		if (raw !== extra.origin || extra.protocol !== origin.protocol || extra.username || extra.password) {
			throw new Error('Invalid additional HTTP origin');
		}
		if (!origins.some((current) => current.origin === extra.origin)) {
			origins.push(extra);
		}
	}
	if (origins.length > 17) {
		throw new Error('Too many HTTP origins');
	}
	const webSockets = new Map<string, HttpWebSocketRoute>();
	for (const route of bindings.webSockets ?? []) {
		if (
			webSockets.has(route.path) ||
			!!route.connected === !!route.connectedRaw ||
			(route.maxTextMessageBytes !== undefined && !isFrameBudget(route.maxTextMessageBytes)) ||
			(route.maxBufferedTextBytes !== undefined && !isFrameBudget(route.maxBufferedTextBytes)) ||
			(route.maxBinaryMessageBytes !== undefined && !isFrameBudget(route.maxBinaryMessageBytes))
		) {
			throw new Error('Invalid or duplicate WebSocket route');
		}
		webSockets.set(route.path, route);
	}
	const router = compileHttpRoutes(bindings.routes);
	return {
		origins,
		webSockets,
		handle: createHttpRequestHandler({ origins, trust, router, admitUnmatched: bindings.admitUnmatched }),
	};
}

function isFrameBudget(value: number): boolean {
	return Number.isSafeInteger(value) && value >= 1 && value <= MAX_WEBSOCKET_FRAME_BYTES;
}
