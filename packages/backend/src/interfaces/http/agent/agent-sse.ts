import type { Request, Response } from 'express';

const MAX_SSE_PER_SESSION = 3;
const MAX_PENDING_EVENTS = 256;
const MAX_PENDING_BYTES = 1024 * 1024;
const DRAIN_TIMEOUT_MS = 5_000;

const activeStreams = new Map<string, number>();
const activeWriters = new Set<AgentSseWriter>();

export const acquireAgentSseSlot = (request: Request): (() => void) => {
  const key = request.sessionID || `user:${String(request.session.userId ?? 'anonymous')}`;
  const current = activeStreams.get(key) ?? 0;
  if (current >= MAX_SSE_PER_SESSION) throw new Error('SSE_SESSION_LIMIT');
  activeStreams.set(key, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeStreams.get(key) ?? 1) - 1;
    if (next <= 0) activeStreams.delete(key);
    else activeStreams.set(key, next);
  };
};

const scalarQuery = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) throw new Error('CURSOR_INVALID');
  if (typeof value !== 'string' || value.length === 0) throw new Error('CURSOR_INVALID');
  return value;
};

export const resolveSseCursor = (request: Request, idPrefix: string, highWater: number): number => {
  const query = scalarQuery(request.query.cursor);
  const header = request.header('last-event-id');
  let queryCursor: number | undefined;
  let headerCursor: number | undefined;
  if (query !== undefined) {
    if (!/^\d+$/.test(query)) throw new Error('CURSOR_INVALID');
    queryCursor = Number(query);
  }
  if (header !== undefined) {
    if (!header.startsWith(idPrefix)) throw new Error('CURSOR_INVALID');
    const raw = header.slice(idPrefix.length);
    if (!/^\d+$/.test(raw)) throw new Error('CURSOR_INVALID');
    headerCursor = Number(raw);
  }
  if (
    (queryCursor !== undefined && !Number.isSafeInteger(queryCursor)) ||
    (headerCursor !== undefined && !Number.isSafeInteger(headerCursor))
  ) {
    throw new Error('CURSOR_INVALID');
  }
  if (queryCursor !== undefined && headerCursor !== undefined && queryCursor !== headerCursor) {
    throw new Error('CURSOR_CONFLICT');
  }
  const cursor = headerCursor ?? queryCursor ?? 0;
  if (cursor > highWater) throw new Error('CURSOR_AHEAD');
  return cursor;
};

export const initializeSseResponse = (response: Response): void => {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
};

interface PendingFrame {
  data: string;
  bytes: number;
}

export class AgentSseWriter {
  private readonly queue: PendingFrame[] = [];
  private queuedBytes = 0;
  private flushing = false;
  private closedValue = false;

  constructor(private readonly response: Response) {
    activeWriters.add(this);
    response.once('close', () => this.close(false));
    response.once('error', () => this.close(false));
  }

  get closed(): boolean {
    return this.closedValue;
  }

  enqueue(data: string): boolean {
    if (this.closedValue) return false;
    const bytes = Buffer.byteLength(data, 'utf8');
    if (bytes > 64 * 1024 || this.queue.length >= MAX_PENDING_EVENTS || this.queuedBytes + bytes > MAX_PENDING_BYTES) {
      this.close(true);
      return false;
    }
    this.queue.push({ data, bytes });
    this.queuedBytes += bytes;
    void this.flush();
    return true;
  }

  heartbeat(): void {
    if (!this.closedValue) this.enqueue(`: heartbeat ${Date.now()}\n\n`);
  }

  close(endResponse = true): void {
    if (this.closedValue) return;
    this.closedValue = true;
    activeWriters.delete(this);
    this.queue.length = 0;
    this.queuedBytes = 0;
    if (endResponse && !this.response.writableEnded) this.response.end();
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.closedValue) return;
    this.flushing = true;
    try {
      while (!this.closedValue && this.queue.length > 0) {
        const frame = this.queue.shift()!;
        this.queuedBytes -= frame.bytes;
        if (this.response.writableEnded || this.response.destroyed) {
          this.close(false);
          return;
        }
        if (!this.response.write(frame.data)) {
          const drained = await this.waitForDrain();
          if (!drained) {
            this.close(true);
            return;
          }
        }
      }
    } finally {
      this.flushing = false;
      if (!this.closedValue && this.queue.length > 0) void this.flush();
    }
  }

  private waitForDrain(): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.response.off('drain', onDrain);
        this.response.off('close', onClose);
        this.response.off('error', onClose);
        resolve(value);
      };
      const onDrain = () => finish(true);
      const onClose = () => finish(false);
      const timer = setTimeout(() => finish(false), DRAIN_TIMEOUT_MS);
      this.response.once('drain', onDrain);
      this.response.once('close', onClose);
      this.response.once('error', onClose);
    });
  }
}

export const closeAllAgentSseStreams = (): void => {
  for (const writer of [...activeWriters]) writer.close(true);
};

export const waitForSseWake = (subscribe: (wake: () => void) => () => void, timeoutMs = 1_000): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const unsubscribe = subscribe(finish);
    const timer = setTimeout(finish, timeoutMs);
  });

export const reloadAgentSession = (request: Request, expectedUserId: number): Promise<boolean> =>
  new Promise((resolve) => {
    request.session.reload((error) => {
      if (error) {
        resolve(false);
        return;
      }
      resolve(
        request.session.userId === expectedUserId &&
          Boolean(request.session.username) &&
          request.session.requiresTwoFactor !== true,
      );
    });
  });
