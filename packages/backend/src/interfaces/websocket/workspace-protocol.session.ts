import { randomUUID } from 'node:crypto';
import type { SuspendedSessionDto } from '@nexus-terminal/protocol/ssh-suspend';
import type {
  WorkspaceConnectRequestDto,
  WorkspaceConnectResponseDto,
  WorkspaceArchiveCompressRequestDto,
  WorkspaceArchiveDecompressRequestDto,
  WorkspaceArchiveEventDto,
  WorkspaceCopyMoveEventDto,
  WorkspaceCopyMoveRequestDto,
  WorkspaceDockerCommandDto,
  WorkspaceDockerCommandRequestDto,
  WorkspaceDockerStatsDto,
  WorkspaceDockerStatsRequestDto,
  WorkspaceDockerStatusDto,
  WorkspaceEventMapDto,
  WorkspaceFileSearchEntryDto,
  WorkspaceFilesystemChmodRequestDto,
  WorkspaceFilesystemCreateFileRequestDto,
  WorkspaceFilesystemListResponseDto,
  WorkspaceFilesystemPathRequestDto,
  WorkspaceFilesystemReadBinaryResponseDto,
  WorkspaceFilesystemReadTextRequestDto,
  WorkspaceFilesystemReadTextResponseDto,
  WorkspaceFilesystemRealpathResponseDto,
  WorkspaceFilesystemRemoveRequestDto,
  WorkspaceFilesystemRenameRequestDto,
  WorkspaceFilesystemSearchRequestDto,
  WorkspaceFilesystemSearchResponseDto,
  WorkspaceFilesystemWriteTextRequestDto,
  WorkspaceProtocolResponseDto,
  WorkspaceRemoteFileEntryDto,
  WorkspaceRemoteFileMetadataDto,
  WorkspaceSuspendAutoTerminatedEventDto,
  WorkspaceSuspendHistoryPreviousResponseDto,
  WorkspaceSuspendHistoryResetResponseDto,
  WorkspaceSuspendListResponseDto,
  WorkspaceSuspendMarkRequestDto,
  WorkspaceSuspendMarkResponseDto,
  WorkspaceSuspendOwnerRenewResponseDto,
  WorkspaceSuspendRenameRequestDto,
  WorkspaceSuspendResumeRequestDto,
  WorkspaceSuspendResumeResponseDto,
  WorkspaceSuspendRevokedEventDto,
  WorkspaceSuspendSessionRequestDto,
  WorkspaceTerminalChangeDirectoryRequestDto,
  WorkspaceTerminalChangeDirectoryResponseDto,
  WorkspaceTerminalCurrentDirectoryResponseDto,
  WorkspaceTerminalInputRequestDto,
  WorkspaceTerminalResizeRequestDto,
  WorkspaceOperationStartedResponseDto,
  WorkspaceTaskCancelRequestDto,
  WorkspaceUploadAbortRequestDto,
  WorkspaceUploadConflictPolicyDto,
  WorkspaceUploadEventDto,
  WorkspaceUploadPrepareRequestDto,
  WorkspaceUploadPrepareResponseDto,
  WorkspaceUploadSessionRequestDto,
  WorkspaceUploadStartRequestDto,
} from '@nexus-terminal/protocol/workspace';
import WebSocket, { type RawData } from 'ws';
import type { WorkspaceCommandService } from '../../modules/workspace/services/workspace-command.service';
import type { WorkspaceDockerService } from '../../modules/workspace/services/workspace-docker.service';
import type { WorkspaceFilesystemService } from '../../modules/workspace/services/workspace-filesystem.service';
import type { WorkspaceOperationsService } from '../../modules/workspace/services/workspace-operations.service';
import type { WorkspaceShellIntegrationService } from '../../modules/workspace/services/workspace-shell-integration.service';
import type { WorkspaceStatusMonitorService } from '../../modules/workspace/services/workspace-status-monitor.service';
import type { WorkspaceSuspendCoordinatorService } from '../../modules/workspace/services/workspace-suspend-coordinator.service';
import type { WorkspaceTerminalService } from '../../modules/workspace/services/workspace-terminal.service';
import type { WorkspaceEvent, WorkspaceEventHub } from '../../modules/workspace/workspace-event-hub';
import type { WorkspaceService } from '../../modules/workspace/workspace.service';
import type { SshSuspendService } from '../../modules/ssh-suspend/ssh-suspend.service';
import { logger } from '../../shared/logging/logger';
import { runtimePerformanceMetrics } from '../../shared/observability/runtime-performance';
import type {
  DockerStats as PlatformDockerStats,
  DockerStatus as PlatformDockerStatus,
} from '../../platform/docker/docker.port';
import type {
  RemoteFileEntry as PlatformRemoteFileEntry,
  RemoteFileSearchEntry as PlatformRemoteFileSearchEntry,
} from '../../platform/filesystem/file-entry';
import type { RemoteFileMetadata as PlatformRemoteFileMetadata } from '../../platform/filesystem/remote-filesystem';
import type {
  ArchiveEvent as PlatformArchiveEvent,
  ArchiveFormat,
} from '../../platform/operations/archive/archive-operation.port';
import type { TransferEvent as PlatformTransferEvent } from '../../platform/operations/transfer/transfer-operation.port';
import type { UploadEvent as PlatformUploadEvent } from '../../platform/operations/upload/upload-operation.port';
import { TerminalStreamTransport } from './terminal-stream.transport';
import {
  encodeWorkspaceBinaryFrame,
  MAX_WORKSPACE_BINARY_PAYLOAD_BYTES,
  MAX_WORKSPACE_BINARY_REQUEST_ID_BYTES,
  WORKSPACE_BINARY_PROTOCOL_VERSION,
} from './workspace-binary.protocol';
import type { WorkspaceProtocolRequest } from './workspace-protocol.types';

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_JSON_MESSAGE_BYTES = 1024 * 1024;
const BINARY_HIGH_WATER_BYTES = 1024 * 1024;
const BINARY_BACKPRESSURE_POLL_MS = 10;
const HIGH_FREQUENCY_OPERATIONS = new Set(['terminal.input', 'terminal.resize', 'docker.stats', 'suspend.owner.renew']);

type JsonRecord = Record<string, unknown>;
const isJsonRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): JsonRecord =>
  isJsonRecord(value) ? value : {};
const stringValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

class WorkspaceBinaryResponse {
  constructor(
    readonly data: unknown,
    readonly source: AsyncIterable<Uint8Array | Buffer | string>,
  ) {}
}

