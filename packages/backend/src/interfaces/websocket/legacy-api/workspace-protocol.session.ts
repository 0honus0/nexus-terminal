import { randomUUID } from 'node:crypto';
import path from 'node:path';
import WebSocket, { type RawData } from 'ws';
import type { WorkspaceCommandService } from '../../../modules/workspace/services/workspace-command.service';
import type { WorkspaceDockerService } from '../../../modules/workspace/services/workspace-docker.service';
import type { WorkspaceFilesystemService } from '../../../modules/workspace/services/workspace-filesystem.service';
import type { WorkspaceOperationsService } from '../../../modules/workspace/services/workspace-operations.service';
import type { WorkspaceShellIntegrationService } from '../../../modules/workspace/services/workspace-shell-integration.service';
import type { WorkspaceStatusMonitorService } from '../../../modules/workspace/services/workspace-status-monitor.service';
import type { WorkspaceSuspendCoordinatorService } from '../../../modules/workspace/services/workspace-suspend-coordinator.service';
import type { WorkspaceTerminalService } from '../../../modules/workspace/services/workspace-terminal.service';
import type { WorkspaceEvent, WorkspaceEventHub } from '../../../modules/workspace/workspace-event-hub';
import type { WorkspaceService } from '../../../modules/workspace/workspace.service';
import type { SshSuspendService } from '../../../modules/ssh-suspend/ssh-suspend.service';
import type { DockerCommand } from '../../../platform/docker/docker.port';
import { toLegacyFileItem, toLegacySearchResult } from './file-dto.mapper';
import { LegacyTerminalBinaryTransport } from './terminal-binary.transport';
import { parseLegacyUploadBinaryFrame } from './upload-binary.transport';
import { mapLegacyWorkspaceEvent, type LegacyWorkspaceJsonMessage } from './workspace-event.mapper';

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const MAX_JSON_MESSAGE_BYTES = 1024 * 1024;
const DIRECT_FILESYSTEM_TYPES = new Set([
  'sftp:readdir',
  'sftp:search',
  'sftp:stat',
  'sftp:readfile',
  'sftp:writefile',
  'sftp:mkdir',
  'sftp:rmdir',
  'sftp:unlink',
  'sftp:rename',
  'sftp:chmod',
  'sftp:realpath',
  'sftp:delete_paths',
]);

export interface LegacyWorkspaceProtocolDependencies {
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

export interface LegacyWorkspacePeerIdentity {
  userId: number;
  username: string;
  clientIp: string;
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
const stringValue = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const numberValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const stringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;

/**
 * Temporary adapter for the current frontend Workspace WebSocket contract.
 * All legacy message names, payload aliases and NXTM/NXUP behavior terminate here.
 */
export class LegacyWorkspaceProtocolSession {
  private workspaceId?: string;
  private eventUnsubscribe?: () => void;
  private closed = false;
  private readonly terminalTransport: LegacyTerminalBinaryTransport;
  private readonly autoTerminationUnsubscribe: () => void;

  constructor(
    private readonly socket: WebSocket,
    private readonly identity: LegacyWorkspacePeerIdentity,
    private readonly dependencies: LegacyWorkspaceProtocolDependencies,
  ) {
    this.terminalTransport = new LegacyTerminalBinaryTransport(socket, dependencies.terminal);
    this.autoTerminationUnsubscribe = dependencies.suspended.onAutoTerminated((event) => {
      if (event.userId !== identity.userId) return;
      this.sendJson({
        type: 'SSH_SUSPEND_AUTO_TERMINATED_NOTIF',
        payload: { suspendSessionId: event.suspendSessionId, reason: event.reason },
      });
    });
  }

  get boundWorkspaceId(): string | undefined {
    return this.workspaceId;
  }

