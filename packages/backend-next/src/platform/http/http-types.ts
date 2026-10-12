import type { IncomingMessage, ServerResponse } from 'node:http';
import type WebSocket from 'ws';

export interface HttpRouteContext {
	readonly method: string;
	readonly path: string;
	readonly query: URLSearchParams;
	readonly params: Readonly<Record<string, string>>;
	readonly request: IncomingMessage;
	readonly response: ServerResponse;
	readonly sourceIp: string;
	json(): Promise<unknown>;
	cookie(name: string): string | null;
	send(status: number, body: unknown, headers?: Readonly<Record<string, string | string[]>>): void;
}

export interface HttpRoute {
	readonly method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
	readonly path: string;
	/** Transport-only JSON body budget. Default 16 KiB; large routes must opt in explicitly. */
	readonly maxBodyBytes?: number;
	/** Optional route-owned bound for opaque URL path parameters; default 64 bytes. */
	readonly maxPathParameterBytes?: number;
	handle(context: HttpRouteContext): Promise<void>;
}

export interface HttpServerOptions {
	/** Explicit external URL prevents Host/X-Forwarded-Host origin spoofing. */
	publicOrigin: string;
	bindHost: string;
	port: number;
	trustedProxies: readonly string[];
	/** Optional application admission for paths without an installed route. */
	admitUnmatched?: (sourceIp: string) => Promise<boolean>;
	routes: readonly HttpRoute[];
	webSockets?: readonly HttpWebSocketRoute[];
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
	/** Source address has been resolved by the trusted proxy chain, never a client header. */
	authorize(request: IncomingMessage, url: URL, sourceIp: string): Promise<boolean>;
	/** Ordinary application WS routes use a bounded channel. */
	connected?(channel: HttpWebSocketChannel, request: IncomingMessage, url: URL): void;
	/** Third-party raw WebSocket protocol (e.g. Guacamole), not a business registry. */
	connectedRaw?(socket: WebSocket, request: IncomingMessage, url: URL): Promise<void> | void;
}

export interface HttpListener {
	readonly address: string;
	close(): Promise<void>;
}
