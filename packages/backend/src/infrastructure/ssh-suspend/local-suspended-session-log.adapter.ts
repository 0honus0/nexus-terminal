import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { SuspendedSessionLogStore } from '../../modules/ssh-suspend/suspended-session-log.port';

const MAX_BYTES = 100 * 1024 * 1024;
const SAFE = /^[A-Za-z0-9_-]{1,128}$/;
interface Writer {
  tail: Promise<void>;
  size?: number;
  revision: number;
  error?: unknown;
}
export class LocalSuspendedSessionLogAdapter implements SuspendedSessionLogStore {
  private readonly writers = new Map<string, Writer>();
  private readonly directory: string;
  constructor(dataDirectory: string) {
    this.directory = path.join(dataDirectory, 'temp_suspended_ssh_logs');
  }
  async append(id: string, data: string | Uint8Array): Promise<void> {
    const file = this.file(id);
    const chunk = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    if (!chunk.length) return;
    return this.enqueue(id, async (writer) => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      if (writer.size === undefined) {
        try {
          writer.size = (await fs.stat(file)).size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          writer.size = 0;
        }
      }
      const retained = chunk.length > MAX_BYTES ? chunk.subarray(chunk.length - MAX_BYTES) : chunk;
      if (writer.size + retained.length > MAX_BYTES) {
        await fs.writeFile(file, retained, { mode: 0o600 });
        writer.size = retained.length;
      } else {
        await fs.appendFile(file, retained, { mode: 0o600 });
        writer.size += retained.length;
      }
    });
  }
  async flush(id: string) {
    const w = this.writer(id);
    await w.tail;
    if (w.error !== undefined) {
      const e = w.error;
      w.error = undefined;
      throw e;
    }
  }
  async openRead(id: string): Promise<Readable> {
    const file = this.file(id);
    await this.flush(id);
    try {
      await fs.access(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Readable.from([]);
      throw error;
    }
    return createReadStream(file, { highWaterMark: 64 * 1024 });
  }
  async delete(id: string): Promise<void> {
    const file = this.file(id);
    const w = this.writer(id);
    const deletion = this.enqueue(id, async (current) => {
      try {
        await fs.unlink(file);
        current.size = 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    });
    const revision = w.revision;
    await deletion;
    if (this.writers.get(id) === w && w.revision === revision) this.writers.delete(id);
  }
  private writer(id: string): Writer {
    this.file(id);
    let w = this.writers.get(id);
    if (!w) {
      w = { tail: Promise.resolve(), revision: 0 };
      this.writers.set(id, w);
    }
    return w;
  }
  private enqueue(id: string, operation: (writer: Writer) => Promise<void>) {
    const w = this.writer(id);
    w.revision++;
    const result = w.tail
      .then(() => operation(w))
      .catch((error) => {
        w.error = error;
        throw error;
      });
    w.tail = result.catch(() => undefined);
    return result;
  }
  private file(id: string) {
    if (!SAFE.test(id)) throw new Error('Invalid suspended SSH log identifier.');
    return path.join(this.directory, `${id}.log`);
  }
}
