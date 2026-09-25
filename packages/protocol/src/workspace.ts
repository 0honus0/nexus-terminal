import type { SuspendedSessionDto } from './ssh-suspend.js';
import type { RemoteResourceStatusDto } from './system.js';

export interface WorkspaceProtocolRequestDto<TPayload = Record<string, unknown>> {
  type: string;
  requestId?: string;
  payload?: TPayload;
}

export interface WorkspaceProtocolResponsePayloadDto<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface WorkspaceProtocolResponseDto<T = unknown> {
  type: 'response';
  requestId: string;
  payload: WorkspaceProtocolResponsePayloadDto<T>;
}

export interface WorkspaceProtocolEventDto<T = unknown, TType extends string = string> {
  type: TType;
  payload?: T;
}

export interface WorkspaceTerminalViewportDto {
  columns: number;
  rows: number;
}

export interface WorkspaceConnectRequestDto {
  workspaceId: string;
  connectionId: number;
  viewport?: WorkspaceTerminalViewportDto;
}

export interface WorkspaceConnectResponseDto {
  workspaceId: string;
  connectionId: number;
  connectionName: string;
  binaryProtocolVersion: number;
  lastConnectedAt?: number;
}

export interface WorkspaceTerminalInputRequestDto {
  data: string;
}

export type WorkspaceTerminalResizeRequestDto = WorkspaceTerminalViewportDto;
export type WorkspaceTerminalCurrentDirectoryResponseDto = string;

export interface WorkspaceTerminalChangeDirectoryRequestDto {
  path: string;
}

export interface WorkspaceTerminalChangeDirectoryResponseDto {
  queued: true;
}

export interface WorkspaceTerminalErrorEventDto {
  message: string;
}

export interface WorkspaceTerminalDirectoryChangeQueuedEventDto {
  requestId: string;
  path: string;
  waitingForPrompt: boolean;
}

export interface WorkspaceTerminalDirectoryChangedEventDto {
  requestId: string;
  path: string;
}

export interface WorkspaceTerminalDirectoryChangeFailedEventDto {
  requestId: string;
  message: string;
}

export interface WorkspaceProtocolErrorEventDto {
  operation: string;
  message: string;
}

export type WorkspaceStatusSampleDto = RemoteResourceStatusDto;

export interface WorkspaceStatusErrorEventDto {
  message: string;
}

export interface WorkspaceDockerPortBindingDto {
  ip?: string;
  privatePort: number;
  publicPort?: number;
  type: string;
}

export interface WorkspaceDockerStatsDto {
  id: string;
  name: string;
  cpuPercent: string;
  memoryUsage: string;
  memoryPercent: string;
  networkIo: string;
  blockIo: string;
  pids: string;
}

export interface WorkspaceDockerContainerDto {
  id: string;
  names: string[];
  image: string;
  imageId: string;
  command: string;
  created: number | string;
  state: string;
  status: string;
  ports: WorkspaceDockerPortBindingDto[];
  labels: Record<string, string> | string;
  stats?: WorkspaceDockerStatsDto | null;
}

export type WorkspaceDockerCommandDto = 'start' | 'stop' | 'restart' | 'remove';

export interface WorkspaceDockerStatusDto {
  available: boolean;
  containers: WorkspaceDockerContainerDto[];
}

export interface WorkspaceDockerCommandRequestDto {
  containerId: string;
  command: WorkspaceDockerCommandDto;
}

export interface WorkspaceDockerStatsRequestDto {
  containerId: string;
}