const singleBinaryChunk = async function* (value: Uint8Array): AsyncIterable<Uint8Array> {
  if (value.byteLength) yield value;
};

const dockerStatsWire = (stats: PlatformDockerStats): WorkspaceDockerStatsDto => ({
  id: stats.ID,
  name: stats.Name,
  cpuPercent: stats.CPUPerc,
  memoryUsage: stats.MemUsage,
  memoryPercent: stats.MemPerc,
  networkIo: stats.NetIO,
  blockIo: stats.BlockIO,
  pids: stats.PIDs,
});

const dockerStatusWire = (status: PlatformDockerStatus): WorkspaceDockerStatusDto => ({
  available: status.available,
  containers: status.containers.map((container) => ({
    id: container.id,
    names: container.Names,
    image: container.Image,
    imageId: container.ImageID,
    command: container.Command,
    created: container.Created,
    state: container.State,
    status: container.Status,
    ports: container.Ports.map((port) => ({
      ...(port.IP ? { ip: port.IP } : {}),
      privatePort: port.PrivatePort,
      ...(port.PublicPort !== undefined ? { publicPort: port.PublicPort } : {}),
      type: port.Type,
    })),
    labels: container.Labels,
    stats: container.stats ? dockerStatsWire(container.stats) : null,
  })),
});

const remoteFileMetadataDto = (metadata: PlatformRemoteFileMetadata): WorkspaceRemoteFileMetadataDto => ({
  size: metadata.size,
  uid: metadata.uid,
  gid: metadata.gid,
  mode: metadata.mode,
  accessedAt: metadata.accessedAt,
  modifiedAt: metadata.modifiedAt,
  isFile: metadata.isFile,
  isDirectory: metadata.isDirectory,
  isSymbolicLink: metadata.isSymbolicLink,
});

const remoteFileEntryDto = (entry: PlatformRemoteFileEntry): WorkspaceRemoteFileEntryDto => ({
  name: entry.name,
  path: entry.path,
  ...(entry.longName === undefined ? {} : { longName: entry.longName }),
  metadata: remoteFileMetadataDto(entry.metadata),
});

const fileSearchEntryDto = (entry: PlatformRemoteFileSearchEntry): WorkspaceFileSearchEntryDto => ({
  ...remoteFileEntryDto(entry),
  relativePath: entry.relativePath,
});

const uploadEventDto = (event: PlatformUploadEvent): WorkspaceUploadEventDto => {
  switch (event.type) {
    case 'ready':
      return { type: event.type, uploadId: event.uploadId };
    case 'conflict':
      return {
        type: event.type,
        uploadId: event.uploadId,
        destinationPath: event.destinationPath,
        filename: event.filename,
      };
    case 'skipped':
      return { type: event.type, uploadId: event.uploadId, destinationPath: event.destinationPath };
    case 'progress':
      return {
        type: event.type,
        uploadId: event.uploadId,
        chunkIndex: event.chunkIndex,
        bytesWritten: event.bytesWritten,
        totalSize: event.totalSize,
        progress: event.progress,
      };
    case 'completed':
      return {
        type: event.type,
        uploadId: event.uploadId,
        destinationPath: event.destinationPath,
        item: remoteFileEntryDto(event.item),
      };
    case 'cancelled':
      return { type: event.type, uploadId: event.uploadId };
    case 'failed':
      return {
        type: event.type,
        ...(event.uploadId === undefined ? {} : { uploadId: event.uploadId }),
        message: event.message,
      };
  }
};

const copyMoveEventDto = (event: PlatformTransferEvent): WorkspaceCopyMoveEventDto => {
  switch (event.type) {
    case 'progress':
      return {
        type: event.type,
        requestId: event.requestId,
        transferredBytes: event.transferredBytes,
        totalBytes: event.totalBytes,
        completedFiles: event.completedFiles,
        totalFiles: event.totalFiles,
        totalKnown: event.totalKnown,
        ...(event.currentFile === undefined ? {} : { currentFile: event.currentFile }),
      };
    case 'completed':
      return {
        type: event.type,
        requestId: event.requestId,
        mode: event.mode,
        sourcePaths: event.sourcePaths,
        destinationPath: event.destinationPath,
        items: event.items.map(remoteFileEntryDto),
        crossSession: event.crossSession,
        ...(event.sourceOwnerId === undefined ? {} : { sourceOwnerId: event.sourceOwnerId }),
      };
    case 'failed':
      return { type: event.type, requestId: event.requestId, mode: event.mode, message: event.message };
    case 'cancelling':
    case 'cancelled':
      return { type: event.type, requestId: event.requestId };
  }
};

const archiveEventDto = (event: PlatformArchiveEvent): WorkspaceArchiveEventDto => {
  switch (event.type) {
    case 'progress':
      return {
        type: event.type,
        operation: event.operation,
        requestId: event.requestId,
        fileCount: event.fileCount,
        ...(event.totalFiles === undefined ? {} : { totalFiles: event.totalFiles }),
        ...(event.percent === undefined ? {} : { percent: event.percent }),
        ...(event.currentFile === undefined ? {} : { currentFile: event.currentFile }),
      };
    case 'completed':
      return {
        type: event.type,
        operation: event.operation,
        requestId: event.requestId,
        path: event.path,
        ...(event.warning === undefined ? {} : { warning: event.warning }),
      };
    case 'failed':
      return {
        type: event.type,
        operation: event.operation,
        requestId: event.requestId,
        message: event.message,
        ...(event.details === undefined ? {} : { details: event.details }),
        ...(event.code === undefined ? {} : { code: event.code }),
        ...(event.commandNotFound === undefined ? {} : { commandNotFound: event.commandNotFound }),
      };
    case 'cancelled':
      return { type: event.type, operation: event.operation, requestId: event.requestId };
  }
};

const suspendedSessionDto = (session: ReturnType<SshSuspendService['list']>[number]): SuspendedSessionDto => ({
  id: session.suspendSessionId,
  originalWorkspaceId: session.originalSessionId,
  connectionId: Number(session.connectionId),
  connectionName: session.connectionName,
  suspendedAt: session.suspendStartTime,
  ...(session.customSuspendName === undefined ? {} : { customName: session.customSuspendName }),
  status: session.backendSshStatus === 'hanging' ? 'active' : 'disconnected',
  ownershipState: session.ownershipState,
  ownershipGeneration: session.ownershipGeneration,
  ...(session.ownershipLeaseExpiresAt === undefined
    ? {}
    : { ownershipLeaseExpiresAt: session.ownershipLeaseExpiresAt }),
  ...(session.attachedWorkspaceId === undefined ? {} : { attachedWorkspaceId: session.attachedWorkspaceId }),
  ...(session.disconnectionTimestamp === undefined ? {} : { disconnectedAt: session.disconnectionTimestamp }),
});

