import type { JsonValue, Scope } from '../agent.types';
import type { CatalogToolSchema } from './tool-catalog';
import { ToolCatalog } from './tool-catalog';
import type { ToolAvailabilityContext, ToolContext, ToolDescriptor, ToolProposal } from './tool.types';

export const TOOL_SEARCH_NAME = 'tool_search';
export const TOOL_INVOKE_NAME = 'tool_invoke';

const DEFERRED_HANDLE_PREFIX = 'mcp1.';
const MAX_ROUTER_ARGUMENT_BYTES = 32 * 1024;

export const isDeferredToolDescriptor = (descriptor: ToolDescriptor): boolean =>
  descriptor.modelExposure === 'deferred' &&
  (descriptor.capability === 'integration.mcp.read' || descriptor.capability === 'integration.mcp.invoke');

export const TOOL_INVOKE_SCHEMA: CatalogToolSchema = {
  name: TOOL_INVOKE_NAME,
  description:
    'Invoke one deferred MCP capability using a handle returned by tool_search. This includes remote Tools and bounded Resource/Prompt discovery/read surfaces. The handle is version-bound; stale or unknown handles fail closed. Arguments are validated against the authoritative Tool schema before inspection/execution.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      handle: { type: 'string', minLength: 8, maxLength: 512 },
      arguments: { type: 'object', additionalProperties: true },
    },
    required: ['handle', 'arguments'],
  },
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, unknown>;
};

const encodeHandlePayload = (descriptor: ToolDescriptor): string =>
  Buffer.from(JSON.stringify({ v: 1, name: descriptor.name, version: descriptor.version }), 'utf8').toString(
    'base64url',
  );

export const deferredToolHandle = (descriptor: ToolDescriptor): string =>
  `${DEFERRED_HANDLE_PREFIX}${encodeHandlePayload(descriptor)}`;

const decodeDeferredHandle = (handle: string): { name: string; version: string } => {
  if (
    !handle.startsWith(DEFERRED_HANDLE_PREFIX) ||
    Buffer.byteLength(handle, 'utf8') > 512 ||
    handle.length <= DEFERRED_HANDLE_PREFIX.length
  ) {
    throw new Error('RESOURCE_CHANGED');
  }
  try {
    const parsed = asRecord(
      JSON.parse(Buffer.from(handle.slice(DEFERRED_HANDLE_PREFIX.length), 'base64url').toString('utf8')),
    );
    if (
      parsed.v !== 1 ||
      typeof parsed.name !== 'string' ||
      !parsed.name ||
      typeof parsed.version !== 'string' ||
      !parsed.version
    ) {
      throw new Error('RESOURCE_CHANGED');
    }
    return { name: parsed.name, version: parsed.version };
  } catch {
    throw new Error('RESOURCE_CHANGED');
  }
};

const routerArguments = (argumentsJson: string): { handle: string; arguments: JsonValue } => {
  if (Buffer.byteLength(argumentsJson, 'utf8') > MAX_ROUTER_ARGUMENT_BYTES) throw new Error('TOOL_INPUT_TOO_LARGE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  const record = asRecord(parsed);
  if (Object.keys(record).some((key) => key !== 'handle' && key !== 'arguments')) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  if (typeof record.handle !== 'string' || !record.handle) throw new Error('TOOL_ARGUMENTS_INVALID');
  const nested = record.arguments;
  if (!nested || Array.isArray(nested) || typeof nested !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return { handle: record.handle, arguments: nested as JsonValue };
};

export const resolveDeferredToolProposal = (
  catalog: ToolCatalog,
  context: ToolContext,
  proposal: ToolProposal,
): ToolProposal => {
  if (proposal.name !== TOOL_INVOKE_NAME) {
    try {
      if (isDeferredToolDescriptor(catalog.require(proposal.name, context).descriptor)) {
        throw new Error('MODEL_TOOL_CALL_INVALID');
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'MODEL_TOOL_CALL_INVALID') throw error;
    }
    return proposal;
  }
  const routed = routerArguments(proposal.argumentsJson);
  const decoded = decodeDeferredHandle(routed.handle);
  const descriptor = catalog
    .list(context, { environment: context.environment })
    .find((candidate) => candidate.name === decoded.name);
  if (!descriptor || !isDeferredToolDescriptor(descriptor) || descriptor.version !== decoded.version) {
    throw new Error('RESOURCE_CHANGED');
  }
  return {
    providerCallId: proposal.providerCallId,
    name: descriptor.name,
    argumentsJson: JSON.stringify(routed.arguments),
  };
};

export const modelFacingToolSchemas = (
  catalog: ToolCatalog,
  scope: Scope,
  availability: ToolAvailabilityContext | undefined,
  executionMode: 'execute' | 'plan',
): CatalogToolSchema[] => {
  const descriptors = catalog.list(scope, availability);
  const deferred = descriptors.filter(isDeferredToolDescriptor);
  const direct = descriptors
    .filter((descriptor) => !isDeferredToolDescriptor(descriptor))
    .filter((descriptor) => {
      if (descriptor.name === TOOL_SEARCH_NAME) return executionMode === 'execute' && deferred.length > 0;
      if (executionMode === 'execute') return true;
      return descriptor.riskClass === 'read' || descriptor.riskClass === 'control';
    })
    .map((descriptor) => ({
      name: descriptor.name,
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
    }));
  if (executionMode === 'execute' && deferred.length > 0) direct.push(TOOL_INVOKE_SCHEMA);
  return direct;
};
