import type { Logger } from '../logging/logger.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type WebSocket from 'ws';

import type { FastifyReply, FastifyRequest, RouteOptions, RawServerDefault } from 'fastify';

export interface HttpRouteParameters {
	Params: Record<string, string>;
	Querystring: URLSearchParams;
	Body: unknown;
}

/** Native Fastify contracts with the application's strictly decoded query representation. */
export type HttpRequest = FastifyRequest<HttpRouteParameters>;

export type HttpReply = FastifyReply;

export type HttpRoute = RouteOptions<RawServerDefault, IncomingMessage, ServerResponse, HttpRouteParameters>;

declare module 'fastify' {
	interface FastifyRequest {
		/** Validated installation origin, never an unchecked Host or forwarded header. */
		origin: string;
	}
	interface FastifyContextConfig {
		/** The route owns streaming ingress and its explicit byte/deadline budget. */
		rawBody?: boolean;
		/** Enables native multipart parsing with a total encoded budget distinct from JSON bodyLimit. */
		multipartBodyLimit?: number;
	}
}

export interface HttpBindings {
	allowedOrigins?: readonly string[];
	/** Optional application admission for paths without an installed route. */
	admitUnmatched?: (sourceIp: string) => Promise<boolean>;
	routes: readonly HttpRoute[];
	webSockets?: readonly HttpWebSocketRoute[];
}

export interface HttpServerOptions extends HttpBindings {
	logger?: Logger;
	/** Explicit external URL prevents Host/X-Forwarded-Host origin spoofing. */
	publicOrigin: string;
	bindHost: string;
	port: number;
	trustedProxies: readonly string[];
}

/** Technology-only channel. Message parsing, authorization and sessions belong to modules. */
export interface HttpWebSocketChannel {
	send(value: string): boolean;
	sendBinary(value: Uint8Array): boolean;
	onMessage(listener: (value: string) => void | Promise<void>): void;
	/** Optional, route-selected binary ingress. Default channels reject binary input. */
	onBinary(listener: (value: Uint8Array) => Promise<void>): void;
	onClose(listener: () => Promise<void>): void;
	/** Flush ordered frames and finish the close handshake within a bounded deadline. */
	finish(): Promise<void>;
	/** Reject further traffic immediately; intended for revoke/error/shutdown. */
	close(code?: number, reason?: string): void;
}

export interface HttpWebSocketRoute {
	path: string;
	/** Opt-in technical per-message ceiling; absent means binary input is rejected. */
	maxBinaryMessageBytes?: number;
	maxTextMessageBytes?: number;
	/** Opt-in bounded text send allowance; the default remains 1 MiB. Binary sends are unchanged. */
	maxBufferedTextBytes?: number;
	/** Source address has been resolved by the trusted proxy chain, never a client header. */
	authorize(request: IncomingMessage, url: URL, sourceIp: string): Promise<boolean>;
	/** Ordinary application WS routes use a bounded channel. */
	connected?(channel: HttpWebSocketChannel, request: IncomingMessage, url: URL): void;
	connectedRaw?(socket: WebSocket, request: IncomingMessage, url: URL): Promise<void> | void;
}

export interface HttpListener {
	readonly address: string;
	/** Stops admission immediately. Only an already admitted owner request may be preserved. */
	suspend(owner?: IncomingMessage): HttpSuspension;
	close(): Promise<void>;
}

/** Transport maintenance does not quiesce business owners or decide whether restored data is valid. */
export interface HttpSuspension {
	/** Waits for other requests and all old WS tasks; business owners must also be closed by the caller. */
	drain(): Promise<void>;
	/** Replace all captured HTTP/WS/origin/admission consumers only after a confirmed drain. */
	replace(bindings: HttpBindings): Promise<void>;
	/** Requires fresh bindings; old closed module consumers cannot be resumed. */
	resume(): void;
}