export interface WorkspaceProtocolDependencies {
  workspace: WorkspaceService;
  events: WorkspaceEventHub;
  terminal: WorkspaceTerminalService;
  command: WorkspaceCommandService;
  shell: WorkspaceShellIntegrationService;
  filesystem: WorkspaceFilesystemService;
  operations: WorkspaceOperationsService;
  status: WorkspaceStatusMonitorService;
  docker: WorkspaceDockerService;
  suspendCoordinator: WorkspaceSuspendCoordinatorService;
  suspended: SshSuspendService;
}

export interface WorkspacePeerIdentity {
  userId: number;
  username: string;
  clientIp: string;
}

export interface WorkspaceProtocolCloseContext {
  source: 'socket.close' | 'socket.error';
  closeCode?: number;
  closeReason?: string;
  errorMessage?: string;
}

/** Clean Workspace WebSocket protocol over clean Module/Platform services. */
export class WorkspaceProtocolSession {
  private workspaceId?: string;
  private eventUnsubscribe?: () => void;
  private closed = false;
  private readonly terminalTransport: TerminalStreamTransport;
  private readonly consumerId = randomUUID();
  private ownershipRevokedReason?: string;
  private readonly autoTerminationUnsubscribe: () => void;
  private readonly ownershipRevokedUnsubscribe: () => void;

  constructor(
    private readonly socket: WebSocket,
    private readonly identity: WorkspacePeerIdentity,
    private readonly dependencies: WorkspaceProtocolDependencies,
  ) {
    this.terminalTransport = new TerminalStreamTransport(socket, dependencies.terminal);
    this.autoTerminationUnsubscribe = dependencies.suspended.onAutoTerminated((event) => {
      if (event.userId !== identity.userId) return;
      const payload: WorkspaceSuspendAutoTerminatedEventDto = {
        suspendedSessionId: event.suspendSessionId,
        reason: event.reason,
      };
      this.sendEvent('suspend.autoTerminated', payload);
    });
    this.ownershipRevokedUnsubscribe = dependencies.suspended.onOwnershipRevoked((event) => {
      if (event.userId !== identity.userId || event.ownerId !== this.consumerId) return;
      const reason =
        event.reason === 'takeover'
          ? 'Suspended session ownership was taken over by another device.'
          : 'Suspended session owner lease expired.';
      this.ownershipRevokedReason = reason;
      const payload: WorkspaceSuspendRevokedEventDto = {
        suspendedSessionId: event.suspendSessionId,
        generation: event.generation,
        reason: event.reason,
        message: reason,
      };
      this.sendEvent('suspend.revoked', payload);
      if (this.socket.readyState === WebSocket.OPEN) this.socket.close(4009, reason);
    });
  }

  async handleMessage(raw: RawData, isBinary: boolean): Promise<void> {
    if (this.closed || this.ownershipRevokedReason) return;
    if (isBinary) {
      logger.debug({ workspaceId: this.workspaceId }, 'Rejected binary Workspace protocol request');
      this.socket.close(
        1003,
        'Workspace socket accepts JSON control requests; binary frames are server-to-client only',
      );
      return;
    }
    const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    if (bytes.byteLength > MAX_JSON_MESSAGE_BYTES) {
      logger.debug(
        { workspaceId: this.workspaceId, messageBytes: bytes.byteLength },
        'Rejected oversized Workspace protocol request',
      );
      this.socket.close(1009, 'Workspace request too large');
      return;
    }

    let message: WorkspaceProtocolRequest;
    try {
      const parseStartedAt = runtimePerformanceMetrics.operationStarted();
      let parsed: unknown;
      try {
        parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      } finally {
        if (parseStartedAt !== 0n)
          runtimePerformanceMetrics.recordCpuTask(
            'websocket.json.parse',
            process.hrtime.bigint() - parseStartedAt,
            parseStartedAt,
          );
      }
      if (!isJsonRecord(parsed)) throw new Error('Invalid request');
      const type = stringValue(parsed.type);
      if (!type) throw new Error('Request type is required');
      const requestId = stringValue(parsed.requestId);
      if (parsed.requestId !== undefined && requestId === undefined) throw new Error('Invalid requestId');
      if (parsed.payload !== undefined && !isJsonRecord(parsed.payload)) throw new Error('Invalid request payload');
      message = {
        type,
        ...(requestId === undefined ? {} : { requestId }),
        ...(parsed.payload === undefined ? {} : { payload: parsed.payload }),
      };
      if (
        message.requestId !== undefined &&
        (!message.requestId || Buffer.byteLength(message.requestId, 'utf8') > MAX_WORKSPACE_BINARY_REQUEST_ID_BYTES)
      ) {
        throw new Error('Invalid requestId');
      }
    } catch (error) {
      logger.debug(
        { err: error, workspaceId: this.workspaceId, messageBytes: bytes.byteLength },
        'Invalid Workspace protocol request',
      );
      this.socket.close(1003, error instanceof Error ? error.message : 'Invalid request');
      return;
    }

    if (!HIGH_FREQUENCY_OPERATIONS.has(message.type)) {
      logger.trace(
        { operation: message.type, requestId: message.requestId, workspaceId: this.workspaceId },
        'Workspace request dispatch',
      );
    }
    try {
      const result = await this.route(message.type, record(message.payload), message.requestId);
      if (message.requestId) {
        if (result instanceof WorkspaceBinaryResponse) {
          await this.sendBinaryResponse(message.requestId, result.source);
          this.sendResponse(message.requestId, true, result.data);
        } else {
          this.sendResponse(message.requestId, true, result);
        }
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      logger.debug(
        { err: error, operation: message.type, requestId: message.requestId, workspaceId: this.workspaceId },
        'Workspace request failed',
      );
      if (message.requestId) this.sendResponse(message.requestId, false, undefined, text);
      else this.sendEvent('protocol.error', { operation: message.type, message: text });
    }
  }

  touchOwnership(): void {
    if (!this.workspaceId || this.closed || this.ownershipRevokedReason) return;
    try {
      this.dependencies.suspendCoordinator.renewOwnership(this.workspaceId, this.identity.userId, this.consumerId);
    } catch {
      // Ordinary Workspaces have no suspended-session owner. A stale/revoked owner is handled by
      // the authoritative revoke event/close path rather than turning heartbeat traffic into errors.
    }
  }

  async close(context?: WorkspaceProtocolCloseContext): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.autoTerminationUnsubscribe();
    this.ownershipRevokedUnsubscribe();
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = undefined;
    this.terminalTransport.dispose();
    const workspaceId = this.workspaceId;
    this.workspaceId = undefined;
    if (!workspaceId) return;

    const markedForSuspend = this.dependencies.suspendCoordinator.isMarked(workspaceId);
    const logContext = {
      workspaceId,
      userId: this.identity.userId,
      markedForSuspend,
      ...context,
    };
    if (markedForSuspend) logger.info(logContext, 'Marked Workspace protocol closing');
    else logger.debug(logContext, 'Workspace protocol closing');

    await this.dependencies.suspendCoordinator
      .closeWorkspace(workspaceId)
      .catch((error) =>
        logger.warn({ err: error, workspaceId, ...context }, 'Workspace cleanup after protocol close failed'),
      );
  }

