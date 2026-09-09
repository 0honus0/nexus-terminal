declare module 'guacamole-lite' {
  import { EventEmitter } from 'node:events';
  import type { IncomingMessage } from 'node:http';
  import type WebSocket from 'ws';
  import type { ServerOptions } from 'ws';

  interface GuacdOptions {
    host?: string;
    port?: number;
  }

  interface ClientOptions {
    crypt: {
      key: string | Buffer;
      cypher?: string;
    };
    connectionDefaultSettings?: Record<string, Record<string, unknown>>;
  }

  interface ClientConnection {
    connectionId?: string;
    guacamoleConnectionId?: string;
  }

  interface ConnectionCallbacks {
    processConnectionSettings?: (
      settings: { connection?: Record<string, unknown>; [key: string]: unknown },
      callback: (error?: Error, settings?: { connection?: Record<string, unknown>; [key: string]: unknown }) => void,
    ) => void;
  }

  class GuacamoleLite extends EventEmitter {
    constructor(
      websocketOptions: ServerOptions,
      guacdOptions?: GuacdOptions,
      clientOptions?: ClientOptions,
      callbacks?: ConnectionCallbacks,
    );
    newConnection(webSocketConnection: WebSocket, request: IncomingMessage): Promise<void>;
    close(): void;
    on(event: 'open', listener: (client: ClientConnection) => void): this;
    on(event: 'close', listener: (client: ClientConnection, error?: Error) => void): this;
    on(event: 'error', listener: (client: ClientConnection | undefined, error: Error) => void): this;
  }

  export = GuacamoleLite;
}
