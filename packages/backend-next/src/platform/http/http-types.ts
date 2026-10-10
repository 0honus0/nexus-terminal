import type { IncomingMessage, ServerResponse } from 'node:http';

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
	send(status: number, body: unknown, headers?: Readonly<Record<string, string>>): void;
}

export interface HttpRoute {
	readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
	readonly path: string;
	/** Transport-only JSON body budget. Default 16 KiB, hard ceiling 128 KiB. */
	readonly maxBodyBytes?: number;
	handle(context: HttpRouteContext): Promise<void>;
}

export interface HttpServerOptions {
	/** Explicit external URL prevents Host/X-Forwarded-Host origin spoofing. */
	publicOrigin: string;
	bindHost: string;
	port: number;
	trustedProxies: readonly string[];
	routes: readonly HttpRoute[];
	webSockets?: readonly HttpWebSocketRoute[];
}

/** Technology-only channel. Message parsing, authorization and sessions belong to modules. */
export interface HttpWebSocketChannel {
	send(value: string): boolean;
	onMessage(listener: (value: string) => Promise<void>): void;
	onClose(listener: () => Promise<void>): void;
	/** Flush ordered frames and finish the close handshake within a bounded deadline. */
	finish(): Promise<void>;
	/** Reject further traffic immediately; intended for revoke/error/shutdown. */
	close(): void;
}

export interface HttpWebSocketRoute {
	path: string;
	authorize(request: IncomingMessage, url: URL): Promise<boolean>;
	connected(channel: HttpWebSocketChannel, request: IncomingMessage, url: URL): void;
}

export interface HttpListener {
	readonly address: string;
	close(): Promise<void>;
}
