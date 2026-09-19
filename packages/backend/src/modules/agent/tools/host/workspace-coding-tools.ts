import type { JsonValue } from '../../agent.types';
import type { ArtifactService } from '../../ai/artifact.service';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
} from '../../capabilities/tool.types';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceRuntimeService } from '../../workspace-runtime/workspace-runtime.service';

const MAX_PATH_BYTES = 4096;
const MAX_PATCH_BYTES = 30 * 1024;
const MAX_PATCH_FILES = 16;

const record = (value: JsonValue): Record<string, JsonValue> => {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value as Record<string, JsonValue>;
};

const onlyKeys = (value: Record<string, JsonValue>, allowed: readonly string[]): void => {
  const keys = new Set(allowed);
  if (Object.keys(value).some((key) => !keys.has(key))) throw new Error('TOOL_ARGUMENTS_INVALID');
};

const stringValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
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
  repository: AgentWorkspaceRepositoryPort,
  cryptoHash: CryptoHashPort,
  workspaceId: string,
  context: ToolContext,
): Promise<{
  generation: number;
  target: ToolInspection['target'];
  resourceKeys: string[];
  preconditions: ToolPrecondition[];
}> => {
  const workspace = await repository.getWorkspace(context, workspaceId);
  if (!workspace) throw new Error('NOT_FOUND');
  if (workspace.runId !== context.runId || workspace.agentRuntimeId !== context.agentRuntimeId) {
    throw new Error('RESOURCE_FORBIDDEN');
  }
  if (workspace.status !== 'running') throw new Error('WORKSPACE_NOT_RUNNING');
  const target: ToolInspection['target'] = {
    kind: 'workspace',
    workspaceId,
    generation: workspace.generation,
    targetIdentity: `workspace:${workspaceId}:${workspace.generation}`,
    endpoint: `workspace:${workspaceId}`,
    loginUser: 'runner:65532',
    configurationHash: hashOperation(
      {
        schemaVersion: 2,
        workspaceId,
        generation: workspace.generation,
        profile: JSON.parse(JSON.stringify(workspace.profile)) as JsonValue,
      },
      cryptoHash,
    ),
  };
  return {
    generation: workspace.generation,
    target,
    resourceKeys: [`workspace:${workspaceId}:${workspace.generation}`],
    preconditions: [
      {
        kind: 'workspaceGeneration',
        key: workspaceId,
        observedValue: {
          generation: workspace.generation,
          version: workspace.version,
          status: workspace.status,
        },
      },
    ],
  };
};

const readResult = (data: Awaited<ReturnType<WorkspaceRuntimeService['readWorkspaceFile']>>): ToolResult => ({
  ok: true,
  summary: `Read ${data.path} (${data.contentBytes} projected bytes of ${data.sizeBytes}).`,
  data: data as unknown as JsonValue,
  artifactRefs: [],
  truncated: data.truncated,
  outcome: 'confirmed',
  verification: {
    status: 'verified',
    summary: `Runner read ${data.path} from the requested Workspace generation and returned source SHA-256.`,
    evidenceRefs: [],
  },
});

