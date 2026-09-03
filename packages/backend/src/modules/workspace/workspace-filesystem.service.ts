import { SftpFileSystem } from '../../infrastructure/ssh/sftp/sftp-file-system';
import { FileRemovalService } from '../../platform/filesystem/file-removal.service';
import type { WorkspaceSftpSessionService } from './services/workspace-sftp-session.service';
import type { WorkspaceSession } from './workspace-session';
import type { WorkspaceSessionRegistry } from './workspace-session-registry';

export interface WorkspaceFilesystemTarget {
  sessionId: string;
  filesystem: SftpFileSystem;
  removal: FileRemovalService;
}

/** Resolves an authenticated user's active Workspace into the reusable filesystem facade. */
export class WorkspaceFilesystemService {
  private readonly pendingInitializations = new Map<string, Promise<void>>();

  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly sftpSessions: WorkspaceSftpSessionService,
  ) {}

  forSession(sessionId: string): WorkspaceFilesystemTarget | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.executionSession.isReady) return null;
    return this.createTarget(sessionId, session);
  }

  async resolveActive(
    userId: number,
    connectionId: number,
    requestedSessionId?: string,
  ): Promise<WorkspaceFilesystemTarget | null> {
    if (requestedSessionId) {
      const exact = this.sessions.get(requestedSessionId);
      if (this.matches(exact, userId, connectionId) && await this.ensureReady(requestedSessionId, exact!)) {
        return this.createTarget(requestedSessionId, exact!);
      }
    }

    for (const [sessionId, session] of this.sessions.entries()) {
      if (!this.matches(session, userId, connectionId)) continue;
      if (await this.ensureReady(sessionId, session)) return this.createTarget(sessionId, session);
    }
    return null;
  }

  private createTarget(sessionId: string, session: WorkspaceSession): WorkspaceFilesystemTarget {
    return {
      sessionId,
      filesystem: new SftpFileSystem(session.executionSession),
      removal: new FileRemovalService(session.executionSession),
    };
  }

  private matches(session: WorkspaceSession | undefined, userId: number, connectionId: number): session is WorkspaceSession {
    return Boolean(session && session.ws.userId === userId && session.dbConnectionId === connectionId);
  }

  private async ensureReady(sessionId: string, session: WorkspaceSession): Promise<boolean> {
    if (session.executionSession.sftp.control) return true;
    if (!session.executionSession.isReady) return false;

    let pending = this.pendingInitializations.get(sessionId);
    if (!pending) {
      pending = this.sftpSessions.initialize(sessionId);
      this.pendingInitializations.set(sessionId, pending);
    }
    try {
      await pending;
    } catch (error) {
      console.error(`[WorkspaceFilesystem ${sessionId}] failed to initialize control SFTP channel:`, error);
    } finally {
      if (this.pendingInitializations.get(sessionId) === pending) this.pendingInitializations.delete(sessionId);
    }
    return Boolean(session.executionSession.sftp.control);
  }
}
