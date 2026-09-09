import type { RemoteExecutionTransport, RemoteShellSession } from '../../platform/execution/remote-execution.port';
import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { ConnectionService } from '../connections/connection.service';
import type { SshConnectionResolver } from '../connections/services/ssh-connection-resolver.service';
import type { AuditLogService } from '../audit/audit.service';
import type { NotificationService } from '../notifications/notification.service';
import type { WorkspaceSession } from './workspace-session';
import type { WorkspaceSessionRegistry } from './workspace-session-registry';

export interface ConnectWorkspaceRequest {
  workspaceId: string;
  userId: number;
  connectionId: number;
  columns?: number;
  rows?: number;
  actorUsername?: string;
  clientIp?: string;
  signal?: AbortSignal;
}

export interface AttachWorkspaceRequest {
  workspaceId: string;
  userId: number;
  connectionId: number;
  connectionName: string;
  transport: RemoteExecutionTransport;
  shell: RemoteShellSession;
}

export interface DetachedWorkspace {
  session: WorkspaceSession;
  transport: RemoteExecutionTransport;
}

/** Owns Workspace ↔ ExecutionSession lifecycle; protocol handlers never manipulate transports directly. */
export class WorkspaceService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly executionSessions: ExecutionSessionManager,
    private readonly resolver: SshConnectionResolver,
    private readonly connections: ConnectionService,
    private readonly audit: AuditLogService,
    private readonly notifications: NotificationService,
  ) {}

  getSession(id: string) {
    return this.sessions.get(id);
  }
  requireSession(id: string) {
    return this.sessions.require(id);
  }
  listUserSessions(userId: number) {
    return this.sessions.listByUser(userId);
  }
  listAllSessions() {
    return this.sessions.snapshot();
  }
  canCreate(id: string): boolean {
    return Boolean(id) && !this.sessions.get(id) && !this.executionSessions.get(id);
  }

  async connect(request: ConnectWorkspaceRequest): Promise<WorkspaceSession> {
    if (!request.workspaceId) throw new Error('workspaceId is required.');
    const connection = await this.connections.get(request.connectionId);
    if (!connection) throw new Error(`Connection ${request.connectionId} was not found.`);
    if (connection.type !== 'SSH') throw new Error(`Connection ${request.connectionId} is not an SSH connection.`);
    let execution;
    try {
      const resolved = await this.resolver.resolveStored(request.connectionId);
      execution = await this.executionSessions.connect({
        id: request.workspaceId,
        ownerType: 'workspace',
        ownerId: String(request.userId),
        connection: resolved,
        connect: { signal: request.signal },
      });
    } catch (error) {
      const details = {
        userId: request.userId,
        username: request.actorUsername,
        connectionId: request.connectionId,
        connectionName: connection.name || connection.host,
        ip: request.clientIp,
        reason: error instanceof Error ? error.message : String(error),
      };
      await this.audit.logAction('SSH_CONNECT_FAILURE', details).catch(() => undefined);
      await this.notifications.publish('SSH_CONNECT_FAILURE', details).catch(() => undefined);
      throw error;
    }
    try {
      const shell = await execution.openShell({ columns: request.columns, rows: request.rows });
      const session: WorkspaceSession = {
        id: request.workspaceId,
        userId: request.userId,
        connectionId: request.connectionId,
        connectionName: connection.name || connection.host,
        executionSessionId: execution.id,
        shell,
        createdAt: Date.now(),
      };
      this.sessions.set(session);
      await this.connections.markConnected(request.connectionId).catch(() => false);
      const details = {
        userId: request.userId,
        username: request.actorUsername,
        connectionId: request.connectionId,
        connectionName: session.connectionName,
        sessionId: session.id,
        ip: request.clientIp,
      };
      await this.audit.logAction('SSH_CONNECT_SUCCESS', details).catch(() => undefined);
      await this.notifications.publish('SSH_CONNECT_SUCCESS', details).catch(() => undefined);
      return session;
    } catch (error) {
      await this.executionSessions.close(execution.id).catch(() => undefined);
      const details = {
        userId: request.userId,
        username: request.actorUsername,
        connectionId: request.connectionId,
        connectionName: connection.name || connection.host,
        sessionId: request.workspaceId,
        ip: request.clientIp,
        reason: error instanceof Error ? error.message : String(error),
      };
      await this.audit.logAction('SSH_SHELL_FAILURE', details).catch(() => undefined);
      await this.notifications.publish('SSH_SHELL_FAILURE', details).catch(() => undefined);
      throw error;
    }
  }

  attach(request: AttachWorkspaceRequest): WorkspaceSession {
    const execution = this.executionSessions.attach({
      id: request.workspaceId,
      connectionId: request.connectionId,
      ownerType: 'workspace',
      ownerId: String(request.userId),
      transport: request.transport,
    });
    try {
      const session: WorkspaceSession = {
        id: request.workspaceId,
        userId: request.userId,
        connectionId: request.connectionId,
        connectionName: request.connectionName,
        executionSessionId: execution.id,
        shell: request.shell,
        createdAt: Date.now(),
      };
      this.sessions.set(session);
      return session;
    } catch (error) {
      this.executionSessions.detach(execution.id);
      throw error;
    }
  }

  detach(id: string): DetachedWorkspace | null {
    const session = this.sessions.delete(id);
    if (!session) return null;
    const transport = this.executionSessions.detach(session.executionSessionId);
    return { session, transport };
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.delete(id);
    if (!session) return;
    try {
      session.shell.close();
    } catch {
      /* transport close is the backstop */
    }
    await this.executionSessions.close(session.executionSessionId);
  }
  async closeAll(): Promise<void> {
    for (const session of [...this.sessions.snapshot()]) await this.closeSession(session.id);
  }
}
