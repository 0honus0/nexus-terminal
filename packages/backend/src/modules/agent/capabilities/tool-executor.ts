import type { JsonValue } from '../agent.types';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import { assertJsonSchema } from '../json-schema-validator';
import { ToolCatalog } from './tool-catalog';
import type { ToolContext, ToolInspection, ToolProposal, ToolResult } from './tool.types';

const MAX_TOOL_INPUT_BYTES = 32 * 1024;
const MAX_TOOL_DEPTH = 16;
const MAX_ARRAY_ITEMS = 1000;

const jsonBytes = (value: JsonValue | ToolResult): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

const truncateJsonString = (value: string, maxBytes: number): string => {
  if (maxBytes <= 2) return '';
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes) return value;
  const characters = Array.from(value);
  let low = 0;
  let high = characters.length;
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = `${characters.slice(0, middle).join('')}…`;
    if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return best;
};

const jsonProjectionPriority = (value: JsonValue): number => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 0;
  if (typeof value === 'string') return 1;
  if (Array.isArray(value)) return 3;
  return 2;
};

const projectJsonValue = (value: JsonValue, maxBytes: number): JsonValue => {
  if (maxBytes < 4) return null;
  if (jsonBytes(value) <= maxBytes) return value;
  if (typeof value === 'string') return truncateJsonString(value, maxBytes);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return null;
  if (Array.isArray(value)) {
    const projected: JsonValue[] = [];
    for (const item of value) {
      const remaining = maxBytes - jsonBytes(projected) - 1;
      if (remaining < 4) break;
      const candidate = [...projected, projectJsonValue(item, remaining)];
      if (jsonBytes(candidate) > maxBytes) break;
      projected.push(candidate[candidate.length - 1]!);
    }
    return projected;
  }
  const projected: Record<string, JsonValue> = {};
  const entries = Object.entries(value)
    .map(([key, item], index) => ({ key, item, index }))
    .sort((left, right) => jsonProjectionPriority(left.item) - jsonProjectionPriority(right.item) || left.index - right.index);
  for (const { key, item } of entries) {
    const currentBytes = jsonBytes(projected as JsonValue);
    const keyOverhead = Buffer.byteLength(JSON.stringify(key), 'utf8') + 2;
    const remaining = maxBytes - currentBytes - keyOverhead;
    if (remaining < 4) continue;
    const candidate = { ...projected, [key]: projectJsonValue(item, remaining) };
    if (jsonBytes(candidate as JsonValue) <= maxBytes) projected[key] = candidate[key]!;
  }
  return projected;
};

const appendRefsWithinBudget = (
  base: ToolResult,
  refs: readonly string[],
  field: 'artifactRefs' | 'evidenceRefs',
  maxBytes: number,
): ToolResult => {
  let current = base;
  for (const ref of refs) {
    const candidate: ToolResult =
      field === 'artifactRefs'
        ? { ...current, artifactRefs: [...current.artifactRefs, ref] }
        : {
            ...current,
            verification: { ...current.verification, evidenceRefs: [...current.verification.evidenceRefs, ref] },
          };
    if (jsonBytes(candidate) > maxBytes) break;
    current = candidate;
  }
  return current;
};

/**
 * Bound the complete model-visible ToolResult without changing the already-known side-effect outcome.
 * Raw transport retention is a separate concern; this projection is deliberately post-execution.
 */
export const projectToolResult = (result: ToolResult, maxOutputBytes: number): ToolResult => {
  if (jsonBytes(result) <= maxOutputBytes) return result;
  const minimal: ToolResult = {
    ok: result.ok,
    summary: '',
    artifactRefs: [],
    truncated: true,
    outcome: result.outcome,
    ...(result.errorCode ? { errorCode: result.errorCode } : {}),
    verification: {
      status: result.verification.status,
      summary: '',
      evidenceRefs: [],
    },
  };
  // A ToolResult has a non-zero structural envelope. Preserve semantic truth even if a corrupted
  // historical setting supplies a byte limit smaller than that irreducible JSON representation.
  const effectiveLimit = Math.max(maxOutputBytes, jsonBytes(minimal));
  let projected = appendRefsWithinBudget(minimal, result.artifactRefs, 'artifactRefs', effectiveLimit);
  projected = appendRefsWithinBudget(projected, result.verification.evidenceRefs, 'evidenceRefs', effectiveLimit);

  const summaryBudget = Math.min(4096, Math.max(32, Math.floor(effectiveLimit * 0.15)));
  let candidate: ToolResult = { ...projected, summary: truncateJsonString(result.summary, summaryBudget) };
  if (jsonBytes(candidate) <= effectiveLimit) projected = candidate;
  const verificationBudget = Math.min(2048, Math.max(32, Math.floor(effectiveLimit * 0.1)));
  candidate = {
    ...projected,
    verification: {
      ...projected.verification,
      summary: truncateJsonString(result.verification.summary, verificationBudget),
    },
  };
  if (jsonBytes(candidate) <= effectiveLimit) projected = candidate;

  if (result.data !== undefined) {
    const envelopeBytes = jsonBytes(projected);
    const dataBudget = Math.max(4, effectiveLimit - envelopeBytes - Buffer.byteLength(',"data":', 'utf8') - 2);
    const data = projectJsonValue(result.data, dataBudget);
    candidate = { ...projected, data };
    if (jsonBytes(candidate) <= effectiveLimit) projected = candidate;
  }
  return projected;
};

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
    const connectionId =
      input && !Array.isArray(input) && typeof input === 'object' && Number.isSafeInteger(input.connectionId)
        ? (input.connectionId as number)
        : undefined;
    const initial = await this.capabilities.authorize(context, tool.descriptor.capability, { connectionId });
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
    const connectionId = previous.target.connectionId;
    const fresh = await this.capabilities.authorize(context, tool.descriptor.capability, { connectionId });
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
    const fresh = await this.capabilities.authorize(context, tool.descriptor.capability, {
      connectionId: inspection.target.connectionId,
    });
    if (!fresh.allowed || fresh.policyRevision !== inspection.policyRevision)
      throw new Error('POLICY_REVISION_CONFLICT');
    const result = await tool.execute(inspection, context);
    return projectToolResult(result, context.maxOutputBytes);
  }

  async invoke(context: ToolContext, proposal: ToolProposal): Promise<ToolExecutionResult> {
    const inspection = await this.inspect(context, proposal);
    return { inspection, result: await this.execute(context, inspection) };
  }
}
