import type { JsonValue } from '../agent.types';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import type { CapabilityResource } from '../host/capability.types';
import { assertJsonSchema } from '../json-schema-validator';
import { ToolCatalog } from './tool-catalog';
import type { ToolContext, ToolInspection, ToolProposal, ToolResult } from './tool.types';

const MAX_TOOL_INPUT_BYTES = 32 * 1024;
const MAX_TOOL_DEPTH = 16;
const MAX_ARRAY_ITEMS = 1000;

export { projectToolResult } from './tool-result-projection';

const validateJsonShape = (value: JsonValue, depth = 0): void => {
  if (depth > MAX_TOOL_DEPTH) throw new Error('TOOL_INPUT_TOO_DEEP');
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw new Error('TOOL_INPUT_TOO_LARGE');
    for (const item of value) validateJsonShape(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) validateJsonShape(item, depth + 1);
  }
};

const parseArguments = (argumentsJson: string): JsonValue => {
  if (Buffer.byteLength(argumentsJson, 'utf8') > MAX_TOOL_INPUT_BYTES) throw new Error('TOOL_INPUT_TOO_LARGE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  if (
    parsed === undefined ||
    typeof parsed === 'bigint' ||
    typeof parsed === 'function' ||
    typeof parsed === 'symbol' ||
    (typeof parsed === 'number' && !Number.isFinite(parsed))
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  const value = parsed as JsonValue;
  validateJsonShape(value);
  return value;
};

const capabilityResourceFromInput = (input: JsonValue): CapabilityResource => {
  if (!input || Array.isArray(input) || typeof input !== 'object') return {};
  const record = input as Record<string, JsonValue>;
  const connectionId = Number.isSafeInteger(record.connectionId) ? (record.connectionId as number) : undefined;
  const target: CapabilityResource['target'] =
    (record.target === 'workspace' || record.target === 'ssh') && typeof record.id === 'string' && record.id.length > 0
      ? { target: record.target, id: record.id }
      : undefined;
  return { ...(connectionId === undefined ? {} : { connectionId }), ...(target === undefined ? {} : { target }) };
};

const capabilityResourceFromInspection = (inspection: ToolInspection): CapabilityResource => {
  const target = inspection.target;
  return {
    ...(target.connectionId === undefined ? {} : { connectionId: target.connectionId }),
    ...('target' in target ? { target: { target: target.target, id: target.id } } : {}),
  };
};

export interface ToolExecutionResult {
  inspection: ToolInspection;
  result: ToolResult;
}

export class ToolExecutor {
  constructor(
    private readonly catalog: ToolCatalog,
    private readonly capabilities: AppCapabilityBroker,
  ) {}

  async inspect(context: ToolContext, proposal: ToolProposal): Promise<ToolInspection> {
    const tool = this.catalog.require(proposal.name, context);
    const input = parseArguments(proposal.argumentsJson);
    assertJsonSchema(tool.descriptor.inputSchema, input, 'TOOL_ARGUMENTS_INVALID');
    const initial = await this.capabilities.authorize(
      context,
      tool.descriptor.capability,
      capabilityResourceFromInput(input),
    );
    if (!initial.allowed)
      throw new Error(initial.code === 'TARGET_DENIED' ? 'RESOURCE_FORBIDDEN' : 'APP_CAPABILITY_DENIED');
    const inspection = await tool.inspect(input, context, initial.policyRevision);
    if (inspection.risk === 'forbidden') throw new Error('RESOURCE_FORBIDDEN');
    if (tool.descriptor.riskClass === 'read' && (inspection.risk !== 'read' || inspection.mutation)) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    if (tool.descriptor.riskClass === 'control' && (inspection.risk !== 'control' || inspection.mutation)) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    if (
      (tool.descriptor.riskClass === 'mutate' || tool.descriptor.riskClass === 'destructive') &&
      !inspection.mutation
    ) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    return inspection;
  }

  async execute(context: ToolContext, inspection: ToolInspection): Promise<ToolResult> {
    const tool = this.catalog.require(inspection.toolName, context);
    const safeLocal =
      (tool.descriptor.riskClass === 'read' && inspection.risk === 'read') ||
      (tool.descriptor.riskClass === 'control' && inspection.risk === 'control');
    if (!safeLocal || inspection.mutation) {
      throw new Error('CAPABILITY_UNAVAILABLE');
    }
    const result = await this.executeAuthorized(context, inspection);
    if (result.outcome !== 'confirmed') throw new Error('RECONCILIATION_REQUIRED');
    return result;
  }

  async executeMutation(context: ToolContext, inspection: ToolInspection): Promise<ToolResult> {
    const tool = this.catalog.require(inspection.toolName, context);
    if (
      tool.descriptor.riskClass === 'read' ||
      inspection.risk === 'read' ||
      inspection.risk === 'forbidden' ||
      !inspection.mutation
    ) {
      throw new Error('CAPABILITY_UNAVAILABLE');
    }
    return this.executeAuthorized(context, inspection);
  }

  async refreshInspection(context: ToolContext, previous: ToolInspection): Promise<ToolInspection> {
    const tool = this.catalog.require(previous.toolName, context);
    const fresh = await this.capabilities.authorize(
      context,
      tool.descriptor.capability,
      capabilityResourceFromInspection(previous),
    );
    if (!fresh.allowed)
      throw new Error(fresh.code === 'TARGET_DENIED' ? 'RESOURCE_FORBIDDEN' : 'APP_CAPABILITY_DENIED');
    const inspection = await tool.inspect(previous.normalizedArguments, context, fresh.policyRevision);
    if (inspection.risk === 'forbidden') throw new Error('RESOURCE_FORBIDDEN');
    if (tool.descriptor.riskClass === 'read' && (inspection.risk !== 'read' || inspection.mutation)) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    if (tool.descriptor.riskClass === 'control' && (inspection.risk !== 'control' || inspection.mutation)) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    if (
      (tool.descriptor.riskClass === 'mutate' || tool.descriptor.riskClass === 'destructive') &&
      !inspection.mutation
    ) {
      throw new Error('TOOL_POLICY_INVALID');
    }
    return inspection;
  }

  private async executeAuthorized(context: ToolContext, inspection: ToolInspection): Promise<ToolResult> {
    const tool = this.catalog.require(inspection.toolName, context);
    const fresh = await this.capabilities.authorize(
      context,
      tool.descriptor.capability,
      capabilityResourceFromInspection(inspection),
    );
    if (!fresh.allowed || fresh.policyRevision !== inspection.policyRevision)
      throw new Error('POLICY_REVISION_CONFLICT');
    return tool.execute(inspection, context);
  }

  async invoke(context: ToolContext, proposal: ToolProposal): Promise<ToolExecutionResult> {
    const inspection = await this.inspect(context, proposal);
    return { inspection, result: await this.execute(context, inspection) };
  }
}
