import type { WorkspaceSession } from './workspace-session';

export class WorkspaceSessionRegistry {
  private readonly sessions = new Map<string, WorkspaceSession>();

  get(id: string): WorkspaceSession | undefined {
    return this.sessions.get(id);
  }

  set(session: WorkspaceSession): void {
    if (this.sessions.has(session.id)) throw new Error(`Workspace session ${session.id} already exists.`);
    this.sessions.set(session.id, session);
  }

  delete(id: string): WorkspaceSession | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }

  listByUser(userId: number): readonly WorkspaceSession[] {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }

  snapshot(): readonly WorkspaceSession[] {
    return [...this.sessions.values()];
  }
}
