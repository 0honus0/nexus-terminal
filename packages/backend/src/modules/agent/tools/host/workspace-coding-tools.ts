import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { AgentTool, ToolContext, ToolInspection, ToolPrecondition } from '../../capabilities/tool.types';
import type { AgentTargetResolver } from '../../capabilities/target-resolver';
import type { WorkspaceRuntimeService } from '../../workspace-runtime/workspace-runtime.service';

const MAX_PATH_BYTES = 4096;
const MAX_ID_BYTES = 128;

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || !value || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};

const workspaceSelector = (args: Record<string, JsonValue>): { target: 'workspace'; id: string } => {
  if (args.target !== 'workspace') throw new Error('TOOL_ARGUMENTS_INVALID');
  return { target: 'workspace', id: stringValue(args.id, MAX_ID_BYTES) };
};

const optionalInteger = (
  value: JsonValue | undefined,
  options: { minimum: number; maximum: number; fallback?: number },
): number | undefined => {
  if (value === undefined) return options.fallback;
  if (!Number.isSafeInteger(value) || Number(value) < options.minimum || Number(value) > options.maximum) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return Number(value);
};

const operationHash = (
  cryptoHash: CryptoHashPort,
  toolName: string,
  context: ToolContext,
  target: ToolInspection['target'],
  normalizedArguments: JsonValue,
  resourceKeys: string[],
  preconditions: ToolPrecondition[],
  policyRevision: number,
): string =>
  hashOperation(
    {
      schemaVersion: 2,
      scope: {
        userId: context.userId,
        appId: context.appId,
        runId: context.runId,
        agentRuntimeId: context.agentRuntimeId,
      },
      tool: { name: toolName, version: '1.0.0' },
      target: {
        kind: target.kind,
        ...('target' in target ? { target: target.target, id: target.id } : {}),
        targetIdentity: target.targetIdentity,
        endpoint: target.endpoint,
        loginUser: target.loginUser,
        configurationHash: target.configurationHash,
        workspaceId: target.workspaceId ?? null,
        generation: target.generation ?? null,
      },
      arguments: normalizedArguments,
      resourceKeys: [...resourceKeys].sort(),
      preconditions: preconditions.map((precondition) => ({
        kind: precondition.kind,
        key: precondition.key,
        observedValue: precondition.observedValue,
      })),
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );

const workspaceInspection = async (
  targets: AgentTargetResolver,
  workspaceId: string,
  context: ToolContext,
): Promise<{
  generation: number;
  target: ToolInspection['target'];
  resourceKeys: string[];
  preconditions: ToolPrecondition[];
}> => {
  const resolved = await targets.resolve(context, { target: 'workspace', id: workspaceId });
  if (resolved.workspaceGeneration === undefined) throw new Error('TOOL_STATE_CONFLICT');
  return {
    generation: resolved.workspaceGeneration,
    target: resolved.fingerprint,
    resourceKeys: resolved.resourceKeys,
    preconditions: resolved.preconditions,
  };
};

const workspaceOnlySchema = {
  target: { const: 'workspace' },
  id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
} as const;

export const createWorkspaceRepoMapTool = (
  targets: AgentTargetResolver,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_repo_map',
    version: '1.0.0',
    description:
      'Return a bounded, read-only repository navigation map for TypeScript/JavaScript files in a Workspace target. Includes file SHA-256, imports, and symbol signatures.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...workspaceOnlySchema,
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
        query: { type: 'string', maxLength: 1024 },
        maxFiles: { type: 'integer', minimum: 1, maximum: 64 },
        maxSymbols: { type: 'integer', minimum: 1, maximum: 160 },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 16 * 1024 },
      },
      required: ['target', 'id'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'file.read',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'query', 'maxFiles', 'maxSymbols', 'maxBytes', 'generation']);
    const selector = workspaceSelector(args);
    const path = args.path === undefined ? '/workspace/work' : stringValue(args.path, MAX_PATH_BYTES);
    const query = args.query === undefined ? undefined : stringValue(args.query, 1024);
    const maxFiles = optionalInteger(args.maxFiles, { minimum: 1, maximum: 64, fallback: 16 })!;
    const maxSymbols = optionalInteger(args.maxSymbols, { minimum: 1, maximum: 160, fallback: 64 })!;
    const maxBytes = optionalInteger(args.maxBytes, { minimum: 1024, maximum: 16 * 1024, fallback: 8 * 1024 })!;
    const binding = await workspaceInspection(targets, selector.id, context);
    const normalizedArguments: JsonValue = {
      target: 'workspace',
      id: selector.id,
      generation: binding.generation,
      path,
      ...(query === undefined ? {} : { query }),
      maxFiles,
      maxSymbols,
      maxBytes,
    };
    return {
      toolName: 'workspace_repo_map',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: binding.target,
      resourceKeys: binding.resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operationHash(
        cryptoHash,
        'workspace_repo_map',
        context,
        binding.target,
        normalizedArguments,
        binding.resourceKeys,
        binding.preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: binding.preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const selector = workspaceSelector(args);
    const generation = Number(args.generation);
    const result = await runtime.repoMap(
      context,
      selector.id,
      generation,
      {
        path: stringValue(args.path, MAX_PATH_BYTES),
        ...(args.query === undefined ? {} : { query: stringValue(args.query, 1024) }),
        maxFiles: Number(args.maxFiles),
        maxSymbols: Number(args.maxSymbols),
        maxOutputBytes: Math.max(
          1024,
          Math.min(16 * 1024, Math.floor(context.maxOutputBytes / 2), Number(args.maxBytes)),
        ),
      },
      context.signal,
    );
    return {
      ok: true,
      summary: `Mapped ${result.files.length} file(s) from ${result.indexedFiles} indexed TypeScript/JavaScript source file(s).`,
      data: { generation, ...result } as unknown as JsonValue,
      artifactRefs: [],
      truncated: result.truncated,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary:
          'Runner rebuilt or reused a hash-bound navigation projection for the requested Workspace generation. Read target files authoritatively before mutation.',
        evidenceRefs: [],
      },
    };
  },
});

