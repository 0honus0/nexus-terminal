import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { MachineCapabilityPort } from '../../capabilities/machine.port';
import type { SshTargetResolverPort } from '../../capabilities/ssh-target-resolver.port';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const positiveInteger = (value: JsonValue | undefined, fallback?: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as number;
};

const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || value.length < 1 || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};

const operation = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  name: string,
  version: string,
  target: ToolInspection['target'],
  args: JsonValue,
  resourceKeys: string[],
  preconditions: ToolPrecondition[],
  policyRevision: number,
): string =>
  hashOperation(
    {
      schemaVersion: 1,
      scope: {
        userId: context.userId,
        appId: context.appId,
        runId: context.runId,
        agentRuntimeId: context.agentRuntimeId,
      },
      tool: { name, version },
      target: { ...target },
      arguments: args,
      resourceKeys: [...new Set(resourceKeys)].sort(),
      preconditions: [...preconditions]
        .sort((left, right) => `${left.kind}\u0000${left.key}`.localeCompare(`${right.kind}\u0000${right.key}`))
        .map((precondition) => ({
          kind: precondition.kind,
          key: precondition.key,
          observedValue: precondition.observedValue,
        })),
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

const result = (
  ok: boolean,
  summary: string,
  data: JsonValue,
  verificationSummary: string,
  artifactRefs: string[] = [],
  truncated = false,
): ToolResult => ({
  ok,
  summary,
  data,
  artifactRefs,
  truncated,
  outcome: 'confirmed',
  verification: {
    status: ok ? 'verified' : 'failed',
    summary: verificationSummary,
    evidenceRefs: artifactRefs,
  },
});

const hasSelectedConnection = (context: { connectionIds?: readonly number[] }): boolean =>
  context.connectionIds === undefined || context.connectionIds.length > 0;

export const createDockerMutationTool = (
  machine: MachineCapabilityPort,
  sshTargets: SshTargetResolverPort,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'machine_docker_action',
    version: '1.0.0',
    description: 'Start, stop, restart, or remove one existing Docker container on an authorized SSH target.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        connectionId: { type: 'integer', minimum: 1 },
        containerId: { type: 'string', pattern: '^[a-fA-F0-9]{12,64}$' },
        action: { type: 'string', enum: ['start', 'stop', 'restart', 'remove'] },
      },
      required: ['connectionId', 'containerId', 'action'],
    },
    riskClass: 'mutate',
    capability: 'machine.docker.manage',
  },
  isAvailable: hasSelectedConnection,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['connectionId', 'containerId', 'action']);
    const connectionId = positiveInteger(args.connectionId);
    const containerId = stringValue(args.containerId, 64);
    const action = stringValue(args.action, 16);
    if (!['start', 'stop', 'restart', 'remove'].includes(action)) throw new Error('TOOL_ARGUMENTS_INVALID');
    const target = await sshTargets.target(context, connectionId);
    const container = await machine.inspectDockerContainer(
      context,
      connectionId,
      containerId,
      target.configurationHash,
    );
    const normalizedArguments: JsonValue = { connectionId, containerId: container.containerId, action };
    const resourceKeys = [`connection:${connectionId}`, `connection:${connectionId}:docker:${container.containerId}`];
    const preconditions: ToolPrecondition[] = [
      {
        kind: 'serviceState',
        key: `docker:${container.containerId}`,
        observedValue: { state: container.state, image: container.image },
      },
    ];
    const risk = action === 'remove' ? 'destructive' : 'mutate';
    return {
      toolName: 'machine_docker_action',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk,
      mutation: true,
      operationHash: operation(
        cryptoHash,
        context,
        'machine_docker_action',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const precondition = inspection.preconditions.find((candidate) => candidate.kind === 'serviceState');
    if (
      !precondition ||
      !precondition.observedValue ||
      Array.isArray(precondition.observedValue) ||
      typeof precondition.observedValue !== 'object'
    ) {
      throw new Error('TOOL_STATE_CONFLICT');
    }
    const observed = precondition.observedValue as Record<string, JsonValue>;
    if (typeof observed.state !== 'string') throw new Error('TOOL_STATE_CONFLICT');
    const action = stringValue(args.action, 16) as 'start' | 'stop' | 'restart' | 'remove';
    const mutated = await machine.mutateDockerContainer(
      context,
      positiveInteger(args.connectionId),
      stringValue(args.containerId, 64),
      action,
      observed.state,
      inspection.target.configurationHash,
    );
    return result(
      true,
      `${action} for Docker container ${mutated.containerId} was verified.`,
      {
        containerId: mutated.containerId,
        action,
        state: mutated.state,
        image: mutated.image,
        target: { ...inspection.target },
      },
      action === 'remove'
        ? 'The target container was absent from the post-operation Docker inventory.'
        : 'The post-operation Docker state matched the requested action.',
    );
  },
});
