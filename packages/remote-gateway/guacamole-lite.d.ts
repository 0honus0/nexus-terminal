declare module 'guacamole-lite' {
  import { EventEmitter } from 'node:events';
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

  class GuacamoleLite extends EventEmitter {
    constructor(
      websocketOptions: ServerOptions,
      guacdOptions?: GuacdOptions,
      clientOptions?: ClientOptions,
      callbacks?: Record<string, unknown>,
    );

    close(): void;
    on(event: 'open', listener: (client: ClientConnection) => void): this;
    on(event: 'close', listener: (client: ClientConnection, error?: Error) => void): this;
    on(event: 'error', listener: (client: ClientConnection, error: Error) => void): this;
  }

  export = GuacamoleLite;
}
