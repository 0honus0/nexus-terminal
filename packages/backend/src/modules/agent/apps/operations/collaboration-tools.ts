import type { JsonValue } from '../../agent.types';
import type { MemoryService } from '../../ai/memory.service';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AgentTool, ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';
import type { MailboxService } from '../../runtime/collaboration/mailbox.service';
import type { SharedFactsService } from '../../runtime/collaboration/shared-facts.service';
import type { SubagentService } from '../../runtime/collaboration/subagent.service';

const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value ?? null)) as JsonValue;

const result = (summary: string, data: unknown): ToolResult => ({
  ok: true,
  summary,
  data: jsonValue(data),
  artifactRefs: [],
  truncated: false,
  outcome: 'confirmed',
  verification: {
    status: 'verified',
    summary: 'The result was committed to the local Run-scoped collaboration state.',
    evidenceRefs: [],
  },
});

const localInspection = (
  name: string,
  version: string,
  input: JsonValue,
  context: ToolContext,
  policyRevision: number,
  cryptoHash: CryptoHashPort,
  risk: 'read' | 'control',
): ToolInspection => {
  const normalizedArguments = jsonValue(input);
  const configurationHash = hashOperation(
    {
      schemaVersion: 1,
      userId: context.userId,
      appId: context.appId,
      runId: context.runId,
      agentRuntimeId: context.agentRuntimeId,
    },
    cryptoHash,
  );
  return {
    toolName: name,
    toolVersion: version,
    normalizedArguments,
    target: {
      kind: 'run',
      targetIdentity: `run:${context.runId}`,
      endpoint: `nexus://runs/${context.runId}`,
      loginUser: 'agent-runtime',
      configurationHash,
    },
    resourceKeys: [],
    risk,
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
        tool: { name, version },
        target: { configurationHash },
        arguments: normalizedArguments,
        policyRevision,
        inputRevision: context.inputRevision,
      },
      cryptoHash,
    ),
    operationHashVersion: 1,
    preconditions: [],
    secretRefs: [],
    policyRevision,
    inputRevision: context.inputRevision,
  };
};

const delegateTool = (subagents: SubagentService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'delegate_subagent',
    version: '1',
    description:
      'Create a bounded child agent for a specific objective using a configured Subagent profile. The caller identity and parent runtime are bound by Nexus.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'profileId',
        'objective',
        'constraints',
        'inputArtifactRefs',
        'maxTokens',
        'maxSteps',
        'deadlineAt',
        'completionCriteria',
        'dependsOn',
        'dependencyMode',
        'idempotencyKey',
      ],
      properties: {
        profileId: { type: 'string', minLength: 1, maxLength: 64 },
        objective: { type: 'string', minLength: 1, maxLength: 16384 },
        constraints: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 2048 } },
        inputArtifactRefs: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 256 } },
        maxTokens: { type: 'integer', minimum: 1 },
        maxSteps: { type: 'integer', minimum: 1 },
        deadlineAt: { type: 'integer', minimum: 1 },
        completionCriteria: { type: 'array', maxItems: 32, items: { type: 'string', minLength: 1, maxLength: 2048 } },
        dependsOn: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 128 } },
        dependencyMode: { type: 'string', enum: ['success', 'settled'] },
        idempotencyKey: { type: 'string', pattern: UUID_PATTERN },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('delegate_subagent', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const idempotencyKey = String(input.idempotencyKey ?? '');
    const { idempotencyKey: _ignored, ...request } = input;
    const delegation = await subagents.create(context, context.runId, context.agentRuntimeId, request, idempotencyKey);
    return result('Subagent delegation created.', delegation);
  },
});

const listSubagentsTool = (subagents: SubagentService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'list_subagents',
    version: '1',
    description: 'List child delegations in the current Run without exposing their private model context.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        parentRuntimeId: { type: 'string', minLength: 1, maxLength: 128 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
    riskClass: 'read',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('list_subagents', '1', input, context, policyRevision, cryptoHash, 'read'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const parentRuntimeId = typeof input.parentRuntimeId === 'string' ? input.parentRuntimeId : context.agentRuntimeId;
    const limit = typeof input.limit === 'number' ? input.limit : 50;
    const delegations = await subagents.list(context, context.runId, parentRuntimeId, limit);
    return result('Subagent delegations loaded.', delegations);
  },
});

const joinSubagentsTool = (subagents: SubagentService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'join_subagents',
    version: '1',
    description:
      'Check completion of direct child delegations. When the requested join condition is not ready, Nexus yields the parent runtime slot until child progress wakes it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['delegationIds', 'mode', 'deadlineAt'],
      properties: {
        delegationIds: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          uniqueItems: true,
          items: { type: 'string', minLength: 1, maxLength: 128 },
        },
        mode: { type: 'string', enum: ['all', 'any'] },
        deadlineAt: { type: 'integer', minimum: 1 },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('join_subagents', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const delegationIds = Array.isArray(input.delegationIds) ? input.delegationIds.map(String) : [];
    const mode = input.mode === 'any' ? 'any' : 'all';
    const joined = await subagents.pollJoin(
      context,
      context.runId,
      context.agentRuntimeId,
      delegationIds,
      mode,
      Number(input.deadlineAt),
    );
    return result(
      joined.ready ? 'Subagent join condition is ready.' : 'Subagent join is waiting for child progress.',
      joined,
    );
  },
});

