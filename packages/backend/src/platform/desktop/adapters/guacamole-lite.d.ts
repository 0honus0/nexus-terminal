declare module 'guacamole-lite' {
	import { EventEmitter } from 'node:events';
	import type { IncomingMessage } from 'node:http';
	import type { Socket } from 'node:net';
	import type WebSocket from 'ws';
	import type { ServerOptions } from 'ws';

	interface GuacamoleSettings {
		connection?: Record<string, unknown>;
		[key: string]: unknown;
	}

	interface GuacamoleClient {
		webSocket: WebSocket;
		readonly state: number;
		readonly STATE_CLOSED: number;
		readonly guacdClient?: { close(): void; guacdConnection?: Socket };
		close(): void;
	}

	class GuacamoleLite extends EventEmitter {
		readonly connectionsCount: number;
		readonly activeConnections: Map<number, GuacamoleClient>;
		readonly sigTermHandler: () => void;
		readonly sigIntHandler: () => void;

		constructor(
			websocketOptions: ServerOptions,
			guacdOptions: { host: string; port: number },
			clientOptions: {
				crypt: { key: Buffer; cypher: 'aes-256-cbc' };
				connectionDefaultSettings: Record<string, Record<string, unknown>>;
				log: { level: number; stdLog(): void; errorLog(): void };
			},
			callbacks: {
				processConnectionSettings(
					settings: GuacamoleSettings,
					callback: (error?: Error, settings?: GuacamoleSettings) => void,
				): void;
			},
		);

		newConnection(socket: WebSocket, request: IncomingMessage): Promise<void>;

		close(): void;
	}

	export = GuacamoleLite;
}
