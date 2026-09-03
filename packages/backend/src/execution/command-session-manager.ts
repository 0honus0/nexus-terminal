import { v4 as uuidv4 } from 'uuid';
import type { Client } from 'ssh2';
import { CommandSession } from './command-session';

export interface StartCommandSessionOptions {
  id?: string;
  command: string;
}

/**
 * Owns all long-running/streaming SSH exec channels for one ExecutionSession.
 * Closing the parent ExecutionSession closes these command sessions first.
 */
export class CommandSessionManager {
  private readonly sessions = new Map<string, CommandSession>();

  constructor(private readonly client: Client) {}

  async start(options: StartCommandSessionOptions): Promise<CommandSession> {
    const id = options.id ?? uuidv4();
    if (this.sessions.has(id)) throw new Error(`Command session ${id} already exists.`);

    const channel = await new Promise<import('ssh2').ClientChannel>((resolve, reject) => {
      this.client.exec(options.command, (error, stream) => {
        if (error) reject(error);
        else resolve(stream);
      });
    });

    const session = new CommandSession(id, options.command, channel);
    this.sessions.set(id, session);
    const cleanup = () => {
      if (this.sessions.get(id) === session) this.sessions.delete(id);
    };
    session.once('close', cleanup);
    session.once('error', () => {
      // An error may be followed by close; retaining the session until close
      // keeps termination possible. If the channel never closes, closeAll()
      // remains the lifecycle backstop.
    });
    return session;
  }

  get(id: string): CommandSession | undefined {
    return this.sessions.get(id);
  }

  list(): CommandSession[] {
    return [...this.sessions.values()];
  }

  async terminate(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    await session.terminate();
    this.sessions.delete(id);
    return true;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.terminate()));
  }

  closeAllNow(): void {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.destroy();
  }
}
