import { randomUUID } from 'node:crypto';
import type { InitiateTransferPayload, TransferSubTask, TransferTask, TransferTaskStatus } from './transfers.types';

export interface CreatedTransferTask {
  task: TransferTask;
  signal: AbortSignal;
}
const FINAL = new Set<TransferTaskStatus>(['completed', 'failed', 'partially-completed', 'cancelled']);

/** In-process task state and cancellation ownership. It never owns network transports. */
export class TransferTaskRegistry {
  private readonly tasks = new Map<string, TransferTask>();
  private readonly controllers = new Map<string, AbortController>();

  create(payload: InitiateTransferPayload, userId: string | number): CreatedTransferTask {
    const taskId = randomUUID();
    const now = new Date();
    const subTasks: TransferSubTask[] = [];
    for (const connectionId of payload.connectionIds)
      for (const item of payload.sourceItems)
        subTasks.push({
          subTaskId: randomUUID(),
          connectionId,
          sourceItemName: item.name,
          status: 'queued',
          startTime: now,
        });
    const task: TransferTask = { taskId, status: 'queued', userId, createdAt: now, updatedAt: now, subTasks, payload };
    const controller = new AbortController();
    this.tasks.set(taskId, task);
    this.controllers.set(taskId, controller);
    return { task: this.cloneWithConvenience(task), signal: controller.signal };
  }
  get(id: string) {
    return this.tasks.get(id);
  }
  getOwned(id: string, userId: string | number) {
    const t = this.tasks.get(id);
    return t?.userId === userId ? t : undefined;
  }
  details(id: string, userId: string | number) {
    const t = this.getOwned(id, userId);
    return t ? this.cloneWithConvenience(t) : null;
  }
  list(userId: string | number) {
    return [...this.tasks.values()].filter((t) => t.userId === userId).map((t) => this.cloneWithConvenience(t));
  }
  remove(id: string, userId: string | number): 'removed' | 'not-found' | 'active' {
    const t = this.getOwned(id, userId);
    if (!t) return 'not-found';
    if (!FINAL.has(t.status) || this.controllers.has(id)) return 'active';
    this.tasks.delete(id);
    return 'removed';
  }
  cancel(id: string, userId: string | number): boolean {
    const t = this.getOwned(id, userId);
    if (!t || FINAL.has(t.status)) return false;
    const c = this.controllers.get(id);
    if (!c) return false;
    if (!c.signal.aborted) {
      this.setOverallStatus(id, 'cancelling');
      for (const s of t.subTasks)
        if (!['completed', 'failed', 'cancelled'].includes(s.status))
          this.setSubTask(id, s.subTaskId, 'cancelled', s.progress, 'Cancelled due to parent task cancellation.');
      c.abort();
    }
    return true;
  }
  cancelAll(): void {
    for (const [id, controller] of this.controllers) {
      const task = this.tasks.get(id);
      if (task && !FINAL.has(task.status)) this.setOverallStatus(id, 'cancelling');
      if (!controller.signal.aborted) controller.abort();
    }
  }
  releaseCancellation(id: string) {
    this.controllers.delete(id);
  }
  setOverallStatus(id: string, status: TransferTaskStatus) {
    const t = this.tasks.get(id);
    if (!t) return;
    if (t.status === 'cancelled' && status !== 'cancelled') return;
    if (FINAL.has(t.status) && ['queued', 'in-progress'].includes(status)) return;
    t.status = status;
    t.updatedAt = new Date();
  }
  setSubTask(id: string, subTaskId: string, status: TransferSubTask['status'], progress?: number, message?: string) {
    const t = this.tasks.get(id);
    const s = t?.subTasks.find((v) => v.subTaskId === subTaskId);
    if (!t || !s) return;
    if (['completed', 'failed', 'cancelled'].includes(s.status) && s.status !== status) return;
    s.status = status;
    if (progress !== undefined) s.progress = Math.min(100, Math.max(0, progress));
    if (message !== undefined) s.message = message;
    if (['completed', 'failed', 'cancelled'].includes(status) && !s.endTime) s.endTime = new Date();
    t.updatedAt = new Date();
    this.recalculate(id);
  }
  setMethod(id: string, subTaskId: string, method: 'rsync' | 'scp') {
    const t = this.tasks.get(id);
    const s = t?.subTasks.find((v) => v.subTaskId === subTaskId);
    if (s) s.transferMethodUsed = method;
  }
  finalize(id: string) {
    this.recalculate(id);
  }
  private recalculate(id: string) {
    const t = this.tasks.get(id);
    if (!t) return;
    const count = t.subTasks.length;
    if (!count) {
      t.overallProgress = 0;
      t.updatedAt = new Date();
      return;
    }
    let completed = 0,
      failed = 0,
      cancelled = 0,
      active = 0,
      queued = 0,
      total = 0;
    for (const s of t.subTasks) {
      switch (s.status) {
        case 'completed':
          completed++;
          total += 100;
          break;
        case 'failed':
          failed++;
          total += s.progress ?? 0;
          break;
        case 'cancelled':
          cancelled++;
          total += s.progress ?? 0;
          break;
        case 'connecting':
        case 'transferring':
        case 'cancelling':
          active++;
          total += s.progress ?? (s.status === 'connecting' ? 5 : 0);
          break;
        case 'queued':
          queued++;
          break;
      }
    }
    t.overallProgress = Math.round(total / count);
    const terminal = completed + failed + cancelled;
    if (t.status === 'cancelled') {
    } else if (t.status === 'cancelling' || cancelled > 0) t.status = terminal === count ? 'cancelled' : 'cancelling';
    else if (failed === count) t.status = 'failed';
    else if (completed === count) t.status = 'completed';
    else if (failed > 0 && completed + failed === count) t.status = 'partially-completed';
    else if (active > 0 || (queued > 0 && (failed > 0 || completed > 0))) t.status = 'in-progress';
    else if (queued === count) t.status = 'queued';
    else t.status = 'in-progress';
    t.updatedAt = new Date();
  }
  private clone(t: TransferTask): TransferTask {
    return {
      ...t,
      createdAt: new Date(t.createdAt),
      updatedAt: new Date(t.updatedAt),
      subTasks: t.subTasks.map((s) => ({
        ...s,
        startTime: s.startTime ? new Date(s.startTime) : undefined,
        endTime: s.endTime ? new Date(s.endTime) : undefined,
      })),
      payload: {
        ...t.payload,
        connectionIds: [...t.payload.connectionIds],
        sourceItems: t.payload.sourceItems.map((i) => ({ ...i })),
      },
    };
  }
  private cloneWithConvenience(t: TransferTask): TransferTask {
    return {
      ...this.clone(t),
      sourceConnectionId: t.payload.sourceConnectionId,
      remoteTargetPath: t.payload.remoteTargetPath,
    };
  }
}
