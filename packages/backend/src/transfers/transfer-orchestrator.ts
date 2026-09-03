import type { Client } from 'ssh2';
import type { ResolvedSshConnection } from '../transport/ssh/ssh-connection.types';
import { RemoteTransferExecutor } from './remote-transfer-executor';
import { TransferTaskRegistry } from './transfer-task-registry';
import type { TransferSubTask } from './transfers.types';

export interface TransferOrchestratorOptions {
  maxConcurrentSubTasks?: number;
  resolveConnection: (connectionId: number) => Promise<ResolvedSshConnection>;
  connectSource: (connection: ResolvedSshConnection, signal: AbortSignal) => Promise<Client>;
}

/** Coordinates one transfer task while delegating state and transfer mechanics. */
export class TransferOrchestrator {
  private readonly maxConcurrentSubTasks: number;
  private readonly resolveConnection: (connectionId: number) => Promise<ResolvedSshConnection>;
  private readonly connectSource: (connection: ResolvedSshConnection, signal: AbortSignal) => Promise<Client>;

  constructor(
    private readonly tasks: TransferTaskRegistry,
    private readonly executor: Pick<RemoteTransferExecutor, 'execute'>,
    options: TransferOrchestratorOptions,
  ) {
    this.maxConcurrentSubTasks = options.maxConcurrentSubTasks ?? 5;
    this.resolveConnection = options.resolveConnection;
    this.connectSource = options.connectSource;
  }

  async process(taskId: string, signal: AbortSignal): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    let sourceClient: Client | undefined;
    try {
      this.throwIfAborted(signal);
      this.tasks.updateOverallStatus(taskId, 'in-progress');

      const sourceConnection = await this.resolveConnection(task.payload.sourceConnectionId);
      this.throwIfAborted(signal);
      sourceClient = await this.connectSource(sourceConnection, signal);
      this.throwIfAborted(signal);

      let nextIndex = 0;
      const workerCount = Math.min(this.maxConcurrentSubTasks, task.subTasks.length);
      const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < task.subTasks.length) {
          if (signal.aborted) return;
          const subTask = task.subTasks[nextIndex++];
          if (!subTask || subTask.status === 'cancelled') continue;
          await this.processSubTask(taskId, subTask, sourceClient!, signal);
        }
      });
      await Promise.all(workers);
      this.throwIfAborted(signal);
    } catch (error) {
      if (this.isAbortError(error)) {
        this.finishPendingSubTasks(taskId, 'cancelled', 'Transfer cancelled by user.');
        this.tasks.updateOverallStatus(taskId, 'cancelled');
      } else {
        console.error(`[TransferOrchestrator] Major error processing task ${taskId}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        this.finishPendingSubTasks(taskId, 'failed', message);
        if ((this.tasks.get(taskId)?.subTasks.length ?? 0) === 0) this.tasks.updateOverallStatus(taskId, 'failed');
      }
    } finally {
      try {
        sourceClient?.end();
      } catch (error) {
        console.warn(`[TransferOrchestrator] Failed to close source SSH client for task ${taskId}:`, error);
      }
      this.tasks.finalize(taskId);
      this.tasks.releaseAbortController(taskId);
    }
  }

  private async processSubTask(
    taskId: string,
    subTask: TransferSubTask,
    sourceClient: Client,
    signal: AbortSignal,
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const sourceItem = task.payload.sourceItems.find((item) => item.name === subTask.sourceItemName);
    if (!sourceItem) {
      this.tasks.updateSubTaskStatus(
        taskId,
        subTask.subTaskId,
        'failed',
        undefined,
        `Source item '${subTask.sourceItemName}' not found in payload.`,
      );
      return;
    }

    try {
      this.throwIfAborted(signal);
      this.tasks.updateSubTaskStatus(
        taskId,
        subTask.subTaskId,
        'connecting',
        undefined,
        `Preparing transfer for ${sourceItem.name} to target ID ${subTask.connectionId}`,
      );
      const targetConnection = await this.resolveConnection(subTask.connectionId);
      this.throwIfAborted(signal);

      const method = await this.executor.execute({
        sourceClient,
        sourceItem,
        targetConnection,
        remoteTargetPath: task.payload.remoteTargetPath,
        methodPreference: task.payload.transferMethod,
        signal,
        onProgress: (event) => {
          if (event.method) this.tasks.setSubTaskMethod(taskId, subTask.subTaskId, event.method);
          this.tasks.updateSubTaskStatus(
            taskId,
            subTask.subTaskId,
            'transferring',
            event.progress,
            event.message,
          );
        },
      });
      this.tasks.setSubTaskMethod(taskId, subTask.subTaskId, method);
      this.tasks.updateSubTaskStatus(taskId, subTask.subTaskId, 'completed', 100, `${method} successful.`);
    } catch (error) {
      if (this.isAbortError(error)) {
        this.tasks.updateSubTaskStatus(
          taskId,
          subTask.subTaskId,
          'cancelled',
          undefined,
          'Sub-task cancelled by user.',
        );
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TransferOrchestrator] Sub-task ${subTask.subTaskId} failed:`, error);
      this.tasks.updateSubTaskStatus(taskId, subTask.subTaskId, 'failed', undefined, message);
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
  }

  private finishPendingSubTasks(
    taskId: string,
    status: 'failed' | 'cancelled',
    message: string,
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    for (const subTask of task.subTasks) {
      if (!['completed', 'failed', 'cancelled'].includes(subTask.status)) {
        this.tasks.updateSubTaskStatus(taskId, subTask.subTaskId, status, subTask.progress, message);
      }
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError'
      || error instanceof Error && error.name === 'AbortError';
  }
}
