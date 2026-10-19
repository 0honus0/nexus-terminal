import type { IncomingMessage, ServerResponse } from 'node:http';
import type WebSocket from 'ws';

export interface HttpRouteContext {
	/** Canonical external origin selected from trusted installation configuration. */
	readonly origin: string;
	readonly method: string;
	readonly path: string;
	readonly query: URLSearchParams;
	readonly params: Readonly<Record<string, string>>;
	readonly request: IncomingMessage;
	readonly response: ServerResponse;
	readonly sourceIp: string;
	json(signal?: AbortSignal): Promise<unknown>;
	cookie(name: string): string | null;
	send(status: number, body: unknown, headers?: Readonly<Record<string, string | string[]>>): void;
}

export interface HttpRoute {
	readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	readonly path: string;
	/** Transport-only JSON body budget. Default 16 KiB; large routes must opt in explicitly. */
	readonly maxBodyBytes?: number;
	/** Route-owned decoded UTF-8 path parameter budget; default 64 bytes. */
	readonly maxPathParameterBytes?: number;
	/** Opaque allows ASCII dots/colons; segment allows text without separators/controls. Routes validate meaning. */
	readonly pathParameterAlphabet?: 'identifier' | 'opaque' | 'segment';
	handle(context: HttpRouteContext): Promise<void>;
}

export interface HttpBindings {
	allowedOrigins?: readonly string[];
	/** Optional application admission for paths without an installed route. */
	admitUnmatched?: (sourceIp: string) => Promise<boolean>;
	routes: readonly HttpRoute[];
	webSockets?: readonly HttpWebSocketRoute[];
}

export interface HttpServerOptions extends HttpBindings {
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
	onMessage(listener: (value: string) => Promise<void>): void;
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
	/** Third-party raw WebSocket protocol (e.g. Guacamole), not a business registry. */
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
	replace(bindings: HttpBindings): void;
	/** Requires fresh bindings; old closed module consumers cannot be resumed. */
	resume(): void;
}
