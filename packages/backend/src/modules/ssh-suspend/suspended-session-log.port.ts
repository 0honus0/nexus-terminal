import type { Readable } from 'node:stream';

export interface SuspendedSessionLogStore {
  append(identifier: string, data: string | Uint8Array): Promise<void>;
  flush(identifier: string): Promise<void>;
  openRead(identifier: string): Promise<Readable>;
  delete(identifier: string): Promise<void>;
}
