import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';

export const DOWNLOAD_TICKET_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_TICKET_MAX_PER_USER = 64;
export const DOWNLOAD_TICKET_MAX_TOTAL = 512;
const DOWNLOAD_TICKET_TTL_MS = DOWNLOAD_TICKET_TTL_SECONDS * 1000;

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
  sessionId: string;
  remotePath: string;
  fileSize: number;
  fileMtime: number;
  createdAt: number;
  expiresAt: number;
  state: 'waiting' | 'active';
  ownerIp?: string;
  completedRanges: Array<[number, number]>;
  activeStreams: Set<Readable>;
}

interface IssueDownloadTicketInput {
  userId: number;
  connectionId: number;
  sessionId: string;
  remotePath: string;
  fileSize: number;
  fileMtime: number;
}

type ClaimDownloadTicketResult =
  | { status: 'ok'; lease: DownloadTicketLease }
  | { status: 'gone' }
  | { status: 'locked' };

const leases = new Map<string, DownloadTicketLease>();

const hashSecret = (secret: string): Buffer => createHash('sha256').update(secret).digest();

const forgetLease = (lease: DownloadTicketLease, destroyStreams: boolean): void => {
  if (leases.get(lease.id) === lease) leases.delete(lease.id);
  if (!destroyStreams) return;
  for (const stream of lease.activeStreams) stream.destroy();
  lease.activeStreams.clear();
};

const isExpired = (lease: DownloadTicketLease, now = Date.now()): boolean => lease.expiresAt <= now;

const cleanupExpiredLeases = (now = Date.now()): void => {
  for (const lease of leases.values()) {
    if (isExpired(lease, now)) forgetLease(lease, true);
  }
};

const findOldestWaitingLease = (userId?: number): DownloadTicketLease | undefined => {
  for (const lease of leases.values()) {
    if (lease.state !== 'waiting') continue;
    if (userId !== undefined && lease.userId !== userId) continue;
    return lease;
  }
  return undefined;
};

const countUserLeases = (userId: number): number => {
  let count = 0;
  for (const lease of leases.values()) {
    if (lease.userId === userId) count += 1;
  }
  return count;
};

const ensureCapacityForTicket = (userId: number): void => {
  cleanupExpiredLeases();

  while (countUserLeases(userId) >= DOWNLOAD_TICKET_MAX_PER_USER) {
    const evictable = findOldestWaitingLease(userId);
    if (!evictable) throw new DownloadTicketCapacityError();
    forgetLease(evictable, true);
  }

  while (leases.size >= DOWNLOAD_TICKET_MAX_TOTAL) {
    const evictable = findOldestWaitingLease();
    if (!evictable) throw new DownloadTicketCapacityError();
    forgetLease(evictable, true);
  }
};

export const touchDownloadTicket = (lease: DownloadTicketLease): void => {
  if (leases.get(lease.id) !== lease) return;
  lease.expiresAt = Date.now() + DOWNLOAD_TICKET_TTL_MS;
};

export const issueDownloadTicket = (input: IssueDownloadTicketInput): { token: string; lease: DownloadTicketLease } => {
  ensureCapacityForTicket(input.userId);
  const id = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const now = Date.now();
  const lease: DownloadTicketLease = {
    id,
    secretHash: hashSecret(secret),
    userId: input.userId,
    connectionId: input.connectionId,
    sessionId: input.sessionId,
    remotePath: input.remotePath,
    fileSize: input.fileSize,
    fileMtime: input.fileMtime,
    createdAt: now,
    expiresAt: now + DOWNLOAD_TICKET_TTL_MS,
    state: 'waiting',
    completedRanges: [],
    activeStreams: new Set(),
  };
  leases.set(id, lease);
  return { token: `${id}.${secret}`, lease };
};

export const claimDownloadTicket = (token: string, requestIp: string): ClaimDownloadTicketResult => {
  const separator = token.indexOf('.');
  if (separator <= 0 || separator === token.length - 1) return { status: 'gone' };
  const id = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  const lease = leases.get(id);
  if (!lease) return { status: 'gone' };

  if (isExpired(lease)) {
    forgetLease(lease, true);
    return { status: 'gone' };
  }

  const providedHash = hashSecret(secret);
  if (providedHash.length !== lease.secretHash.length || !timingSafeEqual(providedHash, lease.secretHash)) {
    return { status: 'gone' };
  }

  if (lease.state === 'waiting') {
    lease.state = 'active';
    lease.ownerIp = requestIp;
  } else if (lease.ownerIp !== requestIp) {
    return { status: 'locked' };
  }

  touchDownloadTicket(lease);
  return { status: 'ok', lease };
};

export const attachDownloadStream = (lease: DownloadTicketLease, stream: Readable): void => {
  if (leases.get(lease.id) !== lease) return;
  lease.activeStreams.add(stream);
  const release = () => lease.activeStreams.delete(stream);
  stream.on('data', () => touchDownloadTicket(lease));
  stream.once('end', release);
  stream.once('close', release);
};

const mergeRanges = (ranges: Array<[number, number]>): Array<[number, number]> => {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || current[0] > previous[1] + 1) {
      merged.push([...current]);
      continue;
    }
    previous[1] = Math.max(previous[1], current[1]);
  }
  return merged;
};

export const recordCompletedRange = (lease: DownloadTicketLease, start: number, end: number): boolean => {
  if (leases.get(lease.id) !== lease) return false;
  lease.completedRanges = mergeRanges([...lease.completedRanges, [start, end]]);
  const complete = lease.fileSize === 0
    || (lease.completedRanges.length === 1
      && lease.completedRanges[0][0] === 0
      && lease.completedRanges[0][1] >= lease.fileSize - 1);
  if (complete) forgetLease(lease, false);
  else touchDownloadTicket(lease);
  return complete;
};

export const completeDownloadTicket = (lease: DownloadTicketLease): void => {
  forgetLease(lease, false);
};

export const invalidateDownloadTicket = (lease: DownloadTicketLease): void => {
  forgetLease(lease, true);
};

const cleanupTimer = setInterval(() => {
  cleanupExpiredLeases();
}, 5_000);
cleanupTimer.unref();
