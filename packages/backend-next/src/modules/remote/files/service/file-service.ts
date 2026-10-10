import { randomUUID, createHash } from 'node:crypto';
import type { AccessPublicApi } from '../../../access/public.js';
import { RemoteFileFailure, type FileResource, type FileEntry, type FileInfo, type TextRead } from '../model/file-types.js';
import type { RemoteFileModel } from '../model/file-model.js';

const MAX_RESOURCES = 8;
const IDLE_MS = 2 * 60 * 1000;
const OPERATION_MS = 30_000;

interface OwnedResource {
 id: string;
 tokenHash: string;
 userId: number;
 resource: FileResource;
 expiresAt: number;
 busy: boolean;
 active: AbortController | null;
 inFlight: Promise<unknown> | null;
 closePromise: Promise<void> | null;
}

function hash(token: string): string { return createHash('sha256').update(token).digest('hex'); }

export class RemoteFileService {
 private readonly owners = new Map<string, OwnedResource>();
 private readonly opening = new Set<AbortController>();
 private readonly pending = new Set<Promise<unknown>>();
 private readonly cleanup = new Set<Promise<unknown>>();
 private readonly cleanupErrors: unknown[] = [];
 private accepting = true;
 private closePromise: Promise<void> | null = null;
 private readonly expiryTimer: ReturnType<typeof setInterval>;

 constructor(private readonly access: AccessPublicApi, private readonly model: RemoteFileModel) {
  this.expiryTimer = setInterval(() => {
   for (const record of this.owners.values()) {
    if (record.expiresAt <= Date.now()) void this.closeOwned(record).catch(() => undefined);
   }
  }, 15_000);
  this.expiryTimer.unref();
 }

 private async identity(token: string | null): Promise<number> {
  if (!token) throw new RemoteFileFailure('unauthenticated');
  const identity = await this.access.authenticate(token);
  if (!identity) throw new RemoteFileFailure('unauthenticated');
  if (identity.userId !== 1) throw new RemoteFileFailure('forbidden');
  return identity.userId;
 }

 private track<T>(operation: Promise<T>): Promise<T> {
  this.pending.add(operation);
  void operation.finally(() => this.pending.delete(operation)).catch(() => undefined);
  return operation;
 }

 open(token: string | null, targetId: number, signal?: AbortSignal): Promise<{id: string; targetId: number; fingerprint: string}> {
  return this.track(this.openAdmitted(token, targetId, signal));
 }