  private async route(type: string, payload: JsonRecord, requestId?: string): Promise<unknown> {
    switch (type) {
      case 'workspace.connect':
        return this.connect(payload);
      case 'terminal.input':
        return this.terminalInput(payload);
      case 'terminal.resize':
        return this.terminalResize(payload);
      case 'terminal.currentDirectory': {
        const response: WorkspaceTerminalCurrentDirectoryResponseDto =
          await this.dependencies.command.readCurrentDirectory(this.requireWorkspace(), this.identity.userId);
        return response;
      }
      case 'terminal.changeDirectory':
        return this.changeDirectory(payload, requestId);
      case 'filesystem.list':
        return this.filesystemList(payload);
      case 'filesystem.search':
        return this.filesystemSearch(payload);
      case 'filesystem.stat':
        return this.filesystemStat(payload);
      case 'filesystem.readText':
        return this.filesystemReadText(payload);
      case 'filesystem.readBinary':
        return this.filesystemReadBinary(payload);
      case 'filesystem.writeText':
        return this.filesystemWriteText(payload);
      case 'filesystem.createDirectory':
        return this.filesystemCreateDirectory(payload);
      case 'filesystem.createFile':
        return this.filesystemCreateFile(payload);
      case 'filesystem.remove':
        return this.filesystemRemove(payload);
      case 'filesystem.rename':
        return this.filesystemRename(payload);
      case 'filesystem.chmod':
        return this.filesystemChmod(payload);
      case 'filesystem.realpath':
        return this.filesystemRealpath(payload);
      case 'transfer.copyMove':
        return this.copyMove(payload, requestId);
      case 'transfer.cancel':
        return this.cancelTransfer(payload);
      case 'transfer.compress':
        return this.compress(payload, requestId);
      case 'transfer.decompress':
        return this.decompress(payload, requestId);
      case 'transfer.cancelArchive':
        return this.cancelArchive(payload);
      case 'upload.prepare':
        return this.uploadPrepare(payload);
      case 'upload.start':
        return this.uploadStart(payload);
      case 'upload.cancel':
        return this.uploadCancel(payload);
      case 'upload.abort':
        return this.uploadAbort(payload);
      case 'status.start':
        await this.dependencies.status.start(this.requireWorkspace());
        return null;
      case 'status.stop':
        this.dependencies.status.stop(this.requireWorkspace());
        return null;
      case 'docker.status':
        return dockerStatusWire(await this.dependencies.docker.getStatus(this.requireWorkspace()));
      case 'docker.command':
        return this.dockerCommand(payload);
      case 'docker.stats':
        return this.dockerStats(payload);
      case 'suspend.mark':
        return this.suspendMark(payload);
      case 'suspend.unmark':
        return this.suspendUnmark();
      case 'suspend.list': {
        const result: WorkspaceSuspendListResponseDto = this.dependencies.suspended
          .list(this.identity.userId)
          .map(suspendedSessionDto);
        return result;
      }
      case 'suspend.resume':
        return this.resume(payload);
      case 'suspend.owner.renew':
        return this.suspendOwnerRenew();
      case 'suspend.history.previous':
        return this.suspendHistoryPrevious();
      case 'suspend.history.reset':
        return this.suspendHistoryReset();
      case 'suspend.terminate':
        return this.suspendTerminate(payload);
      case 'suspend.remove':
        return this.suspendRemove(payload);
      case 'suspend.rename':
        return this.suspendRename(payload);
      default:
        throw new Error(`Unsupported Workspace operation: ${type}`);
    }
  }

  private async connect(payload: JsonRecord): Promise<WorkspaceConnectResponseDto> {
    if (this.workspaceId) throw new Error('Workspace socket is already bound.');
    const workspaceId = this.requireWorkspaceId(payload.workspaceId);
    const connectionId = numberValue(payload.connectionId);
    if (!Number.isInteger(connectionId) || connectionId! <= 0)
      throw new Error('connectionId must be a positive integer.');
    if (!this.dependencies.workspace.canCreate(workspaceId))
      throw new Error(`Workspace ${workspaceId} already exists.`);
    if (payload.viewport !== undefined && !isJsonRecord(payload.viewport)) throw new Error('Invalid Workspace viewport.');
    const viewport = record(payload.viewport);
    const columns = numberValue(viewport.columns);
    const rows = numberValue(viewport.rows);
    const request: WorkspaceConnectRequestDto = {
      workspaceId,
      connectionId: connectionId!,
      ...(columns !== undefined && rows !== undefined ? { viewport: { columns, rows } } : {}),
    };

    this.bindWorkspace(workspaceId);
    try {
      const session = await this.dependencies.workspace.connect({
        workspaceId: request.workspaceId,
        userId: this.identity.userId,
        connectionId: request.connectionId,
        ...(request.viewport ? { columns: request.viewport.columns, rows: request.viewport.rows } : {}),
        actorUsername: this.identity.username,
        clientIp: this.identity.clientIp,
      });
      this.dependencies.terminal.attach(workspaceId, {
        columns: request.viewport?.columns ?? 80,
        rows: request.viewport?.rows ?? 24,
      });
      void this.dependencies.filesystem.initialize(workspaceId).catch(() => undefined);
      const response: WorkspaceConnectResponseDto = {
        workspaceId,
        connectionId: session.connectionId,
        connectionName: session.connectionName,
        binaryProtocolVersion: WORKSPACE_BINARY_PROTOCOL_VERSION,
        lastConnectedAt: session.lastConnectedAt,
      };
      return response;
    } catch (error) {
      this.unbindWorkspace();
      throw error;
    }
  }

