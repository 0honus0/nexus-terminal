import type { WorkspaceSession } from './workspace-session';

/** Owns interactive Workspace runtime sessions; no Agent/System sessions live here. */
export class WorkspaceSessionRegistry {
  private readonly sessions = new Map<string, WorkspaceSession>();

  get size(): number {
    return this.sessions.size;
  }

  get(sessionId: string): WorkspaceSession | undefined {
    return this.sessions.get(sessionId);
  }

  require(sessionId: string): WorkspaceSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Workspace session ${sessionId} is not active.`);
    return session;
  }

  set(sessionId: string, session: WorkspaceSession): void {
    if (this.sessions.has(sessionId)) throw new Error(`Workspace session ${sessionId} already exists.`);
    this.sessions.set(sessionId, session);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  entries(): IterableIterator<[string, WorkspaceSession]> {
    return this.sessions.entries();
  }

  values(): IterableIterator<WorkspaceSession> {
    return this.sessions.values();
  }

  forEach(callback: (session: WorkspaceSession, sessionId: string) => void): void {
    this.sessions.forEach((session, sessionId) => callback(session, sessionId));
  }
}

export const workspaceSessionRegistry = new WorkspaceSessionRegistry();
