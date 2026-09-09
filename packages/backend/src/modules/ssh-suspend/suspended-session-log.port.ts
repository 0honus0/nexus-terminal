import type { Readable } from 'node:stream';

export interface SuspendedSessionLogSlice {
  data: Uint8Array;
  startOffset: number;
  endOffset: number;
  totalBytes: number;
}

export interface SuspendedSessionLogStore {
  append(identifier: string, data: string | Uint8Array): Promise<void>;
  flush(identifier: string): Promise<void>;
  openRead(identifier: string): Promise<Readable>;
  readTail(identifier: string, maxBytes: number): Promise<SuspendedSessionLogSlice>;
  readBefore(identifier: string, beforeOffset: number, maxBytes: number): Promise<SuspendedSessionLogSlice>;
  delete(identifier: string): Promise<void>;
}
