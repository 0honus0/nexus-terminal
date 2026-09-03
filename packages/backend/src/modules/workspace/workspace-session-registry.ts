import type { WorkspaceSession } from './workspace-session';

export class WorkspaceSessionRegistry {
  private readonly sessions = new Map<string, WorkspaceSession>();
  get(id: string) {
    return this.sessions.get(id);
  }
  require(id: string): WorkspaceSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Workspace session ${id} was not found.`);
    return session;
  }
  set(session: WorkspaceSession): void {
    if (this.sessions.has(session.id)) throw new Error(`Workspace session ${session.id} already exists.`);
    this.sessions.set(session.id, session);
  }
  delete(id: string) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }
  listByUser(userId: number): readonly WorkspaceSession[] {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }
  entries(): readonly (readonly [string, WorkspaceSession])[] {
    return [...this.sessions.entries()];
  }
  snapshot(): readonly WorkspaceSession[] {
    return [...this.sessions.values()];
  }
}
