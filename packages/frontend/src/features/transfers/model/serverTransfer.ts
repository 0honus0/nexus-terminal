import type { TransferTask } from './transfer';

export type ServerTransferMethod = 'auto' | 'rsync' | 'scp';
export type ServerTransferMethodUsed = 'rsync' | 'scp';
export type ServerTransferTaskStatus =
  'queued' | 'in-progress' | 'completed' | 'failed' | 'partially-completed' | 'cancelling' | 'cancelled';
export type ServerTransferSubTaskStatus =
  'queued' | 'connecting' | 'transferring' | 'completed' | 'failed' | 'cancelling' | 'cancelled';

export interface SendFileSourceItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface SendFilesRequest {
  sourceConnectionId: number;
  connectionIds: number[];
  sourceItems: SendFileSourceItem[];
  remoteTargetPath: string;
  transferMethod: ServerTransferMethod;
}

export interface ServerTransferSubTask {
  subTaskId: string;
  connectionId: number;
  sourceItemName: string;
  status: ServerTransferSubTaskStatus;
  progress?: number;
  message?: string;
  transferMethodUsed?: ServerTransferMethodUsed;
  startTime?: string;
  endTime?: string;
}

export interface ServerTransferTask {
  taskId: string;
  status: ServerTransferTaskStatus;
  createdAt: string;
  updatedAt: string;
  subTasks: ServerTransferSubTask[];
  overallProgress?: number;
  payload: SendFilesRequest;
  sourceConnectionId?: number;
  remoteTargetPath?: string;
}

const mappedStatus = (status: ServerTransferTaskStatus): TransferTask['status'] => {
  if (status === 'in-progress') return 'running';
  if (status === 'partially-completed') return 'partial';
  if (status === 'failed') return 'error';
  return status;
};

export const toTransferTask = (task: ServerTransferTask): TransferTask => {
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
