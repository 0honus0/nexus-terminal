import type { JsonValue } from '../../agent.types';
import type { SkillRegistry } from '../../ai/skill-registry';
import type { AgentTool, ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';

const asRecord = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const skillId = (value: JsonValue | undefined): string => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(value)) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};

export const createSkillReadTool = (skills: SkillRegistry, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'skill_read',
    version: '1.0.0',
    description:
      'Load the full signed instructions for one Skill advertised in the current App context. Use only when that Skill is relevant to the current task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 3, maxLength: 128, pattern: '^[a-z0-9][a-z0-9._-]{2,127}$' },
      },
      required: ['id'],
    },
    riskClass: 'read',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision): Promise<ToolInspection> => {
    const args = asRecord(input);
    if (Object.keys(args).some((key) => key !== 'id')) throw new Error('TOOL_ARGUMENTS_INVALID');
    const id = skillId(args.id);
    const metadata = (await skills.list(context)).find((candidate) => candidate.id === id);
    if (!metadata) throw new Error('NOT_FOUND');
    const normalizedArguments: JsonValue = { id, version: metadata.version, hash: metadata.hash };
    const configurationHash = hashOperation(
      {
        schemaVersion: 1,
        appId: context.appId,
        skill: { id: metadata.id, version: metadata.version, hash: metadata.hash },
      },
      cryptoHash,
    );
    const target = {
      kind: 'run' as const,
      targetIdentity: `run:${context.runId}:skill:${metadata.id}`,
      endpoint: `skill:${metadata.id}`,
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash,
    };
    const resourceKeys = [`app:${context.appId}:skill:${metadata.id}@${metadata.version}`];
    return {
      toolName: 'skill_read',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: hashOperation(
        {
          schemaVersion: 1,
          scope: {
            userId: context.userId,
            appId: context.appId,
            runId: context.runId,
            agentRuntimeId: context.agentRuntimeId,
          },
          tool: { name: 'skill_read', version: '1.0.0' },
          skill: { id: metadata.id, version: metadata.version, hash: metadata.hash },
          policyRevision,
          inputRevision: context.inputRevision,
        },
        cryptoHash,
      ),
      operationHashVersion: 1,
      preconditions: [
        {
          kind: 'metadata',
          key: resourceKeys[0]!,
          observedValue: { version: metadata.version, hash: metadata.hash },
        },
      ],
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context): Promise<ToolResult> => {
    const args = asRecord(inspection.normalizedArguments);
    const id = skillId(args.id);
    if (typeof args.version !== 'string' || typeof args.hash !== 'string') throw new Error('TOOL_ARGUMENTS_INVALID');
    const skill = await skills.load(context, id, args.version);
    if (skill.hash !== args.hash) throw new Error('PLUGIN_SKILL_CHANGED');
    return {
      ok: true,
      summary: `Loaded signed Skill ${skill.name} (${skill.id}).`,
      data: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        body: skill.body,
      },
      artifactRefs: [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: 'Skill content matches the installed signed package file hash.',
        evidenceRefs: [],
      },
    };
  },
});
