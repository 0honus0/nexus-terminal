import type { InitiateTransferPayload, TransferTask } from './transfers.types';
import { sshCredentialResolver } from '../../infrastructure/ssh/connection/ssh-credential-resolver';
import { sshConnectionFactory } from '../../infrastructure/ssh/connection/ssh-connection-factory';
import { TransferTaskRegistry } from './transfer-task-registry';
import { RemoteTransferExecutor } from '../../platform/operations/transfer/remote-transfer-executor';
import { TransferOrchestrator } from './transfer-orchestrator';

/** Compatibility facade for the existing HTTP controller. */
export class TransfersService {
  private readonly tasks = new TransferTaskRegistry();
  private readonly orchestrator = new TransferOrchestrator(this.tasks, new RemoteTransferExecutor(), {
    resolveConnection: (connectionId) => sshCredentialResolver.resolveStored(connectionId),
    connectSource: (connection, signal) => sshConnectionFactory.connect(connection, undefined, signal),
  });

  constructor() {
    console.info('[TransfersService] Initialized.');
  }

  removeTransferTask(taskId: string, userId: string | number): 'removed' | 'not-found' | 'active' {
    return this.tasks.remove(taskId, userId);
  }

  async initiateNewTransfer(payload: InitiateTransferPayload, userId: string | number): Promise<TransferTask> {
    const { task, abortController } = this.tasks.create(payload, userId);
    void this.orchestrator.process(task.taskId, abortController.signal).catch((error) => {
      console.error(`[TransfersService] Background orchestration failed for task ${task.taskId}:`, error);
      if (error instanceof Error && error.name !== 'AbortError') this.tasks.updateOverallStatus(task.taskId, 'failed');
      this.tasks.releaseAbortController(task.taskId);
    });
    return task;
  }

  async cancelTransferTask(taskId: string, userId: string | number): Promise<boolean> {
    return this.tasks.cancel(taskId, userId);
  }

  async getTransferTaskDetails(taskId: string, userId: string | number): Promise<TransferTask | null> {
    return this.tasks.details(taskId, userId);
  }

  async getAllTransferTasks(userId: string | number): Promise<TransferTask[]> {
    return this.tasks.list(userId);
  }
}