  async handleMessage(raw: RawData, isBinary: boolean): Promise<void> {
    if (this.closed) return;
    if (isBinary) {
      await this.handleUploadBinary(raw);
      return;
    }
    const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
    if (bytes.byteLength > MAX_JSON_MESSAGE_BYTES) {
      this.socket.close(1009, 'WebSocket JSON message too large');
      return;
    }
    let message: JsonRecord;
    try {
      const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('无效的消息格式 (缺少 type)');
      message = parsed as JsonRecord;
    } catch (error) {
      this.sendJson({
        type: 'error',
        payload:
          error instanceof Error && error.message.includes('缺少 type') ? error.message : '无效的消息格式 (非 JSON)',
      });
      return;
    }
    const type = stringValue(message.type);
    if (!type) {
      this.sendJson({ type: 'error', payload: '无效的消息格式 (缺少 type)' });
      return;
    }
    try {
      await this.route(type, message.payload, stringValue(message.requestId));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error(`[WebSocket ${this.identity.username}/${this.workspaceId ?? 'detached'}] ${type} failed:`, error);
      this.sendJson({ type: 'error', payload: `处理消息时发生内部错误: ${text}` });
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

  private async route(type: string, rawPayload: unknown, requestId?: string): Promise<void> {
    const payload = record(rawPayload);
    switch (type) {
      case 'ssh:connect':
        await this.connect(payload);
        return;
      case 'ssh:input': {
        const workspaceId = this.requireWorkspace();
        const data = stringValue(payload.data);
        if (data === undefined) throw new Error('SSH input must include string data.');
        const sequence = payload.sequence === undefined ? undefined : numberValue(payload.sequence);
        this.dependencies.terminal.writeInput(workspaceId, data, sequence);
        return;
      }
      case 'ssh:output:ack': {
        const sequence = numberValue(payload.sequence);
        if (!Number.isInteger(sequence) || sequence! < 0 || sequence! > 0xffffffff)
          throw new Error('无效的终端输出 ACK');
        this.terminalTransport.acknowledge(sequence!);
        return;
      }
      case 'ssh:resize': {
        const workspaceId = this.requireWorkspace();
        const cols = numberValue(payload.cols);
        const rows = numberValue(payload.rows);
        if (cols === undefined || rows === undefined) throw new Error('无效的终端尺寸。');
        this.dependencies.terminal.resize(workspaceId, cols, rows);
        return;
      }
      case 'ssh:exec_silent':
        await this.execSilent(payload, requestId);
        return;
      case 'ssh:change_directory':
        await this.changeDirectory(payload, requestId);
        return;
      case 'status:subscribe':
        await this.dependencies.status.start(this.requireWorkspace());
        return;
      case 'status:unsubscribe':
        this.dependencies.status.stop(this.requireWorkspace());
        return;
      case 'docker:get_status':
        await this.dockerStatus();
        return;
      case 'docker:command':
        await this.dockerCommand(payload);
        return;
      case 'docker:get_stats':
        await this.dockerStats(payload);
        return;
      case 'sftp:readdir':
      case 'sftp:search':
      case 'sftp:stat':
      case 'sftp:readfile':
      case 'sftp:writefile':
      case 'sftp:mkdir':
      case 'sftp:rmdir':
      case 'sftp:unlink':
      case 'sftp:rename':
      case 'sftp:chmod':
      case 'sftp:realpath':
      case 'sftp:delete_paths':
      case 'sftp:copy':
      case 'sftp:cross_copy':
      case 'sftp:move':
      case 'sftp:transfer:cancel':
      case 'sftp:compress':
      case 'sftp:decompress':
      case 'sftp:archive:cancel':
        await this.filesystemOperation(type, payload, requestId);
        return;
      case 'sftp:upload:prepare':
        await this.uploadPrepare(payload);
        return;
      case 'sftp:upload:start':
        await this.uploadStart(payload);
        return;
      case 'sftp:upload:cancel':
        await this.uploadCancel(payload);
        return;
      case 'sftp:upload:cancel-all':
        await this.uploadCancelAll(payload);
        return;
      case 'SSH_MARK_FOR_SUSPEND':
        await this.markForSuspend(payload);
        return;
      case 'SSH_UNMARK_FOR_SUSPEND':
        await this.unmarkForSuspend(payload);
        return;
      case 'SSH_SUSPEND_LIST_REQUEST':
        this.sendJson({
          type: 'SSH_SUSPEND_LIST_RESPONSE',
          payload: { suspendSessions: this.dependencies.suspended.list(this.identity.userId) },
        });
        return;
      case 'SSH_SUSPEND_RESUME_REQUEST':
        await this.resumeSuspended(payload);
        return;
      case 'SSH_SUSPEND_TERMINATE_REQUEST':
        await this.terminateSuspended(payload);
        return;
      case 'SSH_SUSPEND_REMOVE_ENTRY':
        await this.removeSuspendedEntry(payload);
        return;
      case 'SSH_SUSPEND_EDIT_NAME':
        await this.renameSuspended(payload);
        return;
      default:
        this.sendJson({ type: 'error', payload: `不支持的消息类型: ${type}` });
    }
  }

  private async connect(payload: JsonRecord): Promise<void> {
    if (this.workspaceId && this.dependencies.workspace.getSession(this.workspaceId)) {
      this.sendJson({ type: 'info', payload: '已存在活动的 SSH 连接，已忽略重复连接请求。' });
      return;
    }
    const connectionId = Number(payload.connectionId);
    if (!Number.isInteger(connectionId) || connectionId <= 0) {
      this.sendJson({ type: 'ssh:error', payload: '无效或缺少 connectionId。' });
      return;
    }
    const requestedId = stringValue(payload.clientSessionId)?.trim() ?? '';
    const workspaceId =
      WORKSPACE_ID_PATTERN.test(requestedId) && this.dependencies.workspace.canCreate(requestedId)
        ? requestedId
        : randomUUID();
    const cols = numberValue(payload.cols);
    const rows = numberValue(payload.rows);
    this.sendJson({ type: 'ssh:status', payload: '正在处理连接请求...' });
    this.bindWorkspace(workspaceId);
    try {
      this.sendJson({ type: 'ssh:status', payload: '正在获取连接信息...' });
      const session = await this.dependencies.workspace.connect({
        workspaceId,
        userId: this.identity.userId,
        connectionId,
        ...(cols !== undefined ? { columns: cols } : {}),
        ...(rows !== undefined ? { rows } : {}),
        actorUsername: this.identity.username,
        clientIp: this.identity.clientIp,
      });
      this.sendJson({ type: 'ssh:status', payload: 'SSH 连接成功，正在打开 Shell...' });
      this.dependencies.terminal.attach(workspaceId);
      this.sendJson({ type: 'ssh:connected', payload: { connectionId: session.connectionId, sessionId: workspaceId } });
      void this.dependencies.filesystem.initialize(workspaceId).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson({ type: 'ssh:error', payload: `连接失败: ${message}` });
      this.socket.close(1011, 'SSH Connection Failed');
    }
  }

  private async execSilent(payload: JsonRecord, requestId?: string): Promise<void> {
    const fail = (error: string) => this.sendJson({ type: 'ssh:exec_silent:error', requestId, payload: { error } });
    if (!requestId || payload.action !== 'pwd') {
      fail('无效的静默命令请求。');
      return;
    }
    try {
      const output = await this.dependencies.command.readCurrentDirectory(
        this.requireWorkspace(),
        this.identity.userId,
      );
      this.sendJson({ type: 'ssh:exec_silent:result', requestId, payload: { output } });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  }

  private async changeDirectory(payload: JsonRecord, requestId?: string): Promise<void> {
    if (!requestId || typeof payload.path !== 'string') {
      this.sendJson({ type: 'ssh:change_directory:error', requestId, payload: { error: '无效的终端目录切换请求。' } });
      return;
    }
    await this.dependencies.shell.requestDirectoryChange(this.requireWorkspace(), requestId, payload.path);
  }

  private async dockerStatus(): Promise<void> {
    try {
      this.sendJson({
        type: 'docker:status:update',
        payload: await this.dependencies.docker.getStatus(this.requireWorkspace()),
      });
    } catch (error) {
      this.sendJson({
        type: 'docker:status:error',
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async dockerCommand(payload: JsonRecord): Promise<void> {
    const containerId = stringValue(payload.containerId);
    const command = stringValue(payload.command) as DockerCommand | undefined;
    if (!containerId || !command || !['start', 'stop', 'restart', 'remove'].includes(command)) {
      this.sendJson({
        type: 'docker:command:error',
        payload: { containerId, command, message: 'Invalid containerId or command.' },
      });
      return;
    }
    try {
      await this.dependencies.docker.command(this.requireWorkspace(), containerId, command);
      setTimeout(() => this.sendJson({ type: 'request_docker_status_update' }), 500).unref?.();
    } catch (error) {
      this.sendJson({
        type: 'docker:command:error',
        payload: {
          containerId,
          command,
          message: `Failed to execute remote command: ${error instanceof Error ? error.message : String(error)}`,
        },
      });
    }
  }

  private async dockerStats(payload: JsonRecord): Promise<void> {
    const containerId = stringValue(payload.containerId);
    if (!containerId) {
      this.sendJson({ type: 'docker:stats:error', payload: { message: 'Missing containerId.' } });
      return;
    }
    try {
      const stats = await this.dependencies.docker.getStats(this.requireWorkspace(), containerId);
      this.sendJson({ type: 'docker:stats:update', payload: { containerId, stats } });
    } catch (error) {
      this.sendJson({
        type: 'docker:stats:error',
        payload: { containerId, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async filesystemOperation(type: string, payload: JsonRecord, requestId?: string): Promise<void> {
    const workspaceId = this.requireWorkspace();
    if (!requestId) {
      this.sendJson({ type: 'sftp_error', payload: { message: `SFTP 操作 ${type} 缺少 requestId` } });
      return;
    }
    try {
      switch (type) {
        case 'sftp:readdir': {
          const remotePath = this.requirePath(payload.path, 'path');
          const items = (await this.dependencies.filesystem.readDirectory(workspaceId, remotePath)).map(
            toLegacyFileItem,
          );
          this.sendJson({ type: 'sftp:readdir:success', path: remotePath, requestId, payload: items });
          return;
        }
        case 'sftp:search': {
          const remotePath = this.requirePath(payload.path, 'path');
          const query = stringValue(payload.query);
          if (query === undefined) throw new Error("Missing 'query' in payload for search");
          this.sendJson({
            type: 'sftp:search:success',
            path: remotePath,
            requestId,
            payload: toLegacySearchResult(await this.dependencies.filesystem.search(workspaceId, remotePath, query)),
          });
          return;
        }
        case 'sftp:stat': {
          const remotePath = this.requirePath(payload.path, 'path');
          this.sendJson({
            type: 'sftp:stat:success',
            path: remotePath,
            requestId,
            payload: toLegacyFileItem(await this.dependencies.filesystem.stat(workspaceId, remotePath)),
          });
          return;
        }
        case 'sftp:readfile': {
          const remotePath = this.requirePath(payload.path, 'path');
          this.sendJson({
            type: 'sftp:readfile:success',
            path: remotePath,
            requestId,
            payload: await this.dependencies.filesystem.readFile(
              workspaceId,
              remotePath,
              stringValue(payload.encoding),
            ),
          });
          return;
        }
        case 'sftp:writefile': {
          const remotePath = this.requirePath(payload.path, 'path');
          const content = stringValue(payload.content) ?? stringValue(payload.data) ?? '';
          const item = await this.dependencies.filesystem.writeFile(
            workspaceId,
            remotePath,
            content,
            stringValue(payload.encoding) ?? 'utf-8',
          );
          this.sendJson({
            type: 'sftp:writefile:success',
            path: remotePath,
            requestId,
            payload: item ? toLegacyFileItem(item) : null,
          });
          return;
        }
        case 'sftp:mkdir': {
          const remotePath = this.requirePath(payload.path, 'path');
          await this.dependencies.filesystem.createDirectory(workspaceId, remotePath);
          this.sendJson({
            type: 'sftp:mkdir:success',
            path: remotePath,
            requestId,
            payload: toLegacyFileItem(await this.dependencies.filesystem.stat(workspaceId, remotePath)),
          });
          return;
        }
        case 'sftp:rmdir': {
          const remotePath = this.requirePath(payload.path, 'path');
          await this.dependencies.filesystem.removeDirectory(workspaceId, remotePath, true);
          this.sendJson({ type: 'sftp:rmdir:success', path: remotePath, requestId });
          return;
        }
        case 'sftp:unlink': {
          const remotePath = this.requirePath(payload.path, 'path');
          await this.dependencies.filesystem.removeFile(workspaceId, remotePath);
          this.sendJson({ type: 'sftp:unlink:success', path: remotePath, requestId });
          return;
        }
        case 'sftp:rename': {
          const oldPath = this.requirePath(payload.oldPath, 'oldPath');
          const newPath = this.requirePath(payload.newPath, 'newPath');
          await this.dependencies.filesystem.rename(workspaceId, oldPath, newPath);
          this.sendJson({
            type: 'sftp:rename:success',
            requestId,
            payload: {
              oldPath,
              newPath,
              newItem: toLegacyFileItem(await this.dependencies.filesystem.stat(workspaceId, newPath)),
            },
          });
          return;
        }
        case 'sftp:chmod': {
          const remotePath = this.requirePath(payload.path, 'path');
          const mode = numberValue(payload.mode);
          if (mode === undefined) throw new Error("Missing 'mode' in payload for chmod");
          await this.dependencies.filesystem.chmod(workspaceId, remotePath, mode);
          this.sendJson({
            type: 'sftp:chmod:success',
            path: remotePath,
            requestId,
            payload: toLegacyFileItem(await this.dependencies.filesystem.stat(workspaceId, remotePath)),
          });
          return;
        }
        case 'sftp:realpath': {
          const remotePath = this.requirePath(payload.path, 'path');
          this.sendJson({
            type: 'sftp:realpath:success',
            path: remotePath,
            requestId,
            payload: await this.dependencies.filesystem.realpath(workspaceId, remotePath),
          });
          return;
        }
        case 'sftp:delete_paths': {
          const paths = stringArray(payload.paths);
          if (!paths) throw new Error("Missing 'paths' (array) in payload for delete paths");
          await this.dependencies.filesystem.removePaths(workspaceId, paths);
          this.sendJson({ type: 'sftp:delete_paths:success', requestId, payload: { paths } });
          return;
        }
        case 'sftp:copy': {
          const sources = stringArray(payload.sources);
          const destination = stringValue(payload.destination);
          if (!sources || !destination) throw new Error("Missing 'sources' or 'destination' in payload for copy");
          await this.dependencies.operations.copy(workspaceId, sources, destination, requestId);
          return;
        }
        case 'sftp:cross_copy': {
          const sourceWorkspaceId = stringValue(payload.sourceSessionId);
          const sources = stringArray(payload.sources);
          const destination = stringValue(payload.destination);
          if (!sourceWorkspaceId || !sources || !destination)
            throw new Error("Missing 'sourceSessionId', 'sources', or 'destination' in payload for cross copy");
          await this.dependencies.operations.crossCopy(workspaceId, sourceWorkspaceId, sources, destination, requestId);
          return;
        }
        case 'sftp:move': {
          const sources = stringArray(payload.sources);
          const destination = stringValue(payload.destination);
          if (!sources || !destination) throw new Error("Missing 'sources' or 'destination' in payload for move");
          await this.dependencies.operations.move(workspaceId, sources, destination, requestId);
          return;
        }
        case 'sftp:transfer:cancel': {
          const targetRequestId = stringValue(payload.requestId) ?? requestId;
          if (!(await this.dependencies.operations.cancelTransfer(workspaceId, targetRequestId))) {
            this.sendJson({
              type: 'sftp:transfer:cancelled',
              requestId: targetRequestId,
              payload: { requestId: targetRequestId },
            });
          }
          return;
        }
        case 'sftp:compress': {
          const sources = stringArray(payload.sources);
          const destination = stringValue(payload.destination);
          const format = stringValue(payload.format);
          if (!sources || !destination || !format || !['zip', 'targz', 'tarbz2'].includes(format))
            throw new Error('Invalid compress payload.');
          await this.dependencies.operations.compress(workspaceId, {
            requestId,
            sourcePaths: sources,
            destinationPath: destination,
            format: format as 'zip' | 'targz' | 'tarbz2',
            ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
          });
          return;
        }
        case 'sftp:decompress': {
          const source = stringValue(payload.source);
          if (!source) throw new Error("Missing 'source' in payload for decompress");
          await this.dependencies.operations.decompress(workspaceId, {
            requestId,
            archivePath: source,
            ...(typeof payload.password === 'string' ? { password: payload.password } : {}),
          });
          return;
        }
        case 'sftp:archive:cancel': {
          const targetRequestId = stringValue(payload.requestId) ?? requestId;
          if (!(await this.dependencies.operations.cancelArchive(workspaceId, targetRequestId))) {
            this.sendJson({
              type: 'sftp:archive:cancelled',
              requestId: targetRequestId,
              payload: { requestId: targetRequestId },
            });
          }
          return;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (DIRECT_FILESYSTEM_TYPES.has(type)) {
        const response: LegacyWorkspaceJsonMessage = { type: `${type}:error`, requestId, payload: message };
        if (typeof payload.path === 'string') response.path = payload.path;
        if (typeof payload.oldPath === 'string') response.oldPath = payload.oldPath;
        if (typeof payload.newPath === 'string') response.newPath = payload.newPath;
        if (type === 'sftp:realpath') response.payload = { requestedPath: payload.path, error: message };
        this.sendJson(response);
        return;
      }
      if (type === 'sftp:compress' || type === 'sftp:decompress') {
        this.sendJson({ type: `${type}:error`, requestId, payload: { error: message, requestId } });
        return;
      }
      const op =
        type === 'sftp:move'
          ? 'sftp:move:error'
          : type === 'sftp:copy' || type === 'sftp:cross_copy'
            ? 'sftp:copy:error'
            : 'sftp_error';
      this.sendJson({ type: op, requestId, payload: op === 'sftp_error' ? { message, requestId } : message });
    }
  }

  private async uploadPrepare(payload: JsonRecord): Promise<void> {
    const workspaceId = this.requireWorkspace();
    const prepareId = stringValue(payload.prepareId);
    const basePath = stringValue(payload.basePath);
    const directories = stringArray(payload.directories);
    if (!prepareId || !basePath || !directories) {
      this.sendJson({ type: 'sftp:upload:prepare:error', payload: { prepareId, message: '上传路径准备参数无效' } });
      return;
    }
    try {
      const result = await this.dependencies.operations.prepareUpload(workspaceId, prepareId, basePath, directories);
      this.sendJson({ type: 'sftp:upload:prepare:ready', payload: { prepareId, ...result } });
    } catch (error) {
      this.sendJson({
        type: 'sftp:upload:prepare:error',
        payload: { prepareId, message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async uploadStart(payload: JsonRecord): Promise<void> {
    const uploadId = stringValue(payload.uploadId);
    const destinationPath = stringValue(payload.remotePath) ?? stringValue(payload.destinationPath);
    const size = numberValue(payload.size);
    if (!uploadId || !destinationPath || size === undefined) {
      this.sendJson({ type: 'sftp:upload:error', payload: { uploadId, message: '缺少 uploadId, remotePath 或 size' } });
      return;
    }
    const policy = stringValue(payload.conflictPolicy) ?? stringValue(payload.conflict_policy) ?? 'ask';
    if (!['ask', 'overwrite', 'skip'].includes(policy)) {
      this.sendJson({ type: 'sftp:upload:error', payload: { uploadId, message: '无效的同名文件处理策略' } });
      return;
    }
    await this.dependencies.operations.startUpload(this.requireWorkspace(), uploadId, destinationPath, size, {
      ...(typeof payload.relativePath === 'string' ? { relativePath: payload.relativePath } : {}),
      ...(typeof payload.prepareId === 'string' ? { prepareId: payload.prepareId } : {}),
      conflictPolicy: policy as 'ask' | 'overwrite' | 'skip',
    });
  }

  private async uploadCancel(payload: JsonRecord): Promise<void> {
    const uploadId = stringValue(payload.uploadId);
    if (!uploadId) {
      this.sendJson({ type: 'sftp:upload:error', payload: { message: '缺少 uploadId' } });
      return;
    }
    await this.dependencies.operations.cancelUpload(this.requireWorkspace(), uploadId);
  }

  private async uploadCancelAll(payload: JsonRecord): Promise<void> {
    const uploadIds = stringArray(payload.uploadIds);
    if (!uploadIds) {
      this.sendJson({ type: 'sftp:upload:error', payload: { message: 'uploadIds 参数无效' } });
      return;
    }
    const workspaceId = this.requireWorkspace();
    await Promise.all(uploadIds.map((id) => this.dependencies.operations.cancelUpload(workspaceId, id)));
  }

  private async handleUploadBinary(raw: RawData): Promise<void> {
    try {
      const chunk = parseLegacyUploadBinaryFrame(raw);
      await this.dependencies.operations.appendUpload(
        this.requireWorkspace(),
        chunk.uploadId,
        chunk.chunkIndex,
        chunk.data,
        chunk.isLast,
      );
    } catch (error) {
      this.sendJson({
        type: 'sftp:upload:error',
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async markForSuspend(payload: JsonRecord): Promise<void> {
    const sessionId = stringValue(payload.sessionId);
    if (!sessionId || sessionId !== this.workspaceId) {
      this.sendJson({
        type: 'SSH_MARKED_FOR_SUSPEND_ACK',
        payload: { sessionId: sessionId ?? '', success: false, error: '无效的活动会话' },
      });
      return;
    }
    try {
      await this.dependencies.suspendCoordinator.markForSuspend(
        sessionId,
        this.identity.userId,
        stringValue(payload.initialBuffer),
      );
      this.sendJson({ type: 'SSH_MARKED_FOR_SUSPEND_ACK', payload: { sessionId, success: true } });
    } catch (error) {
      this.sendJson({
        type: 'SSH_MARKED_FOR_SUSPEND_ACK',
        payload: { sessionId, success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async unmarkForSuspend(payload: JsonRecord): Promise<void> {
    const sessionId = stringValue(payload.sessionId);
    if (!sessionId || sessionId !== this.workspaceId) {
      this.sendJson({
        type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
        payload: { sessionId: sessionId ?? '', success: false, error: '无效的活动会话' },
      });
      return;
    }
    try {
      await this.dependencies.suspendCoordinator.unmarkForSuspend(sessionId, this.identity.userId);
      this.sendJson({ type: 'SSH_UNMARKED_FOR_SUSPEND_ACK', payload: { sessionId, success: true } });
    } catch (error) {
      this.sendJson({
        type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
        payload: { sessionId, success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private async resumeSuspended(payload: JsonRecord): Promise<void> {
    const suspendSessionId = stringValue(payload.suspendSessionId);
    const newWorkspaceId = stringValue(payload.newFrontendSessionId);
    if (
      !suspendSessionId ||
      !newWorkspaceId ||
      !WORKSPACE_ID_PATTERN.test(newWorkspaceId) ||
      this.workspaceId ||
      !this.dependencies.workspace.canCreate(newWorkspaceId)
    ) {
      this.sendJson({
        type: 'SSH_SUSPEND_RESUMED_NOTIF',
        payload: {
          suspendSessionId: suspendSessionId ?? '',
          newFrontendSessionId: newWorkspaceId ?? '',
          success: false,
          error: '恢复会话参数无效或会话 ID 冲突',
        },
      });
      return;
    }
    this.bindWorkspace(newWorkspaceId);
    let began = false;
    try {
      const result = await this.dependencies.suspendCoordinator.beginResume(
        this.identity.userId,
        suspendSessionId,
        newWorkspaceId,
      );
      began = true;
      await this.terminalTransport.sendCachedStream(result.logStream, (chunk) =>
        this.dependencies.shell.filterOutput(result.workspaceId, chunk),
      );
      await this.dependencies.suspendCoordinator.commitResume(newWorkspaceId);
      this.sendJson({
        type: 'ssh:connected',
        payload: { connectionId: result.connectionId, sessionId: newWorkspaceId },
      });
      this.sendJson({
        type: 'SSH_SUSPEND_RESUMED_NOTIF',
        payload: { suspendSessionId, newFrontendSessionId: newWorkspaceId, success: true },
      });
    } catch (error) {
      if (began) await this.dependencies.suspendCoordinator.rollbackResume(newWorkspaceId).catch(() => false);
      this.sendJson({
        type: 'SSH_SUSPEND_RESUMED_NOTIF',
        payload: {
          suspendSessionId,
          newFrontendSessionId: newWorkspaceId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async terminateSuspended(payload: JsonRecord): Promise<void> {
    const suspendSessionId = stringValue(payload.suspendSessionId) ?? '';
    const success = Boolean(
      suspendSessionId && (await this.dependencies.suspended.terminate(this.identity.userId, suspendSessionId)),
    );
    this.sendJson({
      type: 'SSH_SUSPEND_TERMINATED_RESP',
      payload: { suspendSessionId, success, ...(success ? {} : { error: '终止挂起会话失败' }) },
    });
  }

  private async removeSuspendedEntry(payload: JsonRecord): Promise<void> {
    const suspendSessionId = stringValue(payload.suspendSessionId) ?? '';
    const success = Boolean(
      suspendSessionId &&
      (await this.dependencies.suspended.removeDisconnected(this.identity.userId, suspendSessionId)),
    );
    this.sendJson({
      type: 'SSH_SUSPEND_ENTRY_REMOVED_RESP',
      payload: { suspendSessionId, success, ...(success ? {} : { error: '移除挂起条目失败' }) },
    });
  }

  private async renameSuspended(payload: JsonRecord): Promise<void> {
    const suspendSessionId = stringValue(payload.suspendSessionId) ?? '';
    const customName = stringValue(payload.customName) ?? '';
    try {
      const success = this.dependencies.suspended.rename(this.identity.userId, suspendSessionId, customName);
      this.sendJson({
        type: 'SSH_SUSPEND_NAME_EDITED_RESP',
        payload: { suspendSessionId, success, ...(success ? { customName } : { error: '挂起会话不存在' }) },
      });
    } catch (error) {
      this.sendJson({
        type: 'SSH_SUSPEND_NAME_EDITED_RESP',
        payload: { suspendSessionId, success: false, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private bindWorkspace(workspaceId: string): void {
    this.workspaceId = workspaceId;
    this.terminalTransport.bindWorkspace(workspaceId);
    this.eventUnsubscribe?.();
    this.eventUnsubscribe = this.dependencies.events.subscribe(workspaceId, (event) => this.forwardEvent(event));
  }

  private forwardEvent(event: WorkspaceEvent): void {
    if (event.type === 'terminal-output') {
      this.terminalTransport.queueOutput(event.data);
      return;
    }
    const message = mapLegacyWorkspaceEvent(event);
    if (message) this.sendJson(message);
    if (event.type === 'terminal-closed' || event.type === 'terminal-error') {
      const workspaceId = this.workspaceId;
      if (workspaceId) void this.dependencies.suspendCoordinator.closeWorkspace(workspaceId).catch(() => undefined);
    }
  }

  private sendJson(message: LegacyWorkspaceJsonMessage): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private requireWorkspace(): string {
    const workspaceId = this.workspaceId;
    if (!workspaceId) throw new Error('无效的会话');
    const session = this.dependencies.workspace.getSession(workspaceId);
    if (!session || session.userId !== this.identity.userId) throw new Error('无效的会话');
    return workspaceId;
  }

  private requirePath(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value) throw new Error(`Missing '${name}' in payload`);
    return value;
  }
}
