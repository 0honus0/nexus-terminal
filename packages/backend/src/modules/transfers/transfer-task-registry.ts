import { v4 as uuidv4 } from 'uuid';
import type { InitiateTransferPayload, TransferSubTask, TransferTask } from './transfers.types';

export interface CreatedTransferTask {
  task: TransferTask;
  abortController: AbortController;
}

/** Owns durable-in-process transfer task state and cancellation ownership. */
export class TransferTaskRegistry {
  private readonly transferTasks = new Map<string, TransferTask>();
  private readonly taskAbortControllers = new Map<string, AbortController>();

  isFinalTaskStatus(status: TransferTask['status']): boolean {
    return ['completed', 'failed', 'partially-completed', 'cancelled'].includes(status);
  }

  create(payload: InitiateTransferPayload, userId: string | number): CreatedTransferTask {
    const taskId = uuidv4();
    const now = new Date();
    const subTasks: TransferSubTask[] = [];
    const abortController = new AbortController();

    for (const connectionId of payload.connectionIds) {
      for (const item of payload.sourceItems) {
        subTasks.push({
          subTaskId: uuidv4(),
          connectionId,
          sourceItemName: item.name,
          status: 'queued',
          startTime: now,
        });
      }
    }

    const task: TransferTask = {
      taskId,
      status: 'queued',
      userId,
      createdAt: now,
      updatedAt: now,
      subTasks,
      payload,
    };
    this.transferTasks.set(taskId, task);
    this.taskAbortControllers.set(taskId, abortController);
    return { task: this.cloneTask(task), abortController };
  }

  get(taskId: string): TransferTask | undefined {
    return this.transferTasks.get(taskId);
  }

  getOwned(taskId: string, userId: string | number): TransferTask | undefined {
    const task = this.transferTasks.get(taskId);
    return task?.userId === userId ? task : undefined;
  }

  getAbortController(taskId: string): AbortController | undefined {
    return this.taskAbortControllers.get(taskId);
  }

  releaseAbortController(taskId: string): void {
    this.taskAbortControllers.delete(taskId);
  }

  remove(taskId: string, userId: string | number): 'removed' | 'not-found' | 'active' {
    const task = this.getOwned(taskId, userId);
    if (!task) return 'not-found';
    if (!this.isFinalTaskStatus(task.status) || this.taskAbortControllers.has(taskId)) return 'active';
    this.transferTasks.delete(taskId);
    return 'removed';
  }

  cancel(taskId: string, userId: string | number): boolean {
    const task = this.getOwned(taskId, userId);
    if (!task || this.isFinalTaskStatus(task.status)) return false;

    const abortController = this.taskAbortControllers.get(taskId);
    if (!abortController) return false;
    if (abortController.signal.aborted) return true;

    this.updateOverallStatus(taskId, 'cancelling');
    for (const subTask of task.subTasks) {
      if (!['completed', 'failed', 'cancelled'].includes(subTask.status)) {
        this.updateSubTaskStatus(
          taskId,
          subTask.subTaskId,
          'cancelled',
          subTask.progress,
          'Cancelled due to parent task cancellation.',
        );
      }
    }
    abortController.abort();
    return true;
  }

  details(taskId: string, userId: string | number): TransferTask | null {
    const task = this.getOwned(taskId, userId);
    return task ? this.cloneTaskWithConvenienceFields(task) : null;
  }

  list(userId: string | number): TransferTask[] {
    return [...this.transferTasks.values()]
      .filter((task) => task.userId === userId)
      .map((task) => this.cloneTaskWithConvenienceFields(task));
  }

  updateSubTaskStatus(
    taskId: string,
    subTaskId: string,
    newStatus: TransferSubTask['status'],
    progress?: number,
    message?: string,
  ): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;
    const subTask = task.subTasks.find((candidate) => candidate.subTaskId === subTaskId);
    if (!subTask) return;

    const finalStatuses: TransferSubTask['status'][] = ['completed', 'failed', 'cancelled'];
    if (finalStatuses.includes(subTask.status) && newStatus !== subTask.status) return;

    subTask.status = newStatus;
    if (progress !== undefined) subTask.progress = Math.min(100, Math.max(0, progress));
    if (message !== undefined) subTask.message = message;
    if (finalStatuses.includes(newStatus) && !subTask.endTime) subTask.endTime = new Date();
    task.updatedAt = new Date();
    this.recalculateOverallStatus(taskId);
  }

  setSubTaskMethod(taskId: string, subTaskId: string, method: 'rsync' | 'scp'): void {
    const subTask = this.transferTasks.get(taskId)?.subTasks.find((candidate) => candidate.subTaskId === subTaskId);
    if (subTask) subTask.transferMethodUsed = method;
  }

  updateOverallStatus(taskId: string, newStatus: TransferTask['status']): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;

    const currentFinal = this.isFinalTaskStatus(task.status);
    const nextTransient = newStatus === 'queued' || newStatus === 'in-progress';
    if (task.status === 'cancelled' && newStatus !== 'cancelled') return;
    if (currentFinal && nextTransient) return;

    task.status = newStatus;
    task.updatedAt = new Date();
  }

  recalculateOverallStatus(taskId: string): void {
    const task = this.transferTasks.get(taskId);
    if (!task) return;

    let completedCount = 0;
    let failedCount = 0;
    let cancelledCount = 0;
    let inProgressCount = 0;
    let queuedCount = 0;
    let totalProgress = 0;
    const count = task.subTasks.length;

    if (count === 0) {
      task.overallProgress = 0;
      task.updatedAt = new Date();
      return;
    }

    for (const subTask of task.subTasks) {
      switch (subTask.status) {
        case 'completed':
          completedCount += 1;
          totalProgress += 100;
          break;
        case 'failed':
          failedCount += 1;
          totalProgress += subTask.progress || 0;
          break;
        case 'cancelled':
          cancelledCount += 1;
          totalProgress += subTask.progress || 0;
          break;
        case 'transferring':
        case 'connecting':
        case 'cancelling':
          inProgressCount += 1;
          totalProgress += subTask.progress !== undefined ? subTask.progress : subTask.status === 'connecting' ? 5 : 0;
          break;
        case 'queued':
          queuedCount += 1;
          break;
      }
    }

    task.overallProgress = Math.round(totalProgress / count);
    const terminalCount = completedCount + failedCount + cancelledCount;
    let status: TransferTask['status'];
    if (task.status === 'cancelled') status = 'cancelled';
    else if (task.status === 'cancelling' || cancelledCount > 0) status = terminalCount === count ? 'cancelled' : 'cancelling';
    else if (failedCount === count) status = 'failed';
    else if (completedCount === count) status = 'completed';
    else if (failedCount > 0 && completedCount + failedCount === count) status = 'partially-completed';
    else if (inProgressCount > 0 || (queuedCount > 0 && (failedCount > 0 || completedCount > 0))) status = 'in-progress';
    else if (queuedCount === count) status = 'queued';
    else status = 'in-progress';

    task.status = status;
    task.updatedAt = new Date();
  }

  finalize(taskId: string): void {
    this.recalculateOverallStatus(taskId);
  }

  private cloneTask(task: TransferTask): TransferTask {
    return { ...task, subTasks: task.subTasks.map((subTask) => ({ ...subTask })) };
  }

  private cloneTaskWithConvenienceFields(task: TransferTask): TransferTask {
    return {
      ...this.cloneTask(task),
      sourceConnectionId: task.payload.sourceConnectionId,
      remoteTargetPath: task.payload.remoteTargetPath,
    };
  }
}