  private terminalInput(payload: JsonRecord): null {
    const data = stringValue(payload.data);
    if (data === undefined) throw new Error('Terminal input must include data.');
    const request: WorkspaceTerminalInputRequestDto = { data };
    this.dependencies.terminal.writeInput(this.requireWorkspace(), request.data);
    return null;
  }

  private terminalResize(payload: JsonRecord): null {
    const columns = numberValue(payload.columns);
    const rows = numberValue(payload.rows);
    if (columns === undefined || rows === undefined) throw new Error('Terminal viewport is required.');
    const request: WorkspaceTerminalResizeRequestDto = { columns, rows };
    this.dependencies.terminal.resize(this.requireWorkspace(), request.columns, request.rows);
    return null;
  }

  private async changeDirectory(
    payload: JsonRecord,
    requestId?: string,
  ): Promise<WorkspaceTerminalChangeDirectoryResponseDto> {
    const id = this.requireRequestId(requestId);
    const request: WorkspaceTerminalChangeDirectoryRequestDto = { path: this.requirePath(payload.path) };
    await this.dependencies.shell.requestDirectoryChange(this.requireWorkspace(), id, request.path);
    return { queued: true };
  }

  private async filesystemList(payload: JsonRecord): Promise<WorkspaceFilesystemListResponseDto> {
    const request: WorkspaceFilesystemPathRequestDto = { path: this.requirePath(payload.path) };
    return {
      path: request.path,
      entries: (await this.dependencies.filesystem.readDirectory(this.requireWorkspace(), request.path)).map(
        remoteFileEntryDto,
      ),
    };
  }

  private async filesystemSearch(payload: JsonRecord): Promise<WorkspaceFilesystemSearchResponseDto> {
    const path = this.requirePath(payload.path);
    const query = stringValue(payload.query);
    if (query === undefined) throw new Error('Filesystem search query is required.');
    const request: WorkspaceFilesystemSearchRequestDto = { path, query };
    const result = await this.dependencies.filesystem.search(this.requireWorkspace(), request.path, request.query);
    return { entries: result.items.map(fileSearchEntryDto), truncated: result.truncated };
  }

  private async filesystemStat(payload: JsonRecord): Promise<WorkspaceRemoteFileEntryDto> {
    const request: WorkspaceFilesystemPathRequestDto = { path: this.requirePath(payload.path) };
    return remoteFileEntryDto(await this.dependencies.filesystem.stat(this.requireWorkspace(), request.path));
  }

  private async filesystemReadText(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const encoding = stringValue(payload.encoding);
    if (payload.encoding !== undefined && encoding === undefined) throw new Error('Filesystem encoding must be a string.');
    const request: WorkspaceFilesystemReadTextRequestDto = {
      path,
      ...(encoding === undefined ? {} : { encoding }),
    };
    const result = await this.dependencies.filesystem.readFile(
      this.requireWorkspace(),
      request.path,
      request.encoding,
    );
    const response: WorkspaceFilesystemReadTextResponseDto = {
      path: request.path,
      content: result.content,
      encoding: result.encodingUsed,
    };
    return new WorkspaceBinaryResponse(
      response,
      singleBinaryChunk(result.rawContent),
    );
  }

  private async filesystemReadBinary(payload: JsonRecord) {
    const request: WorkspaceFilesystemPathRequestDto = { path: this.requirePath(payload.path) };
    const stream = await this.dependencies.filesystem.openBinaryRead(this.requireWorkspace(), request.path);
    const response: WorkspaceFilesystemReadBinaryResponseDto = { path: request.path };
    return new WorkspaceBinaryResponse(response, stream);
  }

  private async filesystemWriteText(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const content = stringValue(payload.content);
    if (content === undefined) throw new Error('File content must be a string.');
    const encoding = stringValue(payload.encoding);
    if (payload.encoding !== undefined && encoding === undefined) throw new Error('Filesystem encoding must be a string.');
    const request: WorkspaceFilesystemWriteTextRequestDto = {
      path,
      content,
      ...(encoding === undefined ? {} : { encoding }),
    };
    await this.dependencies.filesystem.writeFile(
      this.requireWorkspace(),
      request.path,
      request.content,
      request.encoding ?? 'utf-8',
    );
    return null;
  }

  private async filesystemCreateDirectory(payload: JsonRecord) {
    const request: WorkspaceFilesystemPathRequestDto = { path: this.requirePath(payload.path) };
    await this.dependencies.filesystem.createDirectory(this.requireWorkspace(), request.path);
    return null;
  }

  private async filesystemCreateFile(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const content = stringValue(payload.content);
    const encoding = stringValue(payload.encoding);
    if (payload.content !== undefined && content === undefined) throw new Error('File content must be a string.');
    if (payload.encoding !== undefined && encoding === undefined) throw new Error('Filesystem encoding must be a string.');
    const request: WorkspaceFilesystemCreateFileRequestDto = {
      path,
      ...(content === undefined ? {} : { content }),
      ...(encoding === undefined ? {} : { encoding }),
    };
    await this.dependencies.filesystem.createFile(
      this.requireWorkspace(),
      request.path,
      request.content ?? '',
      request.encoding ?? 'utf-8',
    );
    return null;
  }

  private async filesystemRemove(payload: JsonRecord) {
    const paths = stringArray(payload.paths);
    if (!paths) throw new Error('Filesystem remove paths must be an array of strings.');
    const forceDirectoryPaths =
      payload.forceDirectoryPaths === undefined ? [] : stringArray(payload.forceDirectoryPaths);
    if (!forceDirectoryPaths) throw new Error('Filesystem forced directory paths must be an array of strings.');
    const request: WorkspaceFilesystemRemoveRequestDto = {
      paths,
      ...(forceDirectoryPaths.length ? { forceDirectoryPaths } : {}),
    };
    await this.dependencies.filesystem.removePaths(this.requireWorkspace(), request.paths, {
      forceDirectoryPaths: request.forceDirectoryPaths ?? [],
    });
    return null;
  }

  private async filesystemChmod(payload: JsonRecord) {
    const mode = numberValue(payload.mode);
    if (mode === undefined) throw new Error('chmod mode is required.');
    const request: WorkspaceFilesystemChmodRequestDto = { path: this.requirePath(payload.path), mode };
    await this.dependencies.filesystem.chmod(this.requireWorkspace(), request.path, request.mode);
    return null;
  }

  private async filesystemRename(payload: JsonRecord) {
    const request: WorkspaceFilesystemRenameRequestDto = {
      from: this.requirePath(payload.from),
      to: this.requirePath(payload.to),
    };
    await this.dependencies.filesystem.rename(this.requireWorkspace(), request.from, request.to);
    return null;
  }

