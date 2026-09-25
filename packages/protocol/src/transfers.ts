export const SERVER_TRANSFER_METHODS = ['auto', 'rsync', 'scp'] as const;
export type ServerTransferMethodDto = (typeof SERVER_TRANSFER_METHODS)[number];
export type ServerTransferMethodUsedDto = 'rsync' | 'scp';
export type ServerTransferTaskStatusDto =
  'queued' | 'in-progress' | 'completed' | 'failed' | 'partially-completed' | 'cancelling' | 'cancelled';
export type ServerTransferSubTaskStatusDto =
  'queued' | 'connecting' | 'transferring' | 'completed' | 'failed' | 'cancelling' | 'cancelled';

export interface SendFileSourceItemDto {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface SendFilesRequestDto {
  sourceConnectionId: number;
  connectionIds: number[];
  sourceItems: SendFileSourceItemDto[];
  remoteTargetPath: string;
  transferMethod: ServerTransferMethodDto;
}

export interface ServerTransferSubTaskDto {
  subTaskId: string;
  connectionId: number;
  sourceItemName: string;
  status: ServerTransferSubTaskStatusDto;
  progress?: number;
  message?: string;
  transferMethodUsed?: ServerTransferMethodUsedDto;
  startTime?: string;
  endTime?: string;
}

export interface ServerTransferTaskDto {
  taskId: string;
  status: ServerTransferTaskStatusDto;
  createdAt: string;
  updatedAt: string;
  subTasks: ServerTransferSubTaskDto[];
  overallProgress?: number;
  payload: SendFilesRequestDto;
  sourceConnectionId?: number;
  remoteTargetPath?: string;
}