export interface WorkspaceRemoteFileMetadataDto {
  size: number;
  uid: number;
  gid: number;
  mode: number;
  accessedAt: number;
  modifiedAt: number;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export interface WorkspaceRemoteFileEntryDto {
  name: string;
  path: string;
  longName?: string;
  metadata: WorkspaceRemoteFileMetadataDto;
}

export interface WorkspaceFileSearchEntryDto extends WorkspaceRemoteFileEntryDto {
  relativePath: string;
}

export interface WorkspaceFilesystemPathRequestDto {
  path: string;
}

export interface WorkspaceFilesystemListResponseDto {
  path: string;
  entries: WorkspaceRemoteFileEntryDto[];
}

export interface WorkspaceFilesystemSearchRequestDto {
  path: string;
  query: string;
}

export interface WorkspaceFilesystemSearchResponseDto {
  entries: WorkspaceFileSearchEntryDto[];
  truncated: boolean;
}

export interface WorkspaceFilesystemReadTextRequestDto {
  path: string;
  encoding?: string;
}

export interface WorkspaceFilesystemReadTextResponseDto {
  path: string;
  content: string;
  encoding: string;
}

export interface WorkspaceFilesystemReadBinaryResponseDto {
  path: string;
}

export interface WorkspaceFilesystemWriteTextRequestDto {
  path: string;
  content: string;
  encoding?: string;
}

export interface WorkspaceFilesystemCreateFileRequestDto {
  path: string;
  content?: string;
  encoding?: string;
}

export interface WorkspaceFilesystemRemoveRequestDto {
  paths: string[];
  forceDirectoryPaths?: string[];
}

export interface WorkspaceFilesystemRenameRequestDto {
  from: string;
  to: string;
}

export interface WorkspaceFilesystemChmodRequestDto {
  path: string;
  mode: number;
}

export interface WorkspaceFilesystemRealpathResponseDto {
  requestedPath: string;
  absolutePath: string;
  targetType: 'file' | 'directory' | 'other';
}

export interface WorkspaceFilesystemErrorEventDto {
  message: string;
}

export interface WorkspaceFilesystemRequestMapDto {
  'filesystem.list': WorkspaceFilesystemPathRequestDto;
  'filesystem.search': WorkspaceFilesystemSearchRequestDto;
  'filesystem.stat': WorkspaceFilesystemPathRequestDto;
  'filesystem.readText': WorkspaceFilesystemReadTextRequestDto;
  'filesystem.readBinary': WorkspaceFilesystemPathRequestDto;
  'filesystem.writeText': WorkspaceFilesystemWriteTextRequestDto;
  'filesystem.createDirectory': WorkspaceFilesystemPathRequestDto;
  'filesystem.createFile': WorkspaceFilesystemCreateFileRequestDto;
  'filesystem.remove': WorkspaceFilesystemRemoveRequestDto;
  'filesystem.rename': WorkspaceFilesystemRenameRequestDto;
  'filesystem.chmod': WorkspaceFilesystemChmodRequestDto;
  'filesystem.realpath': WorkspaceFilesystemPathRequestDto;
}

export interface WorkspaceFilesystemResponseMapDto {
  'filesystem.list': WorkspaceFilesystemListResponseDto;
  'filesystem.search': WorkspaceFilesystemSearchResponseDto;
  'filesystem.stat': WorkspaceRemoteFileEntryDto;
  'filesystem.readText': WorkspaceFilesystemReadTextResponseDto;
  'filesystem.readBinary': WorkspaceFilesystemReadBinaryResponseDto;
  'filesystem.writeText': null;
  'filesystem.createDirectory': null;
  'filesystem.createFile': null;
  'filesystem.remove': null;
  'filesystem.rename': null;
  'filesystem.chmod': null;
  'filesystem.realpath': WorkspaceFilesystemRealpathResponseDto;
}

export interface WorkspaceFilesystemEventMapDto {
  'filesystem.ready': Record<string, never>;
  'filesystem.error': WorkspaceFilesystemErrorEventDto;
}

export type WorkspaceTransferModeDto = 'copy' | 'move';

export interface WorkspaceCopyMoveRequestDto {
  mode: WorkspaceTransferModeDto;
  sources: string[];
  destination: string;
  sourceWorkspaceId?: string;
}

export interface WorkspaceOperationStartedResponseDto {
  started: true;
}

export interface WorkspaceTaskCancelRequestDto {
  taskId: string;
}

export type WorkspaceArchiveCompressionFormatDto = 'zip' | 'tar.gz' | 'tar.bz2';

export interface WorkspaceArchiveCompressRequestDto {
  sources: string[];
  destination: string;
  format: WorkspaceArchiveCompressionFormatDto;
  password?: string;
}

export interface WorkspaceArchiveDecompressRequestDto {
  source: string;
  password?: string;
}

export type WorkspaceUploadConflictPolicyDto = 'ask' | 'overwrite' | 'skip';

export interface WorkspaceUploadPrepareRequestDto {
  prepareId: string;
  basePath: string;
  directories: string[];
}

export interface WorkspaceUploadPrepareResponseDto {
  preparedDirectories: number;
}

export interface WorkspaceUploadStartRequestDto {
  uploadId: string;
  destinationPath: string;
  size: number;
  relativePath?: string;
  prepareId?: string;
  conflictPolicy?: WorkspaceUploadConflictPolicyDto;
}

export interface WorkspaceUploadSessionRequestDto {
  uploadId: string;
}

export interface WorkspaceUploadAbortRequestDto {
  uploadId: string;
  message: string;
}

export interface WorkspaceUploadStreamQueryDto {
  workspaceId: string;
  uploadId: string;
  size: number;
}

export type WorkspaceUploadEventDto =
  | { type: 'ready'; uploadId: string }
  | { type: 'conflict'; uploadId: string; destinationPath: string; filename: string }
  | { type: 'skipped'; uploadId: string; destinationPath: string }
  | {
      type: 'progress';
      uploadId: string;
      chunkIndex: number;
      bytesWritten: number;
      totalSize: number;
      progress: number;
    }
  | { type: 'completed'; uploadId: string; destinationPath: string; item: WorkspaceRemoteFileEntryDto }
  | { type: 'cancelled'; uploadId: string }
  | { type: 'failed'; uploadId?: string; message: string };

export type WorkspaceCopyMoveEventDto =
  | {
      type: 'progress';
      requestId: string;
      transferredBytes: number;
      totalBytes: number;
      completedFiles: number;
      totalFiles: number;
      totalKnown: boolean;
      currentFile?: string;
    }
  | {
      type: 'completed';
      requestId: string;
      mode: WorkspaceTransferModeDto;
      sourcePaths: readonly string[];
      destinationPath: string;
      items: WorkspaceRemoteFileEntryDto[];
      crossSession: boolean;
      sourceOwnerId?: string;
    }
  | { type: 'failed'; requestId: string; mode: WorkspaceTransferModeDto; message: string }
  | { type: 'cancelling'; requestId: string }
  | { type: 'cancelled'; requestId: string };

export type WorkspaceArchiveOperationKindDto = 'compress' | 'decompress';
export type WorkspaceArchiveErrorCodeDto =
  | 'PASSWORD_REQUIRED'
  | 'INVALID_PASSWORD'
  | 'PASSWORD_TOO_LONG'
  | 'INVALID_PASSWORD_FORMAT'
  | 'COMMAND_NOT_FOUND'
  | 'UNSUPPORTED_FORMAT';

export type WorkspaceArchiveEventDto =
  | {
      type: 'progress';
      operation: WorkspaceArchiveOperationKindDto;
      requestId: string;
      fileCount: number;
      totalFiles?: number;
      percent?: number;
      currentFile?: string;
    }
  | {
      type: 'completed';
      operation: WorkspaceArchiveOperationKindDto;
      requestId: string;
      path: string;
      warning?: string;
    }
  | {
      type: 'failed';
      operation: WorkspaceArchiveOperationKindDto;
      requestId: string;
      message: string;
      details?: string;
      code?: WorkspaceArchiveErrorCodeDto;
      commandNotFound?: string;
    }
  | { type: 'cancelled'; operation: WorkspaceArchiveOperationKindDto; requestId: string };

export interface WorkspaceTransferRequestMapDto {
  'transfer.copyMove': WorkspaceCopyMoveRequestDto;
  'transfer.cancel': WorkspaceTaskCancelRequestDto;
  'transfer.compress': WorkspaceArchiveCompressRequestDto;
  'transfer.decompress': WorkspaceArchiveDecompressRequestDto;
  'transfer.cancelArchive': WorkspaceTaskCancelRequestDto;
  'upload.prepare': WorkspaceUploadPrepareRequestDto;
  'upload.start': WorkspaceUploadStartRequestDto;
  'upload.cancel': WorkspaceUploadSessionRequestDto;
  'upload.abort': WorkspaceUploadAbortRequestDto;
}

export interface WorkspaceTransferResponseMapDto {
  'transfer.copyMove': WorkspaceOperationStartedResponseDto;
  'transfer.cancel': boolean;
  'transfer.compress': WorkspaceOperationStartedResponseDto;
  'transfer.decompress': WorkspaceOperationStartedResponseDto;
  'transfer.cancelArchive': boolean;
  'upload.prepare': WorkspaceUploadPrepareResponseDto;
  'upload.start': WorkspaceOperationStartedResponseDto;
  'upload.cancel': boolean;
  'upload.abort': boolean;
}

export interface WorkspaceTransferEventMapDto {
  'transfer.upload': WorkspaceUploadEventDto;
  'transfer.copyMove': WorkspaceCopyMoveEventDto;
  'transfer.archive': WorkspaceArchiveEventDto;
}

export interface WorkspaceCoreRequestMapDto {
  'workspace.connect': WorkspaceConnectRequestDto;
  'terminal.input': WorkspaceTerminalInputRequestDto;
  'terminal.resize': WorkspaceTerminalResizeRequestDto;
  'terminal.currentDirectory': Record<string, never>;
  'terminal.changeDirectory': WorkspaceTerminalChangeDirectoryRequestDto;
  'status.start': Record<string, never>;
  'status.stop': Record<string, never>;
  'docker.status': Record<string, never>;
  'docker.command': WorkspaceDockerCommandRequestDto;
  'docker.stats': WorkspaceDockerStatsRequestDto;
}

export interface WorkspaceCoreResponseMapDto {
  'workspace.connect': WorkspaceConnectResponseDto;
  'terminal.input': null;
  'terminal.resize': null;
  'terminal.currentDirectory': WorkspaceTerminalCurrentDirectoryResponseDto;
  'terminal.changeDirectory': WorkspaceTerminalChangeDirectoryResponseDto;
  'status.start': null;
  'status.stop': null;
  'docker.status': WorkspaceDockerStatusDto;
  'docker.command': null;
  'docker.stats': WorkspaceDockerStatsDto | null;
}

export interface WorkspaceCoreEventMapDto {
  'protocol.error': WorkspaceProtocolErrorEventDto;
  'terminal.closed': Record<string, never>;
  'terminal.error': WorkspaceTerminalErrorEventDto;
  'terminal.directoryChangeQueued': WorkspaceTerminalDirectoryChangeQueuedEventDto;
  'terminal.directoryChanged': WorkspaceTerminalDirectoryChangedEventDto;
  'terminal.directoryChangeFailed': WorkspaceTerminalDirectoryChangeFailedEventDto;
  'status.sample': WorkspaceStatusSampleDto;
  'status.error': WorkspaceStatusErrorEventDto;
}

export interface WorkspaceSuspendMarkRequestDto {
  terminalSnapshot?: string;
}

export interface WorkspaceSuspendMarkResponseDto {
  suspendedSessionId: string;
}

export type WorkspaceSuspendUnmarkRequestDto = Record<string, never>;

export type WorkspaceSuspendListResponseDto = SuspendedSessionDto[];

export interface WorkspaceSuspendResumeRequestDto {
  suspendedSessionId: string;
  workspaceId: string;
  viewport?: WorkspaceTerminalViewportDto;
  takeover?: boolean;
}

export interface WorkspaceSuspendResumeResponseDto extends WorkspaceConnectResponseDto {
  resumedFrom: string;
  historyAvailable: boolean;
  ownershipGeneration: number;
  ownershipLeaseExpiresAt: number;
}

export interface WorkspaceSuspendOwnerRenewResponseDto {
  generation: number;
  leaseExpiresAt: number;
}

export interface WorkspaceSuspendHistoryPreviousResponseDto {
  hasMore: boolean;
}

export interface WorkspaceSuspendHistoryResetResponseDto {
  available: boolean;
}

export interface WorkspaceSuspendSessionRequestDto {
  suspendedSessionId: string;
}

export interface WorkspaceSuspendRenameRequestDto {
  suspendedSessionId: string;
  name: string;
}

export interface WorkspaceSuspendAutoTerminatedEventDto {
  suspendedSessionId: string;
  reason: string;
}

export type WorkspaceSuspendRevokedReasonDto = 'takeover' | 'lease_expired';

export interface WorkspaceSuspendRevokedEventDto {
  suspendedSessionId: string;
  generation: number;
  reason: WorkspaceSuspendRevokedReasonDto;
  message: string;
}

export interface WorkspaceSuspendRequestMapDto {
  'suspend.mark': WorkspaceSuspendMarkRequestDto;
  'suspend.unmark': WorkspaceSuspendUnmarkRequestDto;
  'suspend.list': Record<string, never>;
  'suspend.resume': WorkspaceSuspendResumeRequestDto;
  'suspend.owner.renew': Record<string, never>;
  'suspend.history.previous': Record<string, never>;
  'suspend.history.reset': Record<string, never>;
  'suspend.terminate': WorkspaceSuspendSessionRequestDto;
  'suspend.remove': WorkspaceSuspendSessionRequestDto;
  'suspend.rename': WorkspaceSuspendRenameRequestDto;
}

export interface WorkspaceSuspendResponseMapDto {
  'suspend.mark': WorkspaceSuspendMarkResponseDto;
  'suspend.unmark': null;
  'suspend.list': WorkspaceSuspendListResponseDto;
  'suspend.resume': WorkspaceSuspendResumeResponseDto;
  'suspend.owner.renew': WorkspaceSuspendOwnerRenewResponseDto;
  'suspend.history.previous': WorkspaceSuspendHistoryPreviousResponseDto;
  'suspend.history.reset': WorkspaceSuspendHistoryResetResponseDto;
  'suspend.terminate': null;
  'suspend.remove': null;
  'suspend.rename': null;
}

export interface WorkspaceSuspendEventMapDto {
  'suspend.autoTerminated': WorkspaceSuspendAutoTerminatedEventDto;
  'suspend.revoked': WorkspaceSuspendRevokedEventDto;
}

export interface WorkspaceRequestMapDto
  extends
    WorkspaceCoreRequestMapDto,
    WorkspaceFilesystemRequestMapDto,
    WorkspaceTransferRequestMapDto,
    WorkspaceSuspendRequestMapDto {}

export interface WorkspaceResponseMapDto
  extends
    WorkspaceCoreResponseMapDto,
    WorkspaceFilesystemResponseMapDto,
    WorkspaceTransferResponseMapDto,
    WorkspaceSuspendResponseMapDto {}

export interface WorkspaceEventMapDto
  extends
    WorkspaceCoreEventMapDto,
    WorkspaceFilesystemEventMapDto,
    WorkspaceTransferEventMapDto,
    WorkspaceSuspendEventMapDto {}
