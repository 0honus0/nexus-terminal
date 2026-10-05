import type { JsonValue } from '../../agent.types';
import type { AgentSshSessionPort } from '../../capabilities/ssh-session.port';
import type { SshTargetResolverPort } from '../../capabilities/ssh-target-resolver.port';
import type { AgentTool } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

export const createSshSessionTools = (
  sessions: AgentSshSessionPort,
  targets: SshTargetResolverPort,
  cryptoHash: CryptoHashPort,
): AgentTool[] =>
  (['open', 'list', 'close'] as const).map((action) => ({
    descriptor: {
      name: `ssh_session_${action}`,
      version: '1.0.0',
      modelExposure: 'deferred',
      description:
        action === 'open'
          ? 'Open a conversation-owned SSH connection for multiple independent commands and file operations. Default idle expiry is 1800 seconds; 0 disables idle expiry. No persistent shell state.'
          : action === 'list'
            ? 'List SSH sessions for a selected connection in this conversation, or inspect one session.'
            : 'Close and remove an SSH session. Busy sessions reject ordinary close; force explicitly interrupts all operations with possibly unknown remote outcomes.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          connectionId: { type: 'integer', minimum: 1 },
          ...(action === 'open'
            ? { idleTimeoutSeconds: { type: 'integer', minimum: 0, maximum: 86400 } }
            : {
                sessionId: { type: 'string', minLength: 1, maxLength: 128 },
                ...(action === 'close' ? { force: { type: 'boolean' } } : {}),
              }),
        },
        required: action === 'close' ? ['connectionId', 'sessionId'] : ['connectionId'],
      },
      riskClass: action === 'list' ? 'read' : action === 'close' ? 'mutate' : 'control',
      capability: 'shell.execute',
    },
    isAvailable: ({ connectionIds }) => connectionIds === undefined || connectionIds.length > 0,
    inspect: async (input, context, policyRevision) => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('TOOL_ARGUMENTS_INVALID');
      const allowed =
        action === 'open'
          ? ['connectionId', 'idleTimeoutSeconds']
          : action === 'list'
            ? ['connectionId', 'sessionId']
            : ['connectionId', 'sessionId', 'force'];
      if (
        Object.keys(input).some((k) => !allowed.includes(k)) ||
        !Number.isSafeInteger(input.connectionId) ||
        Number(input.connectionId) < 1
      )
        throw new Error('TOOL_ARGUMENTS_INVALID');
      if (
        input.sessionId !== undefined &&
        (typeof input.sessionId !== 'string' ||
          !input.sessionId ||
          input.sessionId.length > 128 ||
          input.sessionId.includes('\0'))
      )
        throw new Error('TOOL_ARGUMENTS_INVALID');
      if (action === 'close' && input.sessionId === undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
      if (input.force !== undefined && typeof input.force !== 'boolean') throw new Error('TOOL_ARGUMENTS_INVALID');
      const idle = input.idleTimeoutSeconds ?? 1800;
      if (!Number.isSafeInteger(idle) || Number(idle) < 0 || Number(idle) > 86400)
        throw new Error('TOOL_ARGUMENTS_INVALID');
      const target = await targets.target(context, Number(input.connectionId));
      if (action !== 'open' && input.sessionId !== undefined)
        await sessions.list(context, Number(input.connectionId), String(input.sessionId));
      const normalizedArguments: JsonValue = {
        connectionId: Number(input.connectionId),
        ...(action === 'open'
          ? { idleTimeoutSeconds: Number(idle) }
          : {
              ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
              ...(action === 'close' ? { force: input.force ?? false } : {}),
            }),
      };
      const resourceKeys = [
        `ssh-session:${context.userId}:${context.appId}:${context.threadId}:${input.sessionId ?? 'open'}`,
      ];
      return {
        toolName: `ssh_session_${action}`,
        toolVersion: '1.0.0',
        normalizedArguments,
        target,
        resourceKeys,
        preconditions: [],
        risk:
          action === 'list'
            ? 'read'
            : action === 'close'
              ? input.force === true
                ? 'destructive'
                : 'mutate'
              : 'control',
        mutation: action === 'close',
        operationHash: hashOperation(
          {
            tool: `ssh_session_${action}`,
            target: { ...target },
            arguments: normalizedArguments,
            userId: context.userId,
            appId: context.appId,
            runId: context.runId,
            inputRevision: context.inputRevision,
            policyRevision,
          },
          cryptoHash,
        ),
        operationHashVersion: 1,
        policyRevision,
        inputRevision: context.inputRevision,
      };
    },
    execute: async (inspection, context) => {
      const args = inspection.normalizedArguments as Record<string, JsonValue>;
      const connectionId = Number(args.connectionId);
      const data: JsonValue =
        action === 'open'
          ? {
              session: {
                ...(await sessions.open(
                  context,
                  connectionId,
                  inspection.target.configurationHash,
                  Number(args.idleTimeoutSeconds),
                )),
              },
            }
          : action === 'list'
            ? {
                sessions: (
                  await sessions.list(
                    context,
                    connectionId,
                    args.sessionId === undefined ? undefined : String(args.sessionId),
                  )
                ).map((s) => ({ ...s })),
              }
            : (await sessions.close(context, connectionId, String(args.sessionId), args.force === true),
              { sessionId: String(args.sessionId), closed: true });
      return {
        ok: true,
        summary: `SSH session ${action} completed.`,
        userSummary: { key: `agent.conversation.toolSummary.sshSession${action[0]!.toUpperCase()}${action.slice(1)}` },
        data,
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary: 'The Agent SSH session manager confirmed the operation.',
          evidenceRefs: [],
        },
      };
    },
  }));
