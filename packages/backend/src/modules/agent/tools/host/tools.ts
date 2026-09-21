import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { MachineCapabilityPort } from '../../capabilities/machine.port';
import type { AgentTool, ToolContext, ToolInspection, ToolResult } from '../../capabilities/tool.types';

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

const operation = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  name: string,
  version: string,
  target: ToolInspection['target'],
  args: JsonValue,
  resourceKeys: string[],
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
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

const hasSelectedConnection = (context: { connectionIds?: readonly number[] }): boolean =>
  context.connectionIds === undefined || context.connectionIds.length > 0;

const confirmedResult = (summary: string, data: JsonValue, truncated = false): ToolResult => ({
  ok: true,
  summary,
  data,
  artifactRefs: [],
  truncated,
  outcome: 'confirmed',
  verification: {
    status: 'verified',
    summary: 'Read-only result returned by the bounded machine capability.',
    evidenceRefs: [],
  },
});

export const createConnectionListTool = (machine: MachineCapabilityPort, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'machine_list_connections',
    version: '1.0.0',
    description:
      'List authorized SSH connections visible to this Agent. Returns only id, name, host, port, and username; denied targets and credentials are never returned.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'machine.inspect',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, []);
    const normalizedArguments: JsonValue = {};
    const target = {
      kind: 'run' as const,
      targetIdentity: `run:${context.runId}:machine-connections`,
      endpoint: 'machine-connections',
      loginUser: `agent-runtime:${context.agentRuntimeId}`,
      configurationHash: hashOperation(
        {
          schemaVersion: 1,
          userId: context.userId,
          appId: context.appId,
          resource: 'machine-connections',
        },
        cryptoHash,
      ),
    };
    const resourceKeys = [`app:${context.appId}:machine-connections`];
    return {
      toolName: 'machine_list_connections',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operation(
        cryptoHash,
        context,
        'machine_list_connections',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (_inspection, context) => {
    const connections = await machine.listConnections(context);
    return confirmedResult(`Found ${connections.length} authorized SSH connection(s).`, {
      connections: connections.map((connection) => ({ ...connection })),
    });
  },
});

export const createDiagnosticsTool = (machine: MachineCapabilityPort, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'machine_diagnostics',
    version: '1.0.0',
    description: 'Read bounded, redacted Nexus diagnostics for an authorized SSH connection context.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        connectionId: { type: 'integer', minimum: 1 },
        probeIds: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      },
      required: ['connectionId'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'machine.inspect',
  },
  isAvailable: hasSelectedConnection,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['connectionId', 'probeIds']);
    const connectionId = positiveInteger(args.connectionId);
    const probeIds = args.probeIds ?? ['process.runtime', 'storage.database', 'execution.sessions'];
    if (!Array.isArray(probeIds) || probeIds.length > 32 || probeIds.some((id) => typeof id !== 'string' || !id)) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const normalizedArguments: JsonValue = { connectionId, probeIds: [...new Set(probeIds as string[])] };
    const target = await machine.target(context, connectionId);
    const resourceKeys = [`connection:${connectionId}`];
    return {
      toolName: 'machine_diagnostics',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operation(
        cryptoHash,
        context,
        'machine_diagnostics',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const report = await machine.diagnose(
      context,
      positiveInteger(args.connectionId),
      (args.probeIds as string[]) ?? [],
      context.agentRuntimeId,
      context.signal,
    );
    return confirmedResult(`Collected ${report.observations.length} diagnostic observation(s).`, {
      generatedAt: report.generatedAt,
      observations: [...report.observations],
      target: { ...inspection.target },
    });
  },
});
