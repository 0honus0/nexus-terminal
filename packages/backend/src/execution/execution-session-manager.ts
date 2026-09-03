import { v4 as uuidv4 } from 'uuid';
import type { Client } from 'ssh2';
import {
  ExecutionSession,
  type ExecutionSessionOwnerType,
} from './execution-session';
import type { ResolvedSshConnection } from '../transport/ssh/ssh-connection.types';
import { sshConnectionFactory } from '../transport/ssh/ssh-connection-factory';

export interface CreateExecutionSessionOptions {
  id?: string;
  connectionId: number;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
  client: Client;
}

export interface ConnectExecutionSessionOptions {
  id?: string;
  connection: ResolvedSshConnection;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Process-local registry for live execution sessions. Persistent Agent task
 * state belongs elsewhere; live SSH transports are intentionally recreatable.
 */
export class ExecutionSessionManager {
  private readonly sessions = new Map<string, ExecutionSession>();

  create(options: CreateExecutionSessionOptions): ExecutionSession {
    const id = options.id ?? uuidv4();
    if (this.sessions.has(id)) throw new Error(`Execution session ${id} already exists.`);
    const session = new ExecutionSession({ ...options, id });
    this.sessions.set(id, session);
    return session;
  }

  async connect(options: ConnectExecutionSessionOptions): Promise<ExecutionSession> {
    const id = options.id ?? uuidv4();
    if (this.sessions.has(id)) throw new Error(`Execution session ${id} already exists.`);

    const client = await sshConnectionFactory.connect(options.connection, options.timeoutMs, options.signal);
    try {
      return this.create({
        id,
        connectionId: options.connection.id,
        ownerType: options.ownerType,
        ownerId: options.ownerId,
        client,
      });
    } catch (error) {
      try {
        client.end();
      } catch {
        // Best effort if session registration fails after transport creation.
      }
      throw error;
    }
  }

  get(id: string): ExecutionSession | undefined {
    return this.sessions.get(id);
  }

  require(id: string): ExecutionSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Execution session ${id} was not found.`);
    return session;
  }

  delete(id: string, close = true): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    if (close) session.close();
  }

  detach(id: string): Client {
    const session = this.require(id);
    const client = session.detachClient();
    this.sessions.delete(id);
    return client;
  }

  closeByOwner(ownerType: ExecutionSessionOwnerType, ownerId?: string): void {
    for (const [id, session] of this.sessions.entries()) {
      if (session.ownerType !== ownerType) continue;
      if (ownerId !== undefined && session.ownerId !== ownerId) continue;
      this.sessions.delete(id);
      session.close();
    }
  }

  closeAll(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  snapshot(): Array<{
    id: string;
    connectionId: number;
    ownerType: ExecutionSessionOwnerType;
    ownerId?: string;
    status: string;
  }> {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      connectionId: session.connectionId,
      ownerType: session.ownerType,
      ownerId: session.ownerId,
      status: session.status,
    }));
  }
}

export const executionSessionManager = new ExecutionSessionManager();
