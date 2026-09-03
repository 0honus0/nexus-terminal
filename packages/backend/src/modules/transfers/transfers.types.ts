export type TransferMethodPreference = 'auto' | 'rsync' | 'scp';
export type TransferMethodUsed = 'rsync' | 'scp';

export interface InitiateTransferPayload {
  sourceConnectionId: number;
  connectionIds: number[];
  sourceItems: Array<{ name: string; path: string; type: 'file' | 'directory' }>;
  remoteTargetPath: string;
  transferMethod: TransferMethodPreference;
}

export type TransferSubTaskStatus =
  'queued' | 'connecting' | 'transferring' | 'completed' | 'failed' | 'cancelling' | 'cancelled';
export interface TransferSubTask {
  subTaskId: string;
  connectionId: number;
  sourceItemName: string;
  status: TransferSubTaskStatus;
  progress?: number;
  message?: string;
  transferMethodUsed?: TransferMethodUsed;
  startTime?: Date;
  endTime?: Date;
}

export type TransferTaskStatus =
  'queued' | 'in-progress' | 'completed' | 'failed' | 'partially-completed' | 'cancelling' | 'cancelled';
export interface TransferTask {
  taskId: string;
  status: TransferTaskStatus;
  userId: string | number;
  createdAt: Date;
  updatedAt: Date;
  subTasks: TransferSubTask[];
  overallProgress?: number;
  payload: InitiateTransferPayload;
  sourceConnectionId?: number;
  remoteTargetPath?: string;
}
