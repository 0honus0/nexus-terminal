import type { SshConnectionResolver } from '../connections/services/ssh-connection-resolver.service';
import type { ExecutionSession } from '../../platform/execution/execution-session';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { ServerTransferExecutor } from '../../platform/operations/transfer/server-transfer-executor';
import type { TransferTaskRegistry } from './transfer-task.registry';
import type { TransferSubTask } from './transfers.types';

export interface TransferOrchestratorOptions {
  maxConcurrentSubTasks?: number;
}

/** Orchestrates a task over one system-owned source ExecutionSession. */
export class TransferOrchestratorService {
  private readonly concurrency: number;
  constructor(
    private readonly tasks: TransferTaskRegistry,
    private readonly resolver: SshConnectionResolver,
    private readonly sessions: ExecutionSessionManager,
    private readonly executor: ServerTransferExecutor,
    options: TransferOrchestratorOptions = {},
  ) {
    this.concurrency = Math.max(1, Math.min(20, options.maxConcurrentSubTasks ?? 5));
  }
  async process(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    let source: ExecutionSession | undefined;
    try {
      this.throwIfAborted(signal);
      this.tasks.setOverallStatus(taskId, 'in-progress');
      const sourceConnection = await this.resolver.resolveStored(task.payload.sourceConnectionId);
      this.throwIfAborted(signal);
      source = await this.sessions.connect({
        ownerType: 'system',
        ownerId: `transfer:${taskId}`,
        connection: sourceConnection,
        connect: { signal },
      });
      let next = 0;
      const workers = Array.from({ length: Math.min(this.concurrency, task.subTasks.length) }, async () => {
        while (next < task.subTasks.length && !signal.aborted) {
          const sub = task.subTasks[next++];
          if (!sub || sub.status === 'cancelled') continue;
          await this.processSubTask(taskId, sub, source!, signal);
        }
      });
      await Promise.all(workers);
      this.throwIfAborted(signal);
    } catch (error) {
      if (this.isAbort(error)) {
        this.finishPending(taskId, 'cancelled', 'Transfer cancelled by user.');
        this.tasks.setOverallStatus(taskId, 'cancelled');
      } else {
        const message = error instanceof Error ? error.message : String(error);
        this.finishPending(taskId, 'failed', message);
        if ((this.tasks.get(taskId)?.subTasks.length ?? 0) === 0) this.tasks.setOverallStatus(taskId, 'failed');
      }
    } finally {
      if (source) await this.sessions.close(source.id).catch(() => undefined);
      this.tasks.finalize(taskId);
      this.tasks.releaseCancellation(taskId);
    }
  }
  private async processSubTask(taskId: string, sub: TransferSubTask, source: ExecutionSession, signal: AbortSignal) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const item = task.payload.sourceItems.find((i) => i.name === sub.sourceItemName);
    if (!item) {
      this.tasks.setSubTask(
        taskId,
        sub.subTaskId,
        'failed',
        undefined,
        `Source item '${sub.sourceItemName}' not found in payload.`,
      );
      return;
    }
    try {
      this.throwIfAborted(signal);
      this.tasks.setSubTask(
        taskId,
        sub.subTaskId,
        'connecting',
        undefined,
        `Preparing transfer for ${item.name} to target ID ${sub.connectionId}`,
      );
      const target = await this.resolver.resolveStored(sub.connectionId);
      this.throwIfAborted(signal);
      const method = await this.executor.execute({
        sourceSession: source,
        sourceItem: item,
        targetConnection: target,
        remoteTargetPath: task.payload.remoteTargetPath,
        methodPreference: task.payload.transferMethod,
        signal,
        onProgress: (event) => {
          if (event.method) this.tasks.setMethod(taskId, sub.subTaskId, event.method);
          this.tasks.setSubTask(taskId, sub.subTaskId, 'transferring', event.progress, event.message);
        },
      });
      this.tasks.setMethod(taskId, sub.subTaskId, method);
      this.tasks.setSubTask(taskId, sub.subTaskId, 'completed', 100, `${method} successful.`);
    } catch (error) {
      if (this.isAbort(error)) {
        this.tasks.setSubTask(taskId, sub.subTaskId, 'cancelled', sub.progress, 'Sub-task cancelled by user.');
        return;
      }
      this.tasks.setSubTask(
        taskId,
        sub.subTaskId,
        'failed',
        sub.progress,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  private finishPending(id: string, status: 'failed' | 'cancelled', message: string) {
    const t = this.tasks.get(id);
    if (!t) return;
    for (const s of t.subTasks)
      if (!['completed', 'failed', 'cancelled'].includes(s.status))
        this.tasks.setSubTask(id, s.subTaskId, status, s.progress, message);
  }
  private throwIfAborted(signal: AbortSignal) {
    if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
  }
  private isAbort(error: unknown) {
    return (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    );
  }
}
