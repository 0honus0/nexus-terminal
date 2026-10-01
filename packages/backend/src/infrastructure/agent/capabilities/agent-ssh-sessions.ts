import { randomUUID } from 'node:crypto';
import type { Scope } from '../../../modules/agent/agent.types';
import type {
  AgentSshSessionPort,
  AgentSshSessionView,
  SshJobView,
} from '../../../modules/agent/capabilities/ssh-session.port';
import type { AgentConnectionResolverPort } from '../../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type { ExecutionSession } from '../../../platform/execution/execution-session';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import type { RemoteCommandSession } from '../../../platform/execution/remote-execution.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import { logger } from '../../../shared/logging/logger';

interface Entry {
  scope: Scope;
  threadId: string;
  hash: string;
  session: ExecutionSession;
  view: AgentSshSessionView;
}

const assertActive = (context: ToolContext): void => {
  context.signal.throwIfAborted();
  if (Date.now() >= context.deadlineAt * 1000) throw new Error('TOOL_TIMEOUT');
};

/** Owns Agent-only transports; borrowing never attaches to a user's terminal. */
export class AgentSshSessions implements AgentSshSessionPort {
  private readonly entries = new Map<string, Entry>();
  private readonly jobs = new Map<
    string,
    {
      entry: Entry;
      command: RemoteCommandSession;
      view: SshJobView;
      done: Promise<void>;
      settle: (status: SshJobView['status']) => Promise<void>;
    }
  >();
  private stopped = false;
  private sweepTimer?: ReturnType<typeof setInterval>;
  private readonly pendingJobs = new Map<number, number>();

  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly sessions: ExecutionSessionManager,
    private readonly database: RelationalDatabase,
    private readonly validateOwner: (scope: Scope, threadId: string, connectionId: number) => Promise<boolean>,
  ) {}

  async initialize(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.database.execute(
      "UPDATE agent_ssh_jobs SET status = 'unknown', completed_at = ? WHERE status = 'running'",
      [Date.now()],
    );
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch((error) => logger.warn({ err: error }, 'Agent SSH session sweep failed'));
    }, 10000);
    this.sweepTimer.unref?.();
  }

  async open(
    context: ToolContext,
    connectionId: number,
    configurationHash: string,
    idleTimeoutSeconds: number,
  ): Promise<AgentSshSessionView> {
    assertActive(context);
    if (
      !context.threadId ||
      !Number.isSafeInteger(idleTimeoutSeconds) ||
      idleTimeoutSeconds < 0 ||
      idleTimeoutSeconds > 86400
    )
      throw new Error('TOOL_ARGUMENTS_INVALID');
    await this.check(context, connectionId, configurationHash);
    if (!(await this.validateOwner(context, context.threadId, connectionId))) throw new Error('RESOURCE_FORBIDDEN');
    if (this.stopped || this.entries.size >= 128) throw new Error('SSH_SESSION_LIMIT');
    if ([...this.entries.values()].filter((e) => e.scope.userId === context.userId).length >= 32)
      throw new Error('SSH_SESSION_LIMIT');
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.threadId,
      connection: await this.connections.resolve(connectionId, configurationHash),
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      assertActive(context);
      await this.check(context, connectionId, configurationHash);
      if (!(await this.validateOwner(context, context.threadId, connectionId))) throw new Error('RESOURCE_FORBIDDEN');
      assertActive(context);
      if (this.stopped) throw new Error('SSH_SESSION_CLOSED');
      if (
        this.entries.size >= 128 ||
        [...this.entries.values()].filter((e) => e.scope.userId === context.userId).length >= 32
      )
        throw new Error('SSH_SESSION_LIMIT');
      const now = Date.now();
      const entry: Entry = {
        scope: { userId: context.userId, appId: context.appId },
        threadId: context.threadId,
        hash: configurationHash,
        session,
        view: {
          sessionId: session.id,
          connectionId,
          status: 'ready',
          activeOperations: 0,
          createdAt: now,
          lastUsedAt: now,
          idleTimeoutSeconds,
        },
      };
      this.entries.set(session.id, entry);
      session.onTransportClose(() => {
        entry.view.status = 'disconnected';
      });
      return { ...entry.view };
    } catch (error) {
      await this.sessions.close(session.id);
      throw error;
    }
  }

  async withSession<T>(
    context: ToolContext,
    connectionId: number,
    hash: string | undefined,
    work: (session: ExecutionSession) => Promise<T>,
  ): Promise<T> {
    assertActive(context);
    await this.check(context, connectionId, hash);
    if (!context.sshSessionId) {
      const session = await this.sessions.connect({
        ownerType: 'agent',
        ownerId: context.agentRuntimeId,
        connection: await this.connections.resolve(connectionId, hash),
        connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
      });
      try {
        assertActive(context);
        return await work(session);
      } finally {
        await this.sessions.close(session.id);
      }
    }
    const entry = this.owned(context, connectionId, context.sshSessionId);
    assertActive(context);
    if (hash !== undefined && entry.hash !== hash) throw new Error('RESOURCE_CHANGED');
    if (!this.entries.has(entry.session.id) || !entry.session.isReady) throw new Error('SSH_SESSION_DISCONNECTED');
    entry.view.activeOperations += 1;
    try {
      return await work(entry.session);
    } finally {
      entry.view.activeOperations -= 1;
      entry.view.lastUsedAt = Date.now();
    }
  }

  async list(context: ToolContext, connectionId: number, sessionId?: string): Promise<AgentSshSessionView[]> {
    assertActive(context);
    await this.check(context, connectionId);
    if (!context.threadId || !(await this.validateOwner(context, context.threadId, connectionId)))
      throw new Error('RESOURCE_FORBIDDEN');
    const entries = sessionId
      ? [this.owned(context, connectionId, sessionId)]
      : [...this.entries.values()].filter((e) => this.matches(e, context) && e.view.connectionId === connectionId);
    return entries.map((e) => ({ ...e.view, status: e.session.isReady ? 'ready' : 'disconnected' }));
  }

  async close(context: ToolContext, connectionId: number, sessionId: string, force: boolean): Promise<void> {
    assertActive(context);
    const entry = this.owned(context, connectionId, sessionId);
    await this.check(context, connectionId, entry.hash);
    if (!this.entries.has(sessionId)) throw new Error('SSH_SESSION_NOT_FOUND');
    if (!force && entry.view.activeOperations) throw new Error('SSH_SESSION_BUSY');
    await this.remove(entry);
  }

  async startJob(
    context: ToolContext,
    connectionId: number,
    hash: string,
    sessionId: string,
    command: string,
    timeoutSeconds: number,
    operationHash: string,
  ): Promise<SshJobView> {
    assertActive(context);
    if (
      !command ||
      command.includes('\0') ||
      Buffer.byteLength(command) > 32768 ||
      !Number.isSafeInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 86400
    )
      throw new Error('TOOL_ARGUMENTS_INVALID');
    await this.check(context, connectionId, hash);
    const entry = this.owned(context, connectionId, sessionId);
    if (!entry.session.isReady) throw new Error('SSH_SESSION_DISCONNECTED');
    if (entry.hash !== hash) throw new Error('RESOURCE_CHANGED');
    if (!(await this.validateOwner(context, entry.threadId, connectionId))) throw new Error('RESOURCE_FORBIDDEN');
    if (!this.entries.has(sessionId)) throw new Error('SSH_SESSION_NOT_FOUND');
    assertActive(context);
    const pending = this.pendingJobs.get(context.userId) ?? 0;
    if (pending + [...this.jobs.values()].filter((j) => j.entry.scope.userId === context.userId).length >= 32)
      throw new Error('SSH_JOB_LIMIT');
    this.pendingJobs.set(context.userId, pending + 1);
    const jobId = `ssh-job-${randomUUID()}`;
    const view: SshJobView = {
      jobId,
      sessionId,
      connectionId,
      configurationHash: hash,
      status: 'running',
      result: { exitCode: null, signal: null, stdout: '', stderr: '', truncated: false, timedOut: false },
      createdAt: Date.now(),
      completedAt: null,
    };
    entry.view.activeOperations += 1;
    let remote: RemoteCommandSession;
    try {
      await this.database.execute(
        'INSERT INTO agent_ssh_jobs (job_id,user_id,app_id,thread_id,connection_id,configuration_hash,session_id,operation_hash,status,result_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [
          jobId,
          context.userId,
          context.appId,
          entry.threadId,
          connectionId,
          hash,
          sessionId,
          operationHash,
          'running',
          JSON.stringify(view.result),
          view.createdAt,
        ],
      );
      assertActive(context);
      if (!this.entries.has(sessionId)) throw new Error('SSH_SESSION_NOT_FOUND');
      remote = await new Promise<RemoteCommandSession>((resolve, reject) => {
        let expired = false;
        const cleanup = () => {
          clearTimeout(timer);
          context.signal.removeEventListener('abort', abort);
        };
        const abort = () => {
          expired = true;
          cleanup();
          reject(new DOMException('SSH submission aborted', 'AbortError'));
        };
        const timer = setTimeout(
          () => {
            expired = true;
            cleanup();
            reject(new Error('SSH_JOB_OUTCOME_UNKNOWN'));
          },
          Math.max(1, context.deadlineAt * 1000 - Date.now()),
        );
        context.signal.addEventListener('abort', abort, { once: true });
        void entry.session
          .startCommand({ command, maxOutputBytes: Math.max(1, Math.min(256 * 1024, context.maxOutputBytes)) })
          .then(
            (commandSession) => {
              cleanup();
              if (expired || !this.entries.has(sessionId)) {
                void commandSession
                  .terminate()
                  .catch((error) => logger.warn({ err: error, jobId }, 'Late SSH submission teardown failed'));
                reject(new Error('SSH_JOB_OUTCOME_UNKNOWN'));
              } else resolve(commandSession);
            },
            (error) => {
              cleanup();
              reject(error);
            },
          );
      });
    } catch (error) {
      entry.view.activeOperations -= 1;
      await this.database.execute("UPDATE agent_ssh_jobs SET status='unknown', completed_at=? WHERE job_id=?", [
        Date.now(),
        jobId,
      ]);
      throw error;
    } finally {
      const count = (this.pendingJobs.get(context.userId) ?? 1) - 1;
      if (count) this.pendingJobs.set(context.userId, count);
      else this.pendingJobs.delete(context.userId);
    }
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const job = { entry, command: remote, view, done, settle: async (_status: SshJobView['status']) => {} };
    this.jobs.set(jobId, job);
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const off: Array<() => void> = [];
    const settle = async (status: SshJobView['status']) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      off.forEach((f) => f());
      view.status = status;
      view.completedAt = Date.now();
      this.output(job);
      entry.view.activeOperations -= 1;
      entry.view.lastUsedAt = Date.now();
      try {
        await this.database.execute('UPDATE agent_ssh_jobs SET status=?,result_json=?,completed_at=? WHERE job_id=?', [
          view.status,
          JSON.stringify(view.result),
          view.completedAt,
          jobId,
        ]);
      } catch (error) {
        view.status = 'unknown';
        logger.error({ err: error, jobId }, 'Agent SSH job settlement failed');
      } finally {
        this.jobs.delete(jobId);
        finish();
      }
    };
    job.settle = settle;
    off.push(
      remote.onClose((event) => {
        void settle(
          typeof event.exitCode !== 'number'
            ? 'unknown'
            : event.exitCode === 0 && !view.result.timedOut
              ? 'succeeded'
              : 'failed',
        );
      }),
    );
    off.push(
      remote.onError(() => {
        void settle('unknown');
      }),
    );
    off.push(
      entry.session.onTransportClose(() => {
        void settle('unknown');
      }),
    );
    timeout = setTimeout(() => {
      view.result.timedOut = true;
      void remote
        .terminate()
        .then(() => settle('unknown'))
        .catch(() => settle('unknown'));
    }, timeoutSeconds * 1000);
    timeout.unref?.();
    return this.output(job);
  }

  async job(
    context: ToolContext,
    connectionId: number,
    jobId: string,
    action: 'status' | 'wait' | 'cancel',
    waitSeconds = 30,
  ): Promise<SshJobView> {
    assertActive(context);
    await this.check(context, connectionId);
    if (!context.threadId || !(await this.validateOwner(context, context.threadId, connectionId)))
      throw new Error('RESOURCE_FORBIDDEN');
    const row = await this.database.queryOne<{
      session_id: string;
      configuration_hash: string;
      status: SshJobView['status'];
      created_at: number;
      completed_at: number | null;
      result_json: string;
    }>(
      'SELECT session_id,configuration_hash,status,created_at,completed_at,result_json FROM agent_ssh_jobs WHERE job_id=? AND user_id=? AND app_id=? AND thread_id=? AND connection_id=?',
      [jobId, context.userId, context.appId, context.threadId, connectionId],
    );
    if (!row) throw new Error('NOT_FOUND');
    const job = this.jobs.get(jobId);
    if (job && (await this.connections.get(connectionId))?.configurationHash !== row.configuration_hash) {
      await this.remove(job.entry);
      throw new Error('RESOURCE_CHANGED');
    }
    if (job && action === 'cancel') {
      try {
        await job.command.terminate();
      } finally {
        await job.settle('unknown');
      }
      await job.done;
    }
    if (job && action === 'wait') {
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          clearTimeout(timer);
          context.signal.removeEventListener('abort', abort);
          resolve();
        };
        const abort = () => {
          clearTimeout(timer);
          context.signal.removeEventListener('abort', abort);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(
          finish,
          Math.max(1, Math.min(waitSeconds * 1000, context.deadlineAt * 1000 - Date.now())),
        );
        context.signal.addEventListener('abort', abort, { once: true });
        if (context.signal.aborted) abort();
        void job.done.then(finish);
      });
    }
    if (job) return this.output(job);
    // Decode persisted bounded output rather than persisting native handles or commands.
    const raw: unknown = JSON.parse(row.result_json);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SSH_JOB_STATE_INVALID');
    const result = raw as Record<string, unknown>;
    if (
      !(result.exitCode === null || Number.isInteger(result.exitCode)) ||
      !(result.signal === null || typeof result.signal === 'string') ||
      typeof result.stdout !== 'string' ||
      typeof result.stderr !== 'string' ||
      typeof result.truncated !== 'boolean' ||
      typeof result.timedOut !== 'boolean'
    )
      throw new Error('SSH_JOB_STATE_INVALID');
    return {
      jobId,
      sessionId: row.session_id,
      connectionId,
      configurationHash: row.configuration_hash,
      status: row.status,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      result: {
        exitCode: result.exitCode as number | null,
        signal: result.signal as string | null,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        timedOut: result.timedOut,
      },
    };
  }

  async sweep(): Promise<void> {
    for (const entry of this.entries.values()) {
      const invalid =
        !(await this.validateOwner(entry.scope, entry.threadId, entry.view.connectionId)) ||
        (await this.connections.get(entry.view.connectionId))?.configurationHash !== entry.hash;
      if (
        invalid ||
        (!entry.view.activeOperations &&
          (!entry.session.isReady ||
            (entry.view.idleTimeoutSeconds > 0 &&
              Date.now() - entry.view.lastUsedAt >= entry.view.idleTimeoutSeconds * 1000)))
      ) {
        // Authorization/configuration checks above await; recheck activity immediately before idle cleanup.
        if (invalid || !entry.view.activeOperations) await this.remove(entry);
      }
    }
  }

  async closeScope(scope: Scope, threadId?: string): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter(
          (e) =>
            e.scope.userId === scope.userId &&
            e.scope.appId === scope.appId &&
            (threadId === undefined || e.threadId === threadId),
        )
        .map((e) => this.remove(e)),
    );
  }

  async dispose(): Promise<void> {
    this.stopped = true;
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await Promise.all([...this.entries.values()].map((e) => this.remove(e)));
    await Promise.all([...this.jobs.values()].map((j) => j.done));
  }

  private output(job: { command: RemoteCommandSession; view: SshJobView }): SshJobView {
    const snapshot = job.command.snapshot();
    job.view.result = {
      ...job.view.result,
      exitCode: snapshot.exitCode ?? null,
      signal: snapshot.signal ?? null,
      stdout: snapshot.stdout,
      stderr: snapshot.stderr,
      truncated: snapshot.outputTruncated,
    };
    return { ...job.view, result: { ...job.view.result } };
  }

  private matches(entry: Entry, context: ToolContext): boolean {
    return (
      entry.scope.userId === context.userId &&
      entry.scope.appId === context.appId &&
      entry.threadId === context.threadId
    );
  }
  private owned(context: ToolContext, connectionId: number, sessionId: string): Entry {
    const entry = this.entries.get(sessionId);
    if (!entry || !this.matches(entry, context)) throw new Error('SSH_SESSION_NOT_FOUND');
    if (entry.view.connectionId !== connectionId || !context.connectionIds.includes(connectionId))
      throw new Error('TARGET_NOT_SELECTED');
    return entry;
  }
  private async check(context: ToolContext, connectionId: number, hash?: string): Promise<void> {
    if (!context.connectionIds.includes(connectionId)) throw new Error('TARGET_NOT_SELECTED');
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    if (hash !== undefined && hash !== connection.configurationHash) throw new Error('RESOURCE_CHANGED');
    if (
      context.threadId &&
      context.sshSessionId &&
      !(await this.validateOwner(context, context.threadId, connectionId))
    )
      throw new Error('RESOURCE_FORBIDDEN');
  }
  private async remove(entry: Entry): Promise<void> {
    this.entries.delete(entry.session.id);
    const settling = [...this.jobs.values()].filter((j) => j.entry === entry).map((j) => j.settle('unknown'));
    await Promise.all([this.sessions.close(entry.session.id), ...settling]);
  }
}