export const createWorkspaceReadFileTool = (
  repository: AgentWorkspaceRepositoryPort,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_read_file',
    version: '1.0.0',
    description:
      'Read bounded UTF-8 text from a file under /workspace/work. Supports line ranges or a byte offset and returns the full-source SHA-256 for safe follow-up edits.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
        offsetBytes: { type: 'integer', minimum: 0 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 64 * 1024 },
      },
      required: ['workspaceId', 'path'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'workspace.runtime.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'path', 'startLine', 'endLine', 'offsetBytes', 'maxBytes', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const path = stringValue(args.path, MAX_PATH_BYTES);
    const startLine = optionalInteger(args.startLine, { minimum: 1, maximum: 10_000_000 });
    const endLine = optionalInteger(args.endLine, { minimum: 1, maximum: 10_000_000 });
    const offsetBytes = optionalInteger(args.offsetBytes, { minimum: 0, maximum: 8 * 1024 * 1024 });
    const maxBytes = optionalInteger(args.maxBytes, { minimum: 1, maximum: 64 * 1024 });
    if (offsetBytes !== undefined && (startLine !== undefined || endLine !== undefined)) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const binding = await workspaceInspection(repository, cryptoHash, workspaceId, context);
    const normalizedArguments: JsonValue = {
      workspaceId,
      generation: binding.generation,
      path,
      ...(startLine === undefined ? {} : { startLine }),
      ...(endLine === undefined ? {} : { endLine }),
      ...(offsetBytes === undefined ? {} : { offsetBytes }),
      ...(maxBytes === undefined ? {} : { maxBytes }),
    };
    return {
      toolName: 'workspace_read_file',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: binding.target,
      resourceKeys: binding.resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operationHash(
        cryptoHash,
        'workspace_read_file',
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
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = optionalInteger(args.generation, { minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
    if (generation === undefined) throw new Error('TOOL_ARGUMENTS_INVALID');
    return readResult(
      await runtime.readWorkspaceFile(
        context,
        workspaceId,
        generation,
        {
          path: stringValue(args.path, MAX_PATH_BYTES),
          ...(args.startLine === undefined ? {} : { startLine: Number(args.startLine) }),
          ...(args.endLine === undefined ? {} : { endLine: Number(args.endLine) }),
          ...(args.offsetBytes === undefined ? {} : { offsetBytes: Number(args.offsetBytes) }),
          maxBytes: Math.max(
            1,
            Math.min(
              64 * 1024,
              Math.floor(context.maxOutputBytes / 2),
              args.maxBytes === undefined ? 64 * 1024 : Number(args.maxBytes),
            ),
          ),
        },
        context.signal,
      ),
    );
  },
});

export const createWorkspaceSearchTool = (
  repository: AgentWorkspaceRepositoryPort,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_search',
    version: '1.0.0',
    description:
      'Search bounded UTF-8 source text under /workspace/work with a regular-expression query, optional path/glob scope, result limit, and context lines.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        query: { type: 'string', minLength: 1, maxLength: 1024 },
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
        glob: { type: 'string', minLength: 1, maxLength: 512 },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        contextLines: { type: 'integer', minimum: 0, maximum: 5 },
      },
      required: ['workspaceId', 'query'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'workspace.runtime.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'query', 'path', 'glob', 'maxResults', 'contextLines', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const query = stringValue(args.query, 1024);
    const path = args.path === undefined ? '/workspace/work' : stringValue(args.path, MAX_PATH_BYTES);
    const glob = args.glob === undefined ? undefined : stringValue(args.glob, 512);
    const maxResults = optionalInteger(args.maxResults, { minimum: 1, maximum: 100, fallback: 20 })!;
    const contextLines = optionalInteger(args.contextLines, { minimum: 0, maximum: 5, fallback: 2 })!;
    const binding = await workspaceInspection(repository, cryptoHash, workspaceId, context);
    const normalizedArguments: JsonValue = {
      workspaceId,
      generation: binding.generation,
      query,
      path,
      ...(glob === undefined ? {} : { glob }),
      maxResults,
      contextLines,
    };
    return {
      toolName: 'workspace_search',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: binding.target,
      resourceKeys: binding.resourceKeys,
      risk: 'read',
      mutation: false,
      operationHash: operationHash(
        cryptoHash,
        'workspace_search',
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
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = Number(args.generation);
    const result = await runtime.searchWorkspace(
      context,
      workspaceId,
      generation,
      {
        query: stringValue(args.query, 1024),
        path: stringValue(args.path, MAX_PATH_BYTES),
        ...(args.glob === undefined ? {} : { glob: stringValue(args.glob, 512) }),
        maxResults: Number(args.maxResults),
        contextLines: Number(args.contextLines),
        maxOutputBytes: Math.max(1024, Math.min(256 * 1024, Math.floor(context.maxOutputBytes / 2))),
      },
      context.signal,
    );
    return {
      ok: true,
      summary: `Found ${result.matches.length} match(es) under ${result.path} using ${result.engine}.`,
      data: result as unknown as JsonValue,
      artifactRefs: [],
      truncated: result.truncated,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: 'Runner searched the requested Workspace generation with bounded output.',
        evidenceRefs: [],
      },
    };
  },
});


export const createWorkspaceRepoMapTool = (
  repository: AgentWorkspaceRepositoryPort,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_repo_map',
    version: '1.0.0',
    description:
      'Return a bounded, read-only repository navigation map for TypeScript/JavaScript files under /workspace/work. Includes file SHA-256, imports, and symbol signatures. This is navigation context; read the authoritative file before editing.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
        query: { type: 'string', maxLength: 1024 },
        maxFiles: { type: 'integer', minimum: 1, maximum: 64 },
        maxSymbols: { type: 'integer', minimum: 1, maximum: 160 },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 16 * 1024 },
      },
      required: ['workspaceId'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'workspace.runtime.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'path', 'query', 'maxFiles', 'maxSymbols', 'maxBytes', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const path = args.path === undefined ? '/workspace/work' : stringValue(args.path, MAX_PATH_BYTES);
    const query = args.query === undefined ? undefined : stringValue(args.query, 1024);
    const maxFiles = optionalInteger(args.maxFiles, { minimum: 1, maximum: 64, fallback: 16 })!;
    const maxSymbols = optionalInteger(args.maxSymbols, { minimum: 1, maximum: 160, fallback: 64 })!;
    const maxBytes = optionalInteger(args.maxBytes, {
      minimum: 1024,
      maximum: 16 * 1024,
      fallback: 8 * 1024,
    })!;
    const binding = await workspaceInspection(repository, cryptoHash, workspaceId, context);
    const normalizedArguments: JsonValue = {
      workspaceId,
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
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = Number(args.generation);
    const result = await runtime.repoMap(
      context,
      workspaceId,
      generation,
      {
        path: stringValue(args.path, MAX_PATH_BYTES),
        ...(args.query === undefined ? {} : { query: stringValue(args.query, 1024) }),
        maxFiles: Number(args.maxFiles),
        maxSymbols: Number(args.maxSymbols),
        maxOutputBytes: Math.max(
          1024,
          Math.min(
            16 * 1024,
            Math.floor(context.maxOutputBytes / 2),
            Number(args.maxBytes),
          ),
        ),
      },
      context.signal,
    );
    return {
      ok: true,
      summary: `Mapped ${result.files.length} file(s) from ${result.indexedFiles} indexed TypeScript/JavaScript source file(s).`,
      data: {
        generation,
        ...result,
      } as unknown as JsonValue,
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
  repository: AgentWorkspaceRepositoryPort,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
): AgentTool => ({
  descriptor: {
    name: 'workspace_code_intel',
    version: '1.0.0',
    description:
      'Query bounded TypeScript/JavaScript symbols, definitions, references, or diagnostics using the Workspace TypeScript compiler service. Unsupported languages return an explicit workspace_search/workspace_read_file fallback.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        action: { type: 'string', enum: ['symbols', 'definition', 'references', 'diagnostics'] },
        path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
        line: { type: 'integer', minimum: 1 },
        column: { type: 'integer', minimum: 1 },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        maxBytes: { type: 'integer', minimum: 1024, maximum: 64 * 1024 },
      },
      required: ['workspaceId', 'action', 'path'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'workspace.runtime.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'action', 'path', 'line', 'column', 'maxResults', 'maxBytes', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const action = stringValue(args.action, 32);
    if (!['symbols', 'definition', 'references', 'diagnostics'].includes(action)) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const path = stringValue(args.path, MAX_PATH_BYTES);
    const line = optionalInteger(args.line, { minimum: 1, maximum: 10_000_000 });
    const column = optionalInteger(args.column, { minimum: 1, maximum: 10_000_000 });
    const needsPosition = action === 'definition' || action === 'references';
    if (needsPosition ? line === undefined || column === undefined : line !== undefined || column !== undefined) {
      throw new Error('TOOL_ARGUMENTS_INVALID');
    }
    const maxResults = optionalInteger(args.maxResults, { minimum: 1, maximum: 100, fallback: 50 })!;
    const maxBytes = optionalInteger(args.maxBytes, {
      minimum: 1024,
      maximum: 64 * 1024,
      fallback: 24 * 1024,
    })!;
    const binding = await workspaceInspection(repository, cryptoHash, workspaceId, context);
    const normalizedArguments: JsonValue = {
      workspaceId,
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
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = Number(args.generation);
    const action = stringValue(args.action, 32) as 'symbols' | 'definition' | 'references' | 'diagnostics';
    const result = await runtime.codeIntel(
      context,
      workspaceId,
      generation,
      {
        action,
        path: stringValue(args.path, MAX_PATH_BYTES),
        ...(args.line === undefined ? {} : { line: Number(args.line) }),
        ...(args.column === undefined ? {} : { column: Number(args.column) }),
        maxResults: Number(args.maxResults),
        maxOutputBytes: Math.max(
          1024,
          Math.min(
            64 * 1024,
            Math.floor(context.maxOutputBytes / 2),
            Number(args.maxBytes),
          ),
        ),
      },
      context.signal,
    );
    return {
      ok: true,
      summary: result.supported
        ? `Returned ${result.results.length} ${action} result(s) from TypeScript native code intelligence.`
        : `Code intelligence is unavailable for ${result.path}; use ${result.fallback?.searchTool} and ${result.fallback?.readTool}.`,
      data: {
        generation,
        ...result,
      } as unknown as JsonValue,
      artifactRefs: [],
      truncated: result.truncated,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary: result.supported
          ? 'Runner answered from a generation-bound, file-hash-refreshed TypeScript projection.'
          : 'Runner explicitly reported an unsupported or unindexed language and returned the existing authoritative search/read fallback.',
        evidenceRefs: [],
      },
    };
  },
});

const expectedFilesValue = (value: JsonValue | undefined): Array<{ path: string; sha256: string }> => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PATCH_FILES) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value.map((item) => {
    const entry = record(item);
    onlyKeys(entry, ['path', 'sha256']);
    const path = stringValue(entry.path, MAX_PATH_BYTES);
    const sha256 = stringValue(entry.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('TOOL_ARGUMENTS_INVALID');
    return { path, sha256 };
  });
};

export const createWorkspaceApplyPatchTool = (
  repository: AgentWorkspaceRepositoryPort,
  runtime: WorkspaceRuntimeService,
  cryptoHash: CryptoHashPort,
  artifacts: Pick<ArtifactService, 'begin' | 'write'> | null = null,
): AgentTool => ({
  descriptor: {
    name: 'workspace_apply_patch',
    version: '1.0.0',
    description:
      'Apply a strict unified diff to existing UTF-8 files under /workspace/work. Every target file requires an expected SHA-256 precondition. Uses exact hunk context and fuzz=0.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        workspaceId: { type: 'string', minLength: 1, maxLength: 128 },
        patch: { type: 'string', minLength: 1, maxLength: MAX_PATCH_BYTES },
        expectedFiles: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_PATCH_FILES,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              path: { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES },
              sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            },
            required: ['path', 'sha256'],
          },
        },
      },
      required: ['workspaceId', 'patch', 'expectedFiles'],
    },
    riskClass: 'mutate',
    capability: 'workspace.runtime.execute',
  },
  isAvailable: ({ environment }) => environment !== null,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['workspaceId', 'patch', 'expectedFiles', 'generation']);
    const workspaceId = stringValue(args.workspaceId, 128);
    const patch = stringValue(args.patch, MAX_PATCH_BYTES);
    const expectedFiles = expectedFilesValue(args.expectedFiles);
    const binding = await workspaceInspection(repository, cryptoHash, workspaceId, context);
    const dryRun = await runtime.applyWorkspacePatch(
      context,
      workspaceId,
      binding.generation,
      { patch, expectedFiles, dryRun: true },
      context.signal,
    );
    if (dryRun.applied || dryRun.changes.length !== expectedFiles.length) throw new Error('WORKSPACE_PATCH_INVALID');
    const canonicalExpectedFiles = dryRun.changes.map((change) => ({
      path: change.path,
      sha256: change.beforeSha256,
    }));
    const preconditions: ToolPrecondition[] = [
      ...binding.preconditions,
      ...canonicalExpectedFiles.map((item) => ({
        kind: 'fileHash' as const,
        key: item.path,
        observedValue: item.sha256,
      })),
    ];
    const normalizedArguments: JsonValue = {
      workspaceId,
      generation: binding.generation,
      patch,
      expectedFiles: canonicalExpectedFiles,
    };
    return {
      toolName: 'workspace_apply_patch',
      toolVersion: '1.0.0',
      normalizedArguments,
      target: binding.target,
      resourceKeys: binding.resourceKeys,
      risk: 'mutate',
      mutation: true,
      operationHash: operationHash(
        cryptoHash,
        'workspace_apply_patch',
        context,
        binding.target,
        normalizedArguments,
        binding.resourceKeys,
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
    const workspaceId = stringValue(args.workspaceId, 128);
    const generation = Number(args.generation);
    const patch = stringValue(args.patch, MAX_PATCH_BYTES);
    let patchArtifactId: string | null = null;
    if (artifacts) {
      const bytes = Buffer.from(patch, 'utf8');
      const reservation = await artifacts.begin(context, {
        name: `workspace-${workspaceId}-g${generation}.diff`,
        mediaType: 'text/x-diff',
        declaredBytes: bytes.byteLength,
      });
      const source = (async function* (): AsyncGenerator<Uint8Array> {
        yield bytes;
      })();
      const artifact = await artifacts.write(context, reservation.artifactId, source, context.signal);
      patchArtifactId = artifact.id;
    }
    const result = await runtime.applyWorkspacePatch(
      context,
      workspaceId,
      generation,
      {
        patch,
        expectedFiles: expectedFilesValue(args.expectedFiles),
      },
      context.signal,
    );
    if (!result.applied) throw new Error('WORKSPACE_PATCH_NOT_APPLIED');
    const additions = result.changes.reduce((total, change) => total + change.additions, 0);
    const deletions = result.changes.reduce((total, change) => total + change.deletions, 0);
    return {
      ok: true,
      summary: `Applied patch to ${result.changes.length} file(s): +${additions}/-${deletions} lines.`,
      data: {
        changes: result.changes,
        additions,
        deletions,
      } as unknown as JsonValue,
      artifactRefs: patchArtifactId ? [patchArtifactId] : [],
      truncated: false,
      outcome: 'confirmed',
      verification: {
        status: 'verified',
        summary:
          'Runner applied the strict patch and returned before/after SHA-256 change evidence; the applied patch is preserved as an Artifact when Artifact storage is available.',
        evidenceRefs: patchArtifactId ? [patchArtifactId] : [],
      },
    };
  },
});
