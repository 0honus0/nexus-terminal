import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';

export const DOWNLOAD_TICKET_TTL_SECONDS = 5 * 60;
const TTL_MS = DOWNLOAD_TICKET_TTL_SECONDS * 1000;
const MAX_PER_USER = 64;
const MAX_TOTAL = 512;

export class DownloadTicketCapacityError extends Error {
  constructor() {
    super('下载任务过多，请等待现有下载开始或完成后重试。');
    this.name = 'DownloadTicketCapacityError';
  }
}

export interface DownloadTicketLease {
  id: string;
  secretHash: Buffer;
  userId: number;
  connectionId: number;
  workspaceId: string;
  remotePath: string;
  fileSize: number;
  fileMtime: number;
  expiresAt: number;
  state: 'waiting' | 'active';
  ownerIp?: string;
  activeRequests: number;
  activeStreams: Set<Readable>;
}

export type DownloadTicketClaim =
  { status: 'ok'; lease: DownloadTicketLease } | { status: 'gone' } | { status: 'locked' };

const digest = (secret: string): Buffer => createHash('sha256').update(secret).digest();

/** HTTP-only short-lived download capability registry. It never owns SSH/Workspace transports. */
export class DownloadTicketRegistry {
  private readonly leases = new Map<string, DownloadTicketLease>();

  issue(
    input: Omit<
      DownloadTicketLease,
      'id' | 'secretHash' | 'expiresAt' | 'state' | 'ownerIp' | 'activeRequests' | 'activeStreams'
    >,
  ) {
    this.ensureCapacity(input.userId);
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const lease: DownloadTicketLease = {
      ...input,
      id,
      secretHash: digest(secret),
      expiresAt: Date.now() + TTL_MS,
      state: 'waiting',
      activeRequests: 0,
      activeStreams: new Set(),
    };
    this.leases.set(id, lease);
    return { token: `${id}.${secret}`, lease };
  }

  claim(token: string, requestIp: string): DownloadTicketClaim {
    this.cleanupExpired();
    const separator = token.indexOf('.');
    if (separator <= 0 || separator === token.length - 1) return { status: 'gone' };
    const lease = this.leases.get(token.slice(0, separator));
    if (!lease) return { status: 'gone' };
    const provided = digest(token.slice(separator + 1));
    if (provided.length !== lease.secretHash.length || !timingSafeEqual(provided, lease.secretHash))
      return { status: 'gone' };
    if (lease.state === 'waiting') {
      lease.state = 'active';
      lease.ownerIp = requestIp;
    } else if (lease.ownerIp !== requestIp) return { status: 'locked' };
    lease.activeRequests += 1;
    this.touch(lease);
    return { status: 'ok', lease };
  }

  releaseRequest(lease: DownloadTicketLease): void {
    if (!this.isCurrent(lease)) return;
    lease.activeRequests = Math.max(0, lease.activeRequests - 1);
    this.touch(lease);
  }

  attachStream(lease: DownloadTicketLease, stream: Readable): void {
    if (!this.isCurrent(lease)) return;
    lease.activeStreams.add(stream);
    const release = () => lease.activeStreams.delete(stream);
    stream.on('data', () => this.touch(lease));
    stream.once('end', release);
    stream.once('close', release);
  }

  complete(lease: DownloadTicketLease): void {
    if (this.isCurrent(lease)) this.touch(lease);
  }

  invalidate(lease: DownloadTicketLease): void {
    this.forget(lease, true);
  }

  private touch(lease: DownloadTicketLease): void {
    if (this.isCurrent(lease)) lease.expiresAt = Date.now() + TTL_MS;
  }

  private isCurrent(lease: DownloadTicketLease): boolean {
    return this.leases.get(lease.id) === lease;
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const lease of this.leases.values()) if (lease.expiresAt <= now) this.forget(lease, true);
  }

  private ensureCapacity(userId: number): void {
    this.cleanupExpired();
    while (this.countForUser(userId) >= MAX_PER_USER) {
      const lease = this.oldestIdle(userId);
      if (!lease) throw new DownloadTicketCapacityError();
      this.forget(lease, true);
    }
    while (this.leases.size >= MAX_TOTAL) {
      const lease = this.oldestIdle();
      if (!lease) throw new DownloadTicketCapacityError();
      this.forget(lease, true);
    }
  }

  private countForUser(userId: number): number {
    let total = 0;
    for (const lease of this.leases.values()) if (lease.userId === userId) total += 1;
    return total;
  }

  private oldestIdle(userId?: number): DownloadTicketLease | undefined {
    for (const lease of this.leases.values()) {
      if (lease.activeRequests || lease.activeStreams.size) continue;
      if (userId !== undefined && lease.userId !== userId) continue;
      return lease;
    }
    return undefined;
  }

  private forget(lease: DownloadTicketLease, destroyStreams: boolean): void {
    if (!this.isCurrent(lease)) return;
    this.leases.delete(lease.id);
    if (!destroyStreams) return;
    for (const stream of lease.activeStreams) stream.destroy();
    lease.activeStreams.clear();
  }
}
