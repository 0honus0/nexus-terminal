import type {
  SendFileSourceItemDto,
  SendFilesRequestDto,
  ServerTransferMethodDto,
  ServerTransferMethodUsedDto,
  ServerTransferSubTaskDto,
  ServerTransferSubTaskStatusDto,
  ServerTransferTaskDto,
  ServerTransferTaskStatusDto,
} from '@nexus-terminal/protocol/transfers';
import type { TransferTask } from './transfer';
export type {
  SendFileSourceItemDto,
  SendFilesRequestDto,
  ServerTransferMethodDto,
  ServerTransferMethodUsedDto,
  ServerTransferSubTaskDto,
  ServerTransferSubTaskStatusDto,
  ServerTransferTaskDto,
  ServerTransferTaskStatusDto,
};

const mappedStatus = (status: ServerTransferTaskStatusDto): TransferTask['status'] => {
  if (status === 'in-progress') return 'running';
  if (status === 'partially-completed') return 'partial';
  if (status === 'failed') return 'error';
  return status;
};

export const toTransferTask = (task: ServerTransferTaskDto): TransferTask => {
  const completedFiles = task.subTasks.filter((subTask) => subTask.status === 'completed').length;
  const errors = task.subTasks
    .filter((subTask) => subTask.status === 'failed' && subTask.message)
    .map((item) => item.message!);
  const names = [...new Set(task.payload.sourceItems.map((item) => item.name))];
  return {
    id: task.taskId,
    kind: 'transfer',
    label: `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''} → ${task.payload.remoteTargetPath}`,
    status: mappedStatus(task.status),
    progress: task.overallProgress ?? 0,
    bytesWritten: 0,
    totalBytes: 0,
    completedFiles,
    totalFiles: task.subTasks.length,
    error: errors.length ? errors.join('; ') : undefined,
    createdAt: Number.isFinite(Date.parse(task.createdAt)) ? Date.parse(task.createdAt) : Date.now(),
  };
};