  private async filesystemRealpath(payload: JsonRecord): Promise<WorkspaceFilesystemRealpathResponseDto> {
    const request: WorkspaceFilesystemPathRequestDto = { path: this.requirePath(payload.path) };
    const result = await this.dependencies.filesystem.realpath(this.requireWorkspace(), request.path);
    return {
      requestedPath: result.requestedPath,
      absolutePath: result.absolutePath,
      targetType: result.targetType,
    };
  }

  private copyMove(payload: JsonRecord, requestId?: string): WorkspaceOperationStartedResponseDto {
    const id = this.requireRequestId(requestId);
    const mode = stringValue(payload.mode);
    const sources = stringArray(payload.sources);
    const destination = stringValue(payload.destination);
    const sourceWorkspaceId = stringValue(payload.sourceWorkspaceId);
    if (payload.sourceWorkspaceId !== undefined && sourceWorkspaceId === undefined)
      throw new Error('Invalid source Workspace id.');
    if ((mode !== 'copy' && mode !== 'move') || !sources || !destination) throw new Error('Invalid transfer request.');
    const request: WorkspaceCopyMoveRequestDto = {
      mode,
      sources,
      destination,
      ...(sourceWorkspaceId === undefined ? {} : { sourceWorkspaceId }),
    };
    this.dependencies.operations.startTransfer(
      this.requireWorkspace(),
      request.sourceWorkspaceId ?? this.requireWorkspace(),
      request.sources,
      request.destination,
      id,
      request.mode,
    );
    return { started: true };
  }

  private cancelTransfer(payload: JsonRecord): Promise<boolean> {
    const taskId = stringValue(payload.taskId);
    if (!taskId) throw new Error('taskId is required.');
    const request: WorkspaceTaskCancelRequestDto = { taskId };
    return this.dependencies.operations.cancelTransfer(this.requireWorkspace(), request.taskId);
  }

  private compress(payload: JsonRecord, requestId?: string): WorkspaceOperationStartedResponseDto {
    const format = stringValue(payload.format);
    const sources = stringArray(payload.sources);
    const destination = stringValue(payload.destination);
    if (!sources || !destination || !format || !['zip', 'tar.gz', 'tar.bz2'].includes(format)) {
      throw new Error('Invalid archive compression request.');
    }
    if (payload.password !== undefined && typeof payload.password !== 'string')
      throw new Error('Archive password must be a string.');
    const request: WorkspaceArchiveCompressRequestDto = {
      sources,
      destination,
      format: format as WorkspaceArchiveCompressRequestDto['format'],
      ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
    };
    const archiveFormat: ArchiveFormat =
      request.format === 'tar.gz' ? 'targz' : request.format === 'tar.bz2' ? 'tarbz2' : 'zip';
    this.dependencies.operations.startCompress(this.requireWorkspace(), {
      requestId: this.requireRequestId(requestId),
      sourcePaths: request.sources,
      destinationPath: request.destination,
      format: archiveFormat,
      ...(request.password === undefined ? {} : { password: request.password }),
    });
    return { started: true };
  }

  private decompress(payload: JsonRecord, requestId?: string): WorkspaceOperationStartedResponseDto {
    const source = stringValue(payload.source);
    if (!source) throw new Error('Archive source is required.');
    if (payload.password !== undefined && typeof payload.password !== 'string')
      throw new Error('Archive password must be a string.');
    const request: WorkspaceArchiveDecompressRequestDto = {
      source,
      ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
    };
    this.dependencies.operations.startDecompress(this.requireWorkspace(), {
      requestId: this.requireRequestId(requestId),
      archivePath: request.source,
      ...(request.password === undefined ? {} : { password: request.password }),
    });
    return { started: true };
  }

  private cancelArchive(payload: JsonRecord): Promise<boolean> {
    const taskId = stringValue(payload.taskId);
    if (!taskId) throw new Error('taskId is required.');
    const request: WorkspaceTaskCancelRequestDto = { taskId };
    return this.dependencies.operations.cancelArchive(this.requireWorkspace(), request.taskId);
  }

  private uploadPrepare(payload: JsonRecord): Promise<WorkspaceUploadPrepareResponseDto> {
    const prepareId = stringValue(payload.prepareId);
    const basePath = stringValue(payload.basePath);
    const directories = stringArray(payload.directories);
    if (!prepareId || !basePath || !directories) throw new Error('Invalid upload preparation request.');
    const request: WorkspaceUploadPrepareRequestDto = { prepareId, basePath, directories };
    return this.dependencies.operations.prepareUpload(
      this.requireWorkspace(),
      request.prepareId,
      request.basePath,
      request.directories,
    );
  }

  private async uploadStart(payload: JsonRecord): Promise<WorkspaceOperationStartedResponseDto> {
    const uploadId = stringValue(payload.uploadId);
    const destinationPath = stringValue(payload.destinationPath);
    const size = numberValue(payload.size);
    const conflictPolicy = stringValue(payload.conflictPolicy) ?? 'ask';
    if (!uploadId || !destinationPath || size === undefined || !['ask', 'overwrite', 'skip'].includes(conflictPolicy)) {
      throw new Error('Invalid upload start request.');
    }
    const relativePath = stringValue(payload.relativePath);
    const prepareId = stringValue(payload.prepareId);
    if (payload.relativePath !== undefined && relativePath === undefined) throw new Error('Invalid upload relative path.');
    if (payload.prepareId !== undefined && prepareId === undefined) throw new Error('Invalid upload prepare id.');
    const request: WorkspaceUploadStartRequestDto = {
      uploadId,
      destinationPath,
      size,
      ...(relativePath === undefined ? {} : { relativePath }),
      ...(prepareId === undefined ? {} : { prepareId }),
      conflictPolicy: conflictPolicy as WorkspaceUploadConflictPolicyDto,
    };
    await this.dependencies.operations.startUpload(
      this.requireWorkspace(),
      request.uploadId,
      request.destinationPath,
      request.size,
      {
      ...(request.relativePath === undefined ? {} : { relativePath: request.relativePath }),
      ...(request.prepareId === undefined ? {} : { prepareId: request.prepareId }),
      conflictPolicy: request.conflictPolicy,
    });
    return { started: true };
  }

  private uploadCancel(payload: JsonRecord): Promise<boolean> {
    const uploadId = stringValue(payload.uploadId);
    if (!uploadId) throw new Error('uploadId is required.');
    const request: WorkspaceUploadSessionRequestDto = { uploadId };
    return this.dependencies.operations.cancelUpload(this.requireWorkspace(), request.uploadId);
  }

