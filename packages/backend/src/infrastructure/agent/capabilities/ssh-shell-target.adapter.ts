import type { AgentConnectionResolverPort } from '../../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type {
  SshShellExecutionResult,
  SshShellTargetPort,
} from '../../../modules/agent/capabilities/ssh-shell-target.port';
import type { ExecutionSession } from '../../../platform/execution/execution-session';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';

const MAX_SHELL_BYTES = 16 * 1024;

const assertDeadline = (context: ToolContext): void => {
  if (context.signal.aborted) throw new DOMException('Agent machine operation aborted.', 'AbortError');
  if (Math.floor(Date.now() / 1000) >= context.deadlineAt) throw new Error('TOOL_TIMEOUT');
};

const assertConnectionSelected = (context: ToolContext, connectionId: number): void => {
  if (!context.connectionIds.includes(connectionId)) throw new Error('TARGET_NOT_SELECTED');
};

export class SshShellTargetAdapter implements SshShellTargetPort {
  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly sessions: ExecutionSessionManager,
  ) {}

  async execute(
    context: ToolContext,
    connectionId: number,
    command: string,
    timeoutSeconds: number,
    expectedConfigurationHash: string,
  ): Promise<SshShellExecutionResult> {
    assertDeadline(context);
    if (
      typeof command !== 'string' ||
      command.length < 1 ||
      command.includes('\0') ||
      Buffer.byteLength(command, 'utf8') > MAX_SHELL_BYTES ||
      !Number.isSafeInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 300
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const remainingMs = Math.max(1, context.deadlineAt * 1000 - Date.now());
        const result = await session.execute({
          command,
          timeoutMs: Math.min(timeoutSeconds * 1000, remainingMs),
          maxOutputBytes: context.maxOutputBytes,
          signal: context.signal,
        });
        return {
          exitCode: result.exitCode,
          signal: result.signal ?? null,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated,
        };
      },
      expectedConfigurationHash,
    );
  }

  private async withSession<T>(
    context: ToolContext,
    connectionId: number,
    work: (session: ExecutionSession) => Promise<T>,
    expectedConfigurationHash?: string,
  ): Promise<T> {
    assertDeadline(context);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    assertConnectionSelected(context, connectionId);
    const safe = await this.connections.get(connectionId);
    if (!safe || safe.type !== 'SSH') throw new Error('NOT_FOUND');
    if (expectedConfigurationHash !== undefined && safe.configurationHash !== expectedConfigurationHash) {
      throw new Error('RESOURCE_CHANGED');
    }
    const resolved = await this.connections.resolve(connectionId, expectedConfigurationHash);
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.agentRuntimeId,
      connection: resolved,
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      assertDeadline(context);
      return await work(session);
    } finally {
      await this.sessions.close(session.id).catch(() => undefined);
    }
  }
}
