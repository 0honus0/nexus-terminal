import type { ExecutionSessionManager } from '../../platform/execution/execution-session-manager';
import type { WorkspaceSessionRegistry } from './workspace-session-registry';

export class WorkspaceService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly executionSessions: ExecutionSessionManager,
  ) {}

  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  listUserSessions(userId: number) {
    return this.sessions.listByUser(userId);
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.delete(sessionId);
    if (!session) return;
    await this.executionSessions.close(session.executionSessionId);
  }
}
