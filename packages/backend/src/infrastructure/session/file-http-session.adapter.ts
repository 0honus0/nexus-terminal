import fs from 'node:fs';
import path from 'node:path';
import type { RequestHandler } from 'express';
import session from 'express-session';
import sessionFileStore from 'session-file-store';

export interface FileHttpSessionAdapterOptions {
  dataDirectory: string;
  secret: string;
  cookieName?: string;
}

/** Express-compatible persistent session adapter. Bootstrap owns its lifecycle/configuration. */
export class FileHttpSessionAdapter {
  readonly cookieName: string;
  readonly middleware: RequestHandler;
  private readonly store: session.Store;

  constructor(options: FileHttpSessionAdapterOptions) {
    const FileStore = sessionFileStore(session);
    const sessionsPath = path.join(options.dataDirectory, 'sessions');
    fs.mkdirSync(sessionsPath, { recursive: true });
    this.cookieName = options.cookieName || 'nexus.sid';
    this.store = new FileStore({ path: sessionsPath, ttl: 30 * 24 * 60 * 60 });
    this.middleware = session({
      store: this.store,
      name: this.cookieName,
      secret: options.secret,
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto' },
    });
  }

  clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const clear = this.store.clear?.bind(this.store);
      if (!clear) {
        reject(new Error('Session store does not support clear().'));
        return;
      }
      clear((error?: unknown) => (error ? reject(error) : resolve()));
    });
  }
}
