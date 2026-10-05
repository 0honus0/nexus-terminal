import type { ProjectDirectoryPort } from '../../ai/project-directory.port';
import type { SshTargetResolverPort } from '../../capabilities/ssh-target-resolver.port';
import type { AgentTool } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

export const createProjectDirectoryTools = (
  projects: ProjectDirectoryPort,
  targets: SshTargetResolverPort,
  cryptoHash: CryptoHashPort,
): AgentTool[] =>
  (['bind', 'read', 'clear'] as const).map((action) => ({
    descriptor: {
      name: `project_directory_${action}`,
      version: '1.0.0',
      modelExposure: 'deferred',
      description: `${action} a conversation-owned SSH project directory. Bind an absolute directory before working on a remote project; AGENTS.md and AGENT.md (case-insensitive) are loaded as scoped project guidance. This does not change shell cwd or grant permissions.`,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          connectionId: { type: 'integer', minimum: 1 },
          ...(action === 'bind' ? { directory: { type: 'string', minLength: 1, maxLength: 4096 } } : {}),
        },
        required: action === 'bind' ? ['connectionId', 'directory'] : ['connectionId'],
      },
      capability: 'file.read',
      riskClass: action === 'read' ? 'read' : 'mutate',
    },
    isAvailable: ({ connectionIds }) => connectionIds === undefined || connectionIds.length > 0,
    inspect: async (input, context, policyRevision) => {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        !context.threadId ||
        Object.keys(input).some(
          (key) => !['connectionId', ...(action === 'bind' ? ['directory'] : [])].includes(key),
        ) ||
        !Number.isSafeInteger(input.connectionId) ||
        Number(input.connectionId) < 1 ||
        (action === 'bind' &&
          (typeof input.directory !== 'string' ||
            !input.directory.startsWith('/') ||
            input.directory.length > 4096 ||
            input.directory.includes('\0')))
      )
        throw new Error('TOOL_ARGUMENTS_INVALID');
      const target = await targets.target(context, Number(input.connectionId));
      const normalizedArguments = {
        connectionId: Number(input.connectionId),
        ...(action === 'bind' ? { directory: String(input.directory) } : {}),
      };
      return {
        toolName: `project_directory_${action}`,
        toolVersion: '1.0.0',
        normalizedArguments,
        target,
        resourceKeys: [
          `project-directory:${context.userId}:${context.appId}:${context.threadId}:${input.connectionId}`,
        ],
        risk: action === 'read' ? 'read' : 'mutate',
        mutation: action !== 'read',
        preconditions: [],
        operationHash: hashOperation(
          {
            tool: `project_directory_${action}`,
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
        inputRevision: context.inputRevision,
        policyRevision,
      };
    },
    execute: async (inspection, context) => {
      const args = inspection.normalizedArguments;
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('TOOL_ARGUMENTS_INVALID');
      const connectionId = Number(args.connectionId);
      if (action === 'bind')
        await projects.bind(context, {
          connectionId,
          directory: String(args.directory),
          configurationHash: inspection.target.configurationHash,
        });
      if (action === 'clear') await projects.clear(context, connectionId);
      const binding = await projects.read(context, connectionId);
      return {
        ok: true,
        summary: `Project directory ${action} completed.`,
        data: { binding: binding ? { ...binding } : null },
        artifactRefs: [],
        truncated: false,
        outcome: 'confirmed',
        verification: {
          status: 'verified',
          summary: 'Conversation project binding confirmed; no remote files modified.',
          evidenceRefs: [],
        },
      };
    },
  }));
