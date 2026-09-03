export type TransferTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface TransferTask {
  id: string;
  userId: number;
  status: TransferTaskStatus;
  progress: number;
  createdAt: number;
  updatedAt: number;
}

export class TransferTaskRegistry {
  private readonly tasks = new Map<string, TransferTask>();

  getOwnedTask(userId: number, taskId: string): TransferTask | null {
    const task = this.tasks.get(taskId);
    return task?.userId === userId ? task : null;
  }

  snapshot(): readonly TransferTask[] {
    return [...this.tasks.values()];
  }
}