export const createWorkspaceCodeIntelTool = (
  targets: AgentTargetResolver,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_code_intel',
    version: '1.0.0',
    description:
      'Query bounded TypeScript/JavaScript symbols, definitions, references, or diagnostics in a Workspace target. Unsupported languages return file_search/file_read fallback guidance.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...workspaceOnlySchema,
        action: { type: 'string', enum: ['symbols', 'definition', 'references', 'diagnostics'] },
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
        line: { type: 'integer', minimum: 1 },
        column: { type: 'integer', minimum: 1 },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 64 * 1024 },
      },
      required: ['target', 'id', 'action', 'path'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'file.read',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'action', 'path', 'line', 'column', 'maxResults', 'maxBytes', 'generation']);
    const selector = workspaceSelector(args);
    const action = stringValue(args.action, 32);
    if (!['symbols', 'definition', 'references', 'diagnostics'].includes(action))
      throw new Error('TOOL_ARGUMENTS_INVALID');
    const path = stringValue(args.path, MAX_PATH_BYTES);
    const line = optionalInteger(args.line, { minimum: 1, maximum: 10_000_000 });
    const column = optionalInteger(args.column, { minimum: 1, maximum: 10_000_000 });
    const needsPosition = action === 'definition' || action === 'references';
    if (needsPosition ? line === undefined || column === undefined : line !== undefined || column !== undefined) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const maxResults = optionalInteger(args.maxResults, { minimum: 1, maximum: 100, fallback: 50 })!;
    const maxBytes = optionalInteger(args.maxBytes, { minimum: 1024, maximum: 64 * 1024, fallback: 24 * 1024 })!;
    const binding = await workspaceInspection(targets, selector.id, context);
    const normalizedArguments: JsonValue = {
      target: 'workspace',
      id: selector.id,
      generation: binding.generation,
      action,
      path,
      ...(line === undefined ? {} : { line }),
      ...(column === undefined ? {} : { column }),
      maxResults,
      maxBytes,
    };
    return {
      toolName: 'workspace_code_intel',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: binding.target,
      resourceKeys: binding.resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operationHash(
        cryptoHash,
        'workspace_code_intel',
        context,
        binding.target,
        normalizedArguments,
        binding.resourceKeys,
        binding.preconditions,
        policyRevision,
      ),
      operationHashVersion: 1,
      preconditions: binding.preconditions,
      policyRevision,
      inputRevision: context.inputRevision,
    };
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const selector = workspaceSelector(args);
    const generation = Number(args.generation);
    const action = stringValue(args.action, 32) as 'symbols' | 'definition' | 'references' | 'diagnostics';
    const result = await runtime.codeIntel(
      context,
      selector.id,
      generation,
      {
        action,
        path: stringValue(args.path, MAX_PATH_BYTES),
        ...(args.line === undefined ? {} : { line: Number(args.line) }),
        ...(args.column === undefined ? {} : { column: Number(args.column) }),
        maxResults: Number(args.maxResults),
        maxOutputBytes: Math.max(
          1024,
          Math.min(64 * 1024, Math.floor(context.maxOutputBytes / 2), Number(args.maxBytes)),
        ),
      },
      context.signal,
    );
    return {
      ok: true,
      summary: result.supported
        ? `Returned ${result.results.length} ${action} result(s) from TypeScript native code intelligence.`
        : `Code intelligence is unavailable for ${result.path}; use ${result.fallback?.searchTool ?? 'file_search'} and ${result.fallback?.readTool ?? 'file_read'}.`,
      data: { generation, ...result } as unknown as JsonValue,
      artifactRefs: [],
      truncated: result.truncated,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: result.supported
          ? 'Runner answered from a generation-bound, file-hash-refreshed TypeScript projection.'
          : 'Runner explicitly reported an unsupported or unindexed language and returned the authoritative file-search/read fallback.',
        evidenceRefs: [],
      },
    };
  },
});
