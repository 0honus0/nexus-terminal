import type { TransferOrchestratorService } from './transfer-orchestrator.service';
import type { TransferTaskRegistry } from './transfer-task.registry';
import type { InitiateTransferPayload, TransferTask } from './transfers.types';

/** User-facing transfer task lifecycle. */
export class TransfersService {
  constructor(
    private readonly tasks: TransferTaskRegistry,
    private readonly orchestrator: TransferOrchestratorService,
  ) {}
  async initiate(payload: InitiateTransferPayload, userId: string | number): Promise<TransferTask> {
    this.validate(payload);
    const { task, signal } = this.tasks.create(payload, userId);
    void this.orchestrator.process(task.taskId, signal).catch((error) => {
      this.tasks.setOverallStatus(
        task.taskId,
        error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
      );
      this.tasks.releaseCancellation(task.taskId);
    });
    return task;
  }
  cancel(taskId: string, userId: string | number) {
    return this.tasks.cancel(taskId, userId);
  }
  details(taskId: string, userId: string | number) {
    return this.tasks.details(taskId, userId);
  }
  list(userId: string | number) {
    return this.tasks.list(userId);
  }
  remove(taskId: string, userId: string | number) {
    return this.tasks.remove(taskId, userId);
  }
  private validate(p: InitiateTransferPayload) {
    if (!Number.isInteger(p.sourceConnectionId) || p.sourceConnectionId <= 0)
      throw new Error('sourceConnectionId 无效。');
    if (!p.connectionIds?.length || p.connectionIds.some((id) => !Number.isInteger(id) || id <= 0))
      throw new Error('connectionIds 必须包含有效连接 ID。');
    if (
      !p.sourceItems?.length ||
      p.sourceItems.some((i) => !i.name || !i.path || !['file', 'directory'].includes(i.type))
    )
      throw new Error('sourceItems 无效。');
    if (!p.remoteTargetPath?.trim()) throw new Error('remoteTargetPath 不能为空。');
    if (!['auto', 'rsync', 'scp'].includes(p.transferMethod)) throw new Error('transferMethod 无效。');
  }
}