  private uploadAbort(payload: JsonRecord): Promise<boolean> {
    const uploadId = stringValue(payload.uploadId);
    const message = stringValue(payload.message);
    if (!uploadId || !message) throw new Error('uploadId and message are required.');
    const request: WorkspaceUploadAbortRequestDto = { uploadId, message };
    return this.dependencies.operations.abortUpload(this.requireWorkspace(), request.uploadId, request.message);
  }

  private async dockerCommand(payload: JsonRecord) {
    const containerId = stringValue(payload.containerId);
    const command = stringValue(payload.command) as WorkspaceDockerCommandDto | undefined;
    if (!containerId || !command || !['start', 'stop', 'restart', 'remove'].includes(command)) {
      throw new Error('Invalid Docker command.');
    }
    const request: WorkspaceDockerCommandRequestDto = { containerId, command };
    await this.dependencies.docker.command(this.requireWorkspace(), request.containerId, request.command);
    return null;
  }

  private async dockerStats(payload: JsonRecord): Promise<WorkspaceDockerStatsDto | null> {
    const containerId = stringValue(payload.containerId);
    if (!containerId) throw new Error('containerId is required.');
    const request: WorkspaceDockerStatsRequestDto = { containerId };
    const stats = await this.dependencies.docker.getStats(this.requireWorkspace(), request.containerId);
    return stats ? dockerStatsWire(stats) : null;
  }

  private async suspendMark(payload: JsonRecord): Promise<WorkspaceSuspendMarkResponseDto> {
    const workspaceId = this.requireWorkspace();
    const terminalSnapshot = stringValue(payload.terminalSnapshot);
    if (payload.terminalSnapshot !== undefined && terminalSnapshot === undefined) {
      throw new Error('terminalSnapshot must be a string.');
    }
    const request: WorkspaceSuspendMarkRequestDto =
      terminalSnapshot === undefined ? {} : { terminalSnapshot };
    const result = await this.dependencies.suspendCoordinator.suspendNow(
      workspaceId,
      this.identity.userId,
      request.terminalSnapshot,
    );
    this.unbindWorkspace();
    return { suspendedSessionId: result.suspendSessionId };
  }

  private async suspendUnmark() {
    await this.dependencies.suspendCoordinator.unmarkForSuspend(this.requireWorkspace(), this.identity.userId);
    return null;
  }

  private async resume(payload: JsonRecord): Promise<WorkspaceSuspendResumeResponseDto> {
    if (this.workspaceId) throw new Error('Workspace socket is already bound.');
    const suspendedSessionId = stringValue(payload.suspendedSessionId);
    const workspaceId = this.requireWorkspaceId(payload.workspaceId);
    if (payload.viewport !== undefined && !isJsonRecord(payload.viewport)) throw new Error('Invalid resume viewport.');
    const requestedViewport = record(payload.viewport);
    const columns = numberValue(requestedViewport.columns);
    const rows = numberValue(requestedViewport.rows);
    const viewport =
      columns !== undefined && rows !== undefined
        ? { columns: Math.floor(columns), rows: Math.floor(rows) }
        : undefined;
    if (payload.takeover !== undefined && typeof payload.takeover !== 'boolean') {
      throw new Error('Invalid resume takeover flag.');
    }
    if (
      !suspendedSessionId ||
      !this.dependencies.workspace.canCreate(workspaceId) ||
      (viewport && (viewport.columns < 2 || viewport.columns > 1000 || viewport.rows < 1 || viewport.rows > 500))
    ) {
      throw new Error('Invalid resume request.');
    }
    const request: WorkspaceSuspendResumeRequestDto = {
      suspendedSessionId,
      workspaceId,
      ...(viewport ? { viewport } : {}),
      ...(payload.takeover === true ? { takeover: true } : {}),
    };
    this.bindWorkspace(workspaceId);
    let began = false;
    try {
      const result = await this.dependencies.suspendCoordinator.beginResume(
        this.identity.userId,
        request.suspendedSessionId,
        request.workspaceId,
        request.viewport,
        { ownerId: this.consumerId, takeover: request.takeover === true },
      );
      began = true;
      if (this.closed) throw new Error('Workspace socket closed during suspended-session resume.');
      await this.terminalTransport.sendStream(result.logStream, (chunk) =>
        this.dependencies.shell.filterOutput(result.workspaceId, chunk),
      );
      if (this.closed) throw new Error('Workspace socket closed during suspended-session resume.');
      await this.dependencies.suspendCoordinator.commitResume(workspaceId);
      const response: WorkspaceSuspendResumeResponseDto = {
        workspaceId,
        connectionId: result.connectionId,
        connectionName: result.connectionName,
        resumedFrom: suspendedSessionId,
        historyAvailable: result.historyAvailable,
        ownershipGeneration: result.ownershipGeneration,
        ownershipLeaseExpiresAt: result.ownershipLeaseExpiresAt,
        binaryProtocolVersion: WORKSPACE_BINARY_PROTOCOL_VERSION,
      };
      return response;
    } catch (error) {
      if (began) await this.dependencies.suspendCoordinator.rollbackResume(workspaceId).catch(() => false);
      this.unbindWorkspace();
      throw error;
    }
  }

  private suspendOwnerRenew(): WorkspaceSuspendOwnerRenewResponseDto {
    const response: WorkspaceSuspendOwnerRenewResponseDto = this.dependencies.suspendCoordinator.renewOwnership(
      this.requireWorkspace(),
      this.identity.userId,
      this.consumerId,
    );
    return response;
  }

  private async suspendHistoryPrevious() {
    const history = await this.dependencies.suspendCoordinator.loadPreviousHistory(
      this.requireWorkspace(),
      this.identity.userId,
    );
    const response: WorkspaceSuspendHistoryPreviousResponseDto = { hasMore: history.hasMore };
    return new WorkspaceBinaryResponse(response, singleBinaryChunk(history.data));
  }

  private suspendHistoryReset(): WorkspaceSuspendHistoryResetResponseDto {
    const response: WorkspaceSuspendHistoryResetResponseDto = {
      available: this.dependencies.suspendCoordinator.resetPreviousHistory(
        this.requireWorkspace(),
        this.identity.userId,
      ),
    };
    return response;
  }

