import { StringDecoder } from 'node:string_decoder';
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
import type {
  DockerCommand,
  DockerStats as PlatformDockerStats,
  DockerStatus as PlatformDockerStatus,
} from '../../platform/docker/docker.port';
import type { ArchiveFormat } from '../../platform/operations/archive/archive-operation.port';
import { TerminalStreamTransport } from './terminal-stream.transport';
import type { WorkspaceProtocolRequest } from './workspace-protocol.types';

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_JSON_MESSAGE_BYTES = 1024 * 1024;

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
const stringValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

const dockerStatsWire = (stats: PlatformDockerStats) => ({
  id: stats.ID,
  name: stats.Name,
  cpuPercent: stats.CPUPerc,
  memoryUsage: stats.MemUsage,
  memoryPercent: stats.MemPerc,
  networkIo: stats.NetIO,
  blockIo: stats.BlockIO,
  pids: stats.PIDs,
});

const dockerStatusWire = (status: PlatformDockerStatus) => ({
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

/** Clean Workspace WebSocket protocol over clean Module/Platform services. */
export class WorkspaceProtocolSession {
  private workspaceId?: string;
  private eventUnsubscribe?: () => void;
  private closed = false;
  private readonly terminalTransport: TerminalStreamTransport;
  private readonly autoTerminationUnsubscribe: () => void;

  constructor(
    private readonly socket: WebSocket,
    private readonly identity: WorkspacePeerIdentity,
    private readonly dependencies: WorkspaceProtocolDependencies,
  ) {
    this.terminalTransport = new TerminalStreamTransport(socket, dependencies.terminal);
    this.autoTerminationUnsubscribe = dependencies.suspended.onAutoTerminated((event) => {
      if (event.userId !== identity.userId) return;
      this.sendEvent('suspend.autoTerminated', {
        suspendedSessionId: event.suspendSessionId,
        reason: event.reason,
      });
    });
  }

  async handleMessage(raw: RawData, isBinary: boolean): Promise<void> {
    if (this.closed) return;
    if (isBinary) {
      this.socket.close(
        1003,
        'Workspace socket accepts JSON requests; terminal output is server-to-client binary only',
      );
      return;
    }
    const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    if (bytes.byteLength > MAX_JSON_MESSAGE_BYTES) {
      this.socket.close(1009, 'Workspace request too large');
      return;
    }

    let message: WorkspaceProtocolRequest;
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid request');
      message = parsed as WorkspaceProtocolRequest;
      if (typeof message.type !== 'string' || !message.type) throw new Error('Request type is required');
    } catch (error) {
      this.socket.close(1003, error instanceof Error ? error.message : 'Invalid request');
      return;
    }

    try {
      const result = await this.route(message.type, record(message.payload), message.requestId);
      if (message.requestId) this.sendResponse(message.requestId, true, result);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      if (message.requestId) this.sendResponse(message.requestId, false, undefined, text);
      else this.sendEvent('protocol.error', { operation: message.type, message: text });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.autoTerminationUnsubscribe();
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = undefined;
    this.terminalTransport.dispose();
    const workspaceId = this.workspaceId;
    this.workspaceId = undefined;
    if (workspaceId)
      await this.dependencies.suspendCoordinator.handleClientDisconnect(workspaceId).catch(() => undefined);
  }

  private async route(type: string, payload: JsonRecord, requestId?: string): Promise<unknown> {
    switch (type) {
      case 'workspace.connect':
        return this.connect(payload);
      case 'terminal.input':
        return this.terminalInput(payload);
      case 'terminal.resize':
        return this.terminalResize(payload);
      case 'terminal.currentDirectory':
        return this.dependencies.command.readCurrentDirectory(this.requireWorkspace(), this.identity.userId);
      case 'terminal.changeDirectory':
        return this.changeDirectory(payload, requestId);
      case 'filesystem.list':
        return this.filesystemList(payload);
      case 'filesystem.search':
        return this.filesystemSearch(payload);
      case 'filesystem.stat':
        return this.dependencies.filesystem.stat(this.requireWorkspace(), this.requirePath(payload.path));
      case 'filesystem.readText':
        return this.filesystemReadText(payload);
      case 'filesystem.readBinary':
        return this.filesystemReadBinary(payload);
      case 'filesystem.writeText':
        return this.filesystemWriteText(payload);
      case 'filesystem.createDirectory':
        await this.dependencies.filesystem.createDirectory(this.requireWorkspace(), this.requirePath(payload.path));
        return null;
      case 'filesystem.createFile':
        await this.dependencies.filesystem.writeFile(
          this.requireWorkspace(),
          this.requirePath(payload.path),
          stringValue(payload.content) ?? '',
          stringValue(payload.encoding) ?? 'utf-8',
        );
        return null;
      case 'filesystem.remove':
        return this.filesystemRemove(payload);
      case 'filesystem.rename':
        await this.dependencies.filesystem.rename(
          this.requireWorkspace(),
          this.requirePath(payload.from),
          this.requirePath(payload.to),
        );
        return null;
      case 'filesystem.chmod':
        return this.filesystemChmod(payload);
      case 'filesystem.realpath':
        return this.dependencies.filesystem.realpath(this.requireWorkspace(), this.requirePath(payload.path));
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
      case 'suspend.list':
        return this.dependencies.suspended.list(this.identity.userId).map((session) => ({
          id: session.suspendSessionId,
          originalWorkspaceId: session.originalSessionId,
          connectionId: Number(session.connectionId),
          connectionName: session.connectionName,
          suspendedAt: session.suspendStartTime,
          customName: session.customSuspendName,
          status: session.backendSshStatus === 'hanging' ? 'active' : 'disconnected',
          disconnectedAt: session.disconnectionTimestamp,
        }));
      case 'suspend.resume':
        return this.resume(payload);
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

  private async connect(payload: JsonRecord) {
    if (this.workspaceId) throw new Error('Workspace socket is already bound.');
    const workspaceId = this.requireWorkspaceId(payload.workspaceId);
    const connectionId = numberValue(payload.connectionId);
    if (!Number.isInteger(connectionId) || connectionId! <= 0)
      throw new Error('connectionId must be a positive integer.');
    if (!this.dependencies.workspace.canCreate(workspaceId))
      throw new Error(`Workspace ${workspaceId} already exists.`);
    const viewport = record(payload.viewport);
    const columns = numberValue(viewport.columns);
    const rows = numberValue(viewport.rows);

    this.bindWorkspace(workspaceId);
    try {
      const session = await this.dependencies.workspace.connect({
        workspaceId,
        userId: this.identity.userId,
        connectionId: connectionId!,
        ...(columns !== undefined ? { columns } : {}),
        ...(rows !== undefined ? { rows } : {}),
        actorUsername: this.identity.username,
        clientIp: this.identity.clientIp,
      });
      this.dependencies.terminal.attach(workspaceId);
      void this.dependencies.filesystem.initialize(workspaceId).catch(() => undefined);
      return { workspaceId, connectionId: session.connectionId, connectionName: session.connectionName };
    } catch (error) {
      this.unbindWorkspace();
      throw error;
    }
  }

  private terminalInput(payload: JsonRecord): null {
    const data = stringValue(payload.data);
    if (data === undefined) throw new Error('Terminal input must include data.');
    this.dependencies.terminal.writeInput(this.requireWorkspace(), data);
    return null;
  }

  private terminalResize(payload: JsonRecord): null {
    const columns = numberValue(payload.columns);
    const rows = numberValue(payload.rows);
    if (columns === undefined || rows === undefined) throw new Error('Terminal viewport is required.');
    this.dependencies.terminal.resize(this.requireWorkspace(), columns, rows);
    return null;
  }

  private async changeDirectory(payload: JsonRecord, requestId?: string): Promise<{ queued: true }> {
    const id = this.requireRequestId(requestId);
    await this.dependencies.shell.requestDirectoryChange(this.requireWorkspace(), id, this.requirePath(payload.path));
    return { queued: true };
  }

  private async filesystemList(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    return { path, entries: await this.dependencies.filesystem.readDirectory(this.requireWorkspace(), path) };
  }

  private async filesystemSearch(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const query = stringValue(payload.query);
    if (query === undefined) throw new Error('Filesystem search query is required.');
    const result = await this.dependencies.filesystem.search(this.requireWorkspace(), path, query);
    return { entries: result.items, truncated: result.truncated };
  }

  private async filesystemReadText(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const result = await this.dependencies.filesystem.readFile(
      this.requireWorkspace(),
      path,
      stringValue(payload.encoding),
    );
    return {
      path,
      content: result.content,
      encoding: result.encodingUsed,
      rawContentBase64: result.rawContentBase64,
    };
  }

  private async filesystemReadBinary(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const bytes = await this.dependencies.filesystem.readBinary(this.requireWorkspace(), path);
    return { path, contentBase64: Buffer.from(bytes).toString('base64') };
  }

  private async filesystemWriteText(payload: JsonRecord) {
    const path = this.requirePath(payload.path);
    const content = stringValue(payload.content);
    if (content === undefined) throw new Error('File content must be a string.');
    await this.dependencies.filesystem.writeFile(
      this.requireWorkspace(),
      path,
      content,
      stringValue(payload.encoding) ?? 'utf-8',
    );
    return null;
  }

  private async filesystemRemove(payload: JsonRecord) {
    const paths = stringArray(payload.paths);
    if (!paths) throw new Error('Filesystem remove paths must be an array of strings.');
    await this.dependencies.filesystem.removePaths(this.requireWorkspace(), paths);
    return null;
  }

  private async filesystemChmod(payload: JsonRecord) {
    const mode = numberValue(payload.mode);
    if (mode === undefined) throw new Error('chmod mode is required.');
    await this.dependencies.filesystem.chmod(this.requireWorkspace(), this.requirePath(payload.path), mode);
    return null;
  }

  private copyMove(payload: JsonRecord, requestId?: string) {
    const id = this.requireRequestId(requestId);
    const mode = stringValue(payload.mode);
    const sources = stringArray(payload.sources);
    const destination = stringValue(payload.destination);
    const sourceWorkspaceId = stringValue(payload.sourceWorkspaceId) ?? this.requireWorkspace();
    if ((mode !== 'copy' && mode !== 'move') || !sources || !destination) throw new Error('Invalid transfer request.');
    this.dependencies.operations.startTransfer(
      this.requireWorkspace(),
      sourceWorkspaceId,
      sources,
      destination,
      id,
      mode,
    );
    return { started: true };
  }

  private cancelTransfer(payload: JsonRecord) {
    const taskId = stringValue(payload.taskId);
    if (!taskId) throw new Error('taskId is required.');
    return this.dependencies.operations.cancelTransfer(this.requireWorkspace(), taskId);
  }

  private compress(payload: JsonRecord, requestId?: string) {
    const format = stringValue(payload.format);
    const sources = stringArray(payload.sources);
    const destination = stringValue(payload.destination);
    if (!sources || !destination || !format || !['zip', 'tar.gz', 'tar.bz2'].includes(format)) {
      throw new Error('Invalid archive compression request.');
    }
    const archiveFormat: ArchiveFormat = format === 'tar.gz' ? 'targz' : format === 'tar.bz2' ? 'tarbz2' : 'zip';
    this.dependencies.operations.startCompress(this.requireWorkspace(), {
      requestId: this.requireRequestId(requestId),
      sourcePaths: sources,
      destinationPath: destination,
      format: archiveFormat,
      ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
    });
    return { started: true };
  }

  private decompress(payload: JsonRecord, requestId?: string) {
    const source = stringValue(payload.source);
    if (!source) throw new Error('Archive source is required.');
    this.dependencies.operations.startDecompress(this.requireWorkspace(), {
      requestId: this.requireRequestId(requestId),
      archivePath: source,
      ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
    });
    return { started: true };
  }

  private cancelArchive(payload: JsonRecord) {
    const taskId = stringValue(payload.taskId);
    if (!taskId) throw new Error('taskId is required.');
    return this.dependencies.operations.cancelArchive(this.requireWorkspace(), taskId);
  }

  private uploadPrepare(payload: JsonRecord) {
    const prepareId = stringValue(payload.prepareId);
    const basePath = stringValue(payload.basePath);
    const directories = stringArray(payload.directories);
    if (!prepareId || !basePath || !directories) throw new Error('Invalid upload preparation request.');
    return this.dependencies.operations.prepareUpload(this.requireWorkspace(), prepareId, basePath, directories);
  }

  private async uploadStart(payload: JsonRecord) {
    const uploadId = stringValue(payload.uploadId);
    const destinationPath = stringValue(payload.destinationPath);
    const size = numberValue(payload.size);
    const conflictPolicy = stringValue(payload.conflictPolicy) ?? 'ask';
    if (!uploadId || !destinationPath || size === undefined || !['ask', 'overwrite', 'skip'].includes(conflictPolicy)) {
      throw new Error('Invalid upload start request.');
    }
    await this.dependencies.operations.startUpload(this.requireWorkspace(), uploadId, destinationPath, size, {
      ...(typeof payload.relativePath === 'string' ? { relativePath: payload.relativePath } : {}),
      ...(typeof payload.prepareId === 'string' ? { prepareId: payload.prepareId } : {}),
      conflictPolicy: conflictPolicy as 'ask' | 'overwrite' | 'skip',
    });
    return { started: true };
  }

  private uploadCancel(payload: JsonRecord) {
    const uploadId = stringValue(payload.uploadId);
    if (!uploadId) throw new Error('uploadId is required.');
    return this.dependencies.operations.cancelUpload(this.requireWorkspace(), uploadId);
  }

  private uploadAbort(payload: JsonRecord) {
    const uploadId = stringValue(payload.uploadId);
    const message = stringValue(payload.message);
    if (!uploadId || !message) throw new Error('uploadId and message are required.');
    return this.dependencies.operations.abortUpload(this.requireWorkspace(), uploadId, message);
  }

  private async dockerCommand(payload: JsonRecord) {
    const containerId = stringValue(payload.containerId);
    const command = stringValue(payload.command) as DockerCommand | undefined;
    if (!containerId || !command || !['start', 'stop', 'restart', 'remove'].includes(command)) {
      throw new Error('Invalid Docker command.');
    }
    await this.dependencies.docker.command(this.requireWorkspace(), containerId, command);
    return null;
  }

  private async dockerStats(payload: JsonRecord) {
    const containerId = stringValue(payload.containerId);
    if (!containerId) throw new Error('containerId is required.');
    return dockerStatsWire(await this.dependencies.docker.getStats(this.requireWorkspace(), containerId));
  }

  private async suspendMark(payload: JsonRecord) {
    await this.dependencies.suspendCoordinator.markForSuspend(
      this.requireWorkspace(),
      this.identity.userId,
      stringValue(payload.terminalSnapshot),
    );
    return null;
  }

  private async suspendUnmark() {
    await this.dependencies.suspendCoordinator.unmarkForSuspend(this.requireWorkspace(), this.identity.userId);
    return null;
  }

  private async resume(payload: JsonRecord) {
    if (this.workspaceId) throw new Error('Workspace socket is already bound.');
    const suspendedSessionId = stringValue(payload.suspendedSessionId);
    const workspaceId = this.requireWorkspaceId(payload.workspaceId);
    if (!suspendedSessionId || !this.dependencies.workspace.canCreate(workspaceId)) {
      throw new Error('Invalid resume request.');
    }
    this.bindWorkspace(workspaceId);
    let began = false;
    try {
      const result = await this.dependencies.suspendCoordinator.beginResume(
        this.identity.userId,
        suspendedSessionId,
        workspaceId,
      );
      began = true;
      await this.terminalTransport.sendStream(result.logStream, (chunk) =>
        this.dependencies.shell.filterOutput(result.workspaceId, chunk),
      );
      await this.dependencies.suspendCoordinator.commitResume(workspaceId);
      return {
        workspaceId,
        connectionId: result.connectionId,
        connectionName: result.connectionName,
        resumedFrom: suspendedSessionId,
      };
    } catch (error) {
      if (began) await this.dependencies.suspendCoordinator.rollbackResume(workspaceId).catch(() => false);
      this.unbindWorkspace();
      throw error;
    }
  }

  private async suspendTerminate(payload: JsonRecord) {
    const id = stringValue(payload.suspendedSessionId);
    if (!id || !(await this.dependencies.suspended.terminate(this.identity.userId, id))) {
      throw new Error('Suspended session was not found.');
    }
    return null;
  }

  private async suspendRemove(payload: JsonRecord) {
    const id = stringValue(payload.suspendedSessionId);
    if (!id || !(await this.dependencies.suspended.removeDisconnected(this.identity.userId, id))) {
      throw new Error('Disconnected suspended session was not found.');
    }
    return null;
  }

  private suspendRename(payload: JsonRecord) {
    const id = stringValue(payload.suspendedSessionId);
    const name = stringValue(payload.name);
    if (!id || name === undefined || !this.dependencies.suspended.rename(this.identity.userId, id, name)) {
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
        this.sendEvent('transfer.upload', event.event);
        return;
      case 'transfer-event':
        this.sendEvent('transfer.copyMove', event.event);
        return;
      case 'archive-event':
        this.sendEvent('transfer.archive', event.event);
        return;
    }
  }

  private sendResponse(requestId: string, ok: boolean, data?: unknown, error?: string): void {
    this.sendJson({
      type: 'response',
      requestId,
      payload: { ok, ...(data !== undefined ? { data } : {}), ...(error ? { error } : {}) },
    });
  }

  private sendEvent(type: string, payload: unknown): void {
    this.sendJson({ type, payload });
  }

  private sendJson(message: unknown): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
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
