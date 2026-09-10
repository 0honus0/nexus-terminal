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

const nonNegativeInteger = (value: JsonValue | undefined, fallback = 0): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('TOOL_ARGUMENTS_INVALID');
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
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

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
    capability: 'machine.diagnostics.read',
  },
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
      secretRefs: [],
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

export const createReadFileTool = (machine: MachineCapabilityPort, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'machine_read_file',
    version: '1.0.0',
    description: 'Read a bounded UTF-8 slice from an authorized remote file. Device and secret paths are denied.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        connectionId: { type: 'integer', minimum: 1 },
        path: { type: 'string', minLength: 1, maxLength: 4096 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 1048576 },
        offset: { type: 'integer', minimum: 0 },
      },
      required: ['connectionId', 'path'],
    },
    riskClass: 'read',
    capability: 'machine.files.read',
  },
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['connectionId', 'path', 'maxBytes', 'offset']);
    const connectionId = positiveInteger(args.connectionId);
    if (typeof args.path !== 'string' || !args.path) throw new Error('TOOL_ARGUMENTS_INVALID');
    const normalizedArguments: JsonValue = {
      connectionId,
      path: args.path,
      maxBytes: positiveInteger(args.maxBytes, Math.min(context.maxOutputBytes, 64 * 1024)),
      offset: nonNegativeInteger(args.offset),
    };
    const target = await machine.target(context, connectionId);
    const resourceKeys = [`connection:${connectionId}`, `connection:${connectionId}:file:${args.path}`];
    return {
      toolName: 'machine_read_file',
      toolVersion: '1.0.0',
      normalizedArguments,
      target,
      resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operation(
        cryptoHash,
        context,
        'machine_read_file',
        '1.0.0',
        target,
        normalizedArguments,
        resourceKeys,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: [],
      secretRefs: [],
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const result = await machine.readFile(
      context,
      positiveInteger(args.connectionId),
      String(args.path),
      positiveInteger(args.maxBytes),
      nonNegativeInteger(args.offset),
    );
    return confirmedResult(
      `Read ${result.bytesRead} byte(s) from ${result.resolvedPath}${result.truncated ? ' (truncated)' : ''}.`,
      {
        path: result.path,
        resolvedPath: result.resolvedPath,
        sizeBytes: result.sizeBytes,
        modifiedAt: result.modifiedAt,
        offset: result.offset,
        bytesRead: result.bytesRead,
        truncated: result.truncated,
        content: result.content,
        target: { ...inspection.target },
      },
      result.truncated,
    );
  },
});