  private async suspendTerminate(payload: JsonRecord) {
    const id = stringValue(payload.suspendedSessionId);
    if (!id) throw new Error('Suspended session was not found.');
    const request: WorkspaceSuspendSessionRequestDto = { suspendedSessionId: id };
    if (!(await this.dependencies.suspended.terminate(this.identity.userId, request.suspendedSessionId))) {
      throw new Error('Suspended session was not found.');
    }
    return null;
  }

  private async suspendRemove(payload: JsonRecord) {
    const id = stringValue(payload.suspendedSessionId);
    if (!id) throw new Error('Disconnected suspended session was not found.');
    const request: WorkspaceSuspendSessionRequestDto = { suspendedSessionId: id };
    if (!(await this.dependencies.suspended.removeDisconnected(this.identity.userId, request.suspendedSessionId))) {
      throw new Error('Disconnected suspended session was not found.');
    }
    return null;
  }

  private suspendRename(payload: JsonRecord) {
    const id = stringValue(payload.suspendedSessionId);
    const name = stringValue(payload.name);
    if (!id || name === undefined) throw new Error('Suspended session was not found.');
    const request: WorkspaceSuspendRenameRequestDto = { suspendedSessionId: id, name };
    if (
      !this.dependencies.suspended.rename(
        this.identity.userId,
        request.suspendedSessionId,
        request.name,
      )
    ) {
      throw new Error('Suspended session was not found.');
    }
    return null;
  }

  private bindWorkspace(workspaceId: string): void {
    this.workspaceId = workspaceId;
    this.terminalTransport.bind(workspaceId);
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = this.dependencies.events.subscribe(workspaceId, (event) => this.forwardEvent(event));
  }

  private unbindWorkspace(): void {
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = undefined;
    this.terminalTransport.unbind();
    this.workspaceId = undefined;
  }

  private forwardEvent(event: WorkspaceEvent): void {
    switch (event.type) {
      case 'terminal-output':
        this.terminalTransport.enqueue(event.data);
        return;
      case 'terminal-input-ack':
      case 'terminal-resize':
        return;
      case 'terminal-closed':
        this.sendEvent('terminal.closed', {});
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1012, 'Terminal closed');
        return;
      case 'terminal-error':
        this.sendEvent('terminal.error', { message: event.message });
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1011, 'Terminal error');
        return;
      case 'directory-change-queued':
        this.sendEvent('terminal.directoryChangeQueued', {
          requestId: event.requestId,
          path: event.path,
          waitingForPrompt: event.waitingForPrompt,
        });
        return;
      case 'directory-change-result':
        this.sendEvent('terminal.directoryChanged', { requestId: event.requestId, path: event.path });
        return;
      case 'directory-change-error':
        this.sendEvent('terminal.directoryChangeFailed', { requestId: event.requestId, message: event.message });
        return;
      case 'status-update':
        this.sendEvent('status.sample', event.status);
        return;
      case 'status-error':
        this.sendEvent('status.error', { message: event.message });
        return;
      case 'filesystem-ready':
        this.sendEvent('filesystem.ready', {});
        return;
      case 'filesystem-error':
        this.sendEvent('filesystem.error', { message: event.message });
        return;
      case 'upload-event':
        this.sendEvent('transfer.upload', uploadEventDto(event.event));
        return;
      case 'transfer-event':
        this.sendEvent('transfer.copyMove', copyMoveEventDto(event.event));
        return;
      case 'archive-event':
        this.sendEvent('transfer.archive', archiveEventDto(event.event));
        return;
    }
  }

  private sendResponse(requestId: string, ok: boolean, data?: unknown, error?: string): void {
    const response: WorkspaceProtocolResponseDto = {
      type: 'response',
      requestId,
      payload: { ok, ...(data !== undefined ? { data } : {}), ...(error ? { error } : {}) },
    };
    this.sendJson(response);
  }

  private sendEvent<K extends keyof WorkspaceEventMapDto>(
    type: K,
    payload: WorkspaceEventMapDto[K],
  ): void;
  private sendEvent(type: string, payload: unknown): void;
  private sendEvent(type: string, payload: unknown): void {
    this.sendJson({ type, payload });
  }

  private async sendBinaryResponse(
    requestId: string,
    source: AsyncIterable<Uint8Array | Buffer | string>,
  ): Promise<void> {
    for await (const raw of source) {
      const value = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      for (let offset = 0; offset < value.byteLength; offset += MAX_WORKSPACE_BINARY_PAYLOAD_BYTES) {
        await this.waitForBinaryCapacity();
        const chunk = value.subarray(offset, Math.min(offset + MAX_WORKSPACE_BINARY_PAYLOAD_BYTES, value.byteLength));
        if (this.socket.readyState !== WebSocket.OPEN)
          throw new Error('Workspace socket closed during binary response.');
        this.socket.send(encodeWorkspaceBinaryFrame('response', requestId, chunk), { binary: true });
      }
    }
    await this.waitForBinaryCapacity();
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Workspace socket closed during binary response.');
    this.socket.send(encodeWorkspaceBinaryFrame('response', requestId, Buffer.alloc(0), true), { binary: true });
  }

  private async waitForBinaryCapacity(): Promise<void> {
    while (this.socket.readyState === WebSocket.OPEN && this.socket.bufferedAmount >= BINARY_HIGH_WATER_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, BINARY_BACKPRESSURE_POLL_MS));
    }
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('Workspace socket is not open.');
  }

  private sendJson(message: unknown): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    const stringifyStartedAt = runtimePerformanceMetrics.operationStarted();
    let payload: string;
    try {
      payload = JSON.stringify(message);
    } finally {
      if (stringifyStartedAt !== 0n)
        runtimePerformanceMetrics.recordCpuTask(
          'websocket.json.stringify',
          process.hrtime.bigint() - stringifyStartedAt,
          stringifyStartedAt,
        );
    }
    runtimePerformanceMetrics.recordWebSocketOutbound(Buffer.byteLength(payload, 'utf8'));
    this.socket.send(payload);
  }

  private requireWorkspace(): string {
    if (!this.workspaceId) throw new Error('Workspace socket is not connected.');
    return this.workspaceId;
  }

  private requireWorkspaceId(value: unknown): string {
    const id = stringValue(value)?.trim() ?? '';
    if (!WORKSPACE_ID_PATTERN.test(id)) throw new Error('workspaceId is invalid.');
    return id;
  }

  private requireRequestId(value?: string): string {
    if (!value) throw new Error('requestId is required for this operation.');
    return value;
  }

  private requirePath(value: unknown): string {
    const path = stringValue(value);
    if (!path || !path.startsWith('/')) throw new Error('An absolute remote path is required.');
    return path;
  }
}