 private async openAdmitted(token: string | null, targetId: number, signal?: AbortSignal): Promise<{id: string; targetId: number; fingerprint: string}> {
  if (!this.accepting) throw new RemoteFileFailure('remote_unavailable');
  if (!Number.isSafeInteger(targetId) || targetId < 1) throw new RemoteFileFailure('invalid_input');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, OPERATION_MS);
  this.opening.add(controller);
  let resource: FileResource | null = null;
  try {
   const userId = await this.identity(token);
   if (!this.accepting || controller.signal.aborted || this.owners.size + this.opening.size > MAX_RESOURCES)
    throw new RemoteFileFailure('limit_exceeded');
   const started = Date.now();
   resource = await this.model.open(targetId, Math.max(1, OPERATION_MS - (Date.now()-started)), controller.signal);
   if (!token || (await this.identity(token)) !== userId || !this.accepting || controller.signal.aborted)
    throw new RemoteFileFailure('unauthenticated');
   const id = randomUUID();
   const record: OwnedResource = {id, tokenHash: hash(token), userId, resource,
    expiresAt: Date.now() + IDLE_MS, busy: false, active: null, inFlight: null, closePromise: null};
   this.owners.set(id, record);
   resource = null;
   return { id, targetId: record.resource.targetId, fingerprint: record.resource.fingerprint };
  } finally {
   if (resource) await this.model.close(resource);
   this.opening.delete(controller);
   clearTimeout(timer);
   signal?.removeEventListener('abort', abort);
  }
 }

 private async owned(token: string | null, id: string): Promise<OwnedResource> {
  if (!this.accepting) throw new RemoteFileFailure('remote_unavailable');
  const userId = await this.identity(token);
  const resource = this.owners.get(id);
  if (!resource || !token || resource.userId !== userId || resource.tokenHash !== hash(token) ||
   resource.closePromise || resource.expiresAt <= Date.now() || !this.accepting)
   throw new RemoteFileFailure('not_found');
  return resource;
 }

 private async run<T>(token: string | null, id: string, action: (r: FileResource, ms: number, signal: AbortSignal) => Promise<T>,
  requestSignal?: AbortSignal): Promise<T> {
  const resource = await this.owned(token, id);
  if (resource.busy) throw new RemoteFileFailure('limit_exceeded');
  resource.busy = true;
  const controller = new AbortController();
  resource.active = controller;
  const abort = () => controller.abort();
  requestSignal?.addEventListener('abort', abort, { once: true });
  if (requestSignal?.aborted) abort();
  const started = Date.now();
  const timer = setTimeout(abort, OPERATION_MS);
  const operation = (async () => {
   await this.model.checkFingerprint(resource.resource);
   controller.signal.throwIfAborted();
   const result = await action(resource.resource, Math.max(1, OPERATION_MS - (Date.now()-started)), controller.signal);
   controller.signal.throwIfAborted();
   await this.model.checkFingerprint(resource.resource);
   controller.signal.throwIfAborted();
   if (!this.accepting || resource.closePromise || this.owners.get(id) !== resource) throw new RemoteFileFailure('not_found');
   await this.identity(token);
   if (!this.accepting || resource.closePromise || this.owners.get(id) !== resource) throw new RemoteFileFailure('not_found');
   resource.expiresAt = Date.now() + IDLE_MS;
   return result;
  })();
  resource.inFlight = operation;
  try { return await this.track(operation); }
  finally {
   resource.inFlight = null;
   resource.active = null;
   resource.busy = false;
   clearTimeout(timer);
   requestSignal?.removeEventListener('abort', abort);
  }
 }

 list(token: string | null, id: string, path: string, maxEntries: number, maxMetadataBytes: number,
  signal?: AbortSignal): Promise<FileEntry[]> {
  return this.run(token, id, (resource, ms, abort) => this.model.list(resource,path,ms,abort,maxEntries,maxMetadataBytes),signal);
 }

 stat(token: string | null, id: string, path: string, follow: boolean, signal?: AbortSignal): Promise<FileInfo> {
  return this.run(token,id,(resource,ms,abort)=>this.model.stat(resource,path,follow,ms,abort),signal);
 }

 readText(token: string | null,id: string,path: string,maxBytes: number,signal?: AbortSignal): Promise<TextRead> {
  return this.run(token,id,(resource,ms,abort)=>this.model.readText(resource,path,ms,abort,maxBytes),signal);
 }

 async release(token: string | null, id: string): Promise<void> {
  const record = await this.owned(token,id);
  await this.closeOwned(record);
 }

 private closeOwned(record: OwnedResource): Promise<void> {
  if (record.closePromise) return record.closePromise;
  this.owners.delete(record.id);
  record.active?.abort();
  record.closePromise = (async () => {
   if (record.inFlight) await Promise.allSettled([record.inFlight]);
   await this.model.close(record.resource);
  })();
  this.cleanup.add(record.closePromise);
  void record.closePromise.then(
   () => this.cleanup.delete(record.closePromise!),
   (error) => { this.cleanupErrors.push(error); this.cleanup.delete(record.closePromise!); },
  );
  return record.closePromise;
 }

 quiesce(): void {
  this.accepting = false;
  for (const controller of this.opening) controller.abort();
  for (const owner of this.owners.values()) owner.active?.abort();
 }

 close(): Promise<void> {
  if (this.closePromise) return this.closePromise;
  this.quiesce();
  clearInterval(this.expiryTimer);
  this.closePromise = (async () => {
   const results = await Promise.allSettled([...this.owners.values()].map((value)=>this.closeOwned(value)));
   while (this.pending.size || this.cleanup.size) {
    await Promise.allSettled([...this.pending,...this.cleanup]);
   }
   const failures = results.filter((x): x is PromiseRejectedResult=>x.status==='rejected').map(x=>x.reason);
   failures.push(...this.cleanupErrors);
   if (failures.length) throw new AggregateError([...new Set(failures)], 'Remote file shutdown failed');
  })();
  return this.closePromise;
 }
}