const sendMessageTool = (mailbox: MailboxService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'send_agent_message',
    version: '1',
    description:
      'Send one bounded Run-scoped message to an authorized peer. Sender identity is always taken from the current agent runtime.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'recipientRuntimeId',
        'delegationId',
        'kind',
        'correlationId',
        'replyTo',
        'causationId',
        'taskRevision',
        'body',
        'artifactRefs',
        'ttlSeconds',
        'idempotencyKey',
      ],
      properties: {
        recipientRuntimeId: { type: 'string', minLength: 1, maxLength: 128 },
        delegationId: { type: 'string', minLength: 1, maxLength: 128 },
        kind: { type: 'string', enum: ['request', 'reply', 'progress', 'evidence', 'completion'] },
        correlationId: { type: 'string', minLength: 1, maxLength: 128 },
        replyTo: { type: ['string', 'null'], maxLength: 128 },
        causationId: { type: ['string', 'null'], maxLength: 128 },
        taskRevision: { type: 'integer', minimum: 0 },
        body: {},
        artifactRefs: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 256 } },
        ttlSeconds: { type: 'integer', minimum: 1, maximum: 86400 },
        idempotencyKey: { type: 'string', pattern: UUID_PATTERN },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('send_agent_message', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const idempotencyKey = String(input.idempotencyKey ?? '');
    const { idempotencyKey: _ignored, ...message } = input;
    const receipt = await mailbox.send(context, context.runId, context.agentRuntimeId, message, idempotencyKey);
    return result('Agent message accepted by the durable mailbox.', receipt);
  },
});

const readMessagesTool = (mailbox: MailboxService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'read_agent_messages',
    version: '1',
    description: 'Read the current runtime mailbox by monotonically increasing recipient sequence.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['after', 'limit'],
      properties: {
        after: { type: 'integer', minimum: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 64 },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('read_agent_messages', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const messages = await mailbox.read(
      context,
      context.runId,
      context.agentRuntimeId,
      Number(input.after),
      Number(input.limit),
    );
    return result('Mailbox messages loaded.', messages);
  },
});

const consumeMessagesTool = (mailbox: MailboxService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'consume_agent_messages',
    version: '1',
    description:
      'Advance the current runtime mailbox contiguous consumption watermark using compare-and-set semantics.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['through', 'expectedConsumedSequence'],
      properties: {
        through: { type: 'integer', minimum: 0 },
        expectedConsumedSequence: { type: 'integer', minimum: 0 },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('consume_agent_messages', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const through = await mailbox.consume(
      context,
      context.runId,
      context.agentRuntimeId,
      Number(input.through),
      Number(input.expectedConsumedSequence),
    );
    return result('Mailbox consumption watermark advanced.', { consumedThrough: through });
  },
});

const getFactTool = (facts: SharedFactsService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'get_shared_fact',
    version: '1',
    description: 'Read one bounded Run-scoped shared fact and its CAS version.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['key'],
      properties: { key: { type: 'string', minLength: 1, maxLength: 128 } },
    },
    riskClass: 'read',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('get_shared_fact', '1', input, context, policyRevision, cryptoHash, 'read'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const fact = await facts.get(context, context.runId, String(input.key));
    return result('Shared fact loaded.', { fact });
  },
});

const compareAndSetFactTool = (facts: SharedFactsService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'compare_and_set_shared_fact',
    version: '1',
    description: 'Create or update one bounded Run-scoped shared fact with optimistic version checking.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['key', 'value', 'expectedVersion'],
      properties: {
        key: { type: 'string', minLength: 1, maxLength: 128 },
        value: {},
        expectedVersion: { type: ['integer', 'null'], minimum: 1 },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('compare_and_set_shared_fact', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const input = inspection.normalizedArguments as Record<string, JsonValue>;
    const expectedVersion = input.expectedVersion === null ? null : Number(input.expectedVersion);
    const fact = await facts.compareAndSet(
      context,
      context.runId,
      context.agentRuntimeId,
      String(input.key),
      input.value,
      expectedVersion,
    );
    return result('Shared fact committed.', fact);
  },
});

const proposeMemoryTool = (memories: MemoryService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'propose_memory',
    version: '1',
    description:
      'Submit a memory candidate for user review. Candidates are not recalled until the user explicitly publishes them.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['content', 'sourceRefs', 'confidence', 'expiresAt'],
      properties: {
        content: { type: 'string', minLength: 1, maxLength: 16384 },
        sourceRefs: {},
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        expiresAt: { type: ['integer', 'null'], minimum: 1 },
      },
    },
    riskClass: 'control',
    capability: 'runs.execute',
  },
  inspect: async (input, context, policyRevision) =>
    localInspection('propose_memory', '1', input, context, policyRevision, cryptoHash, 'control'),
  execute: async (inspection, context) => {
    const memory = await memories.propose(context, inspection.normalizedArguments, {
      runId: context.runId,
      runtimeId: context.agentRuntimeId,
    });
    return result('Memory candidate created for user review.', memory);
  },
});

export const createCollaborationTools = (
  subagents: SubagentService,
  mailbox: MailboxService,
  facts: SharedFactsService,
  memories: MemoryService,
  cryptoHash: CryptoHashPort,
): AgentTool[] => [
  delegateTool(subagents, cryptoHash),
  listSubagentsTool(subagents, cryptoHash),
  joinSubagentsTool(subagents, cryptoHash),
  sendMessageTool(mailbox, cryptoHash),
  readMessagesTool(mailbox, cryptoHash),
  consumeMessagesTool(mailbox, cryptoHash),
  getFactTool(facts, cryptoHash),
  compareAndSetFactTool(facts, cryptoHash),
  proposeMemoryTool(memories, cryptoHash),
];
