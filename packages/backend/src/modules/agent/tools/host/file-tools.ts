import type { JsonValue } from '../../agent.types';
import type { CryptoHashPort } from '../../crypto-hash.port';
import { hashOperation } from '../../operation-hash';
import type { FileCapabilityService, UnifiedFileStat } from '../../capabilities/file-capability.service';
import type { AgentTargetKind } from '../../capabilities/tool-target.types';
import type {
  AgentTool,
  ToolContext,
  ToolInspection,
  ToolPrecondition,
  ToolResult,
  ToolUserSummary,
} from '../../capabilities/tool.types';

const MAX_PATH_BYTES = 4096;
const MAX_ID_BYTES = 128;
const MAX_CONTENT_BYTES = 24 * 1024;
const MAX_PATCH_BYTES = 24 * 1024;

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
const contentValue = (value: JsonValue | undefined, maxBytes: number): string => {
  if (typeof value !== 'string' || value.includes('\0') || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('TOOL_ARGUMENTS_INVALID');
  }
  return value;
};
const targetKind = (value: JsonValue | undefined): AgentTargetKind => {
  if (value !== 'workspace' && value !== 'ssh') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value;
};
const boundedInteger = (value: JsonValue | undefined, min: number, max: number, fallback: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error('TOOL_ARGUMENTS_INVALID');
  return Number(value);
};
const booleanValue = (value: JsonValue | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('TOOL_ARGUMENTS_INVALID');
  return value;
};
const selectorFrom = (args: Record<string, JsonValue>) => ({
  target: targetKind(args.target),
  id: stringValue(args.id, MAX_ID_BYTES),
});
const statePreconditions = (state: UnifiedFileStat): ToolPrecondition[] => [
  { kind: 'fileHash', key: state.path, observedValue: state.type === 'file' ? state.sha256 : null },
  {
    kind: 'metadata',
    key: state.path,
    observedValue: {
      exists: state.exists,
      type: state.type,
      sizeBytes: state.sizeBytes,
      modifiedAt: state.modifiedAt === null ? null : Math.trunc(state.modifiedAt),
      mode: state.mode,
    },
  },
];
const operation = (
  cryptoHash: CryptoHashPort,
  context: ToolContext,
  toolName: string,
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
        connectionId: target.connectionId ?? null,
        workspaceId: target.workspaceId ?? null,
        generation: target.generation ?? null,
      },
      arguments: normalizedArguments,
      resourceKeys: [...new Set(resourceKeys)].sort(),
      preconditions: [...preconditions]
        .sort((a, b) => `${a.kind}\0${a.key}`.localeCompare(`${b.kind}\0${b.key}`))
        .map((item) => ({ kind: item.kind, key: item.key, observedValue: item.observedValue })),
      policyRevision,
      inputRevision: context.inputRevision,
    },
    cryptoHash,
  );
const confirmed = (
  summary: string,
  data: JsonValue,
  verification: string,
  truncated = false,
  userSummary?: ToolUserSummary,
): ToolResult => ({
  ok: true,
  summary,
  ...(userSummary ? { userSummary } : {}),
  data,
  artifactRefs: [],
  truncated,
  outcome: 'confirmed',
  verification: { status: 'verified', summary: verification, evidenceRefs: [] },
});
const targetSchema: Record<string, JsonValue> = {
  target: { type: 'string', enum: ['workspace', 'ssh'] },
  id: { type: 'string', minLength: 1, maxLength: MAX_ID_BYTES },
};
const pathSchema: Record<string, JsonValue> = { type: 'string', minLength: 1, maxLength: MAX_PATH_BYTES };
const targetAvailable = ({
  environment,
  connectionIds,
}: {
  environment: unknown;
  connectionIds?: readonly number[];
}): boolean => environment !== null || connectionIds === undefined || connectionIds.length > 0;

const readInspection = async (
  files: FileCapabilityService,
  cryptoHash: CryptoHashPort,
  toolName: string,
  args: Record<string, JsonValue>,
  context: ToolContext,
  policyRevision: number,
  state: UnifiedFileStat,
  normalizedArguments: JsonValue,
): Promise<ToolInspection> => {
  const resolved = await files.resolve(context, selectorFrom(args));
  const resourceKeys = [...resolved.resourceKeys, files.resourceKey(resolved, state.path)];
  const preconditions = [...resolved.preconditions, ...statePreconditions(state)];
  return {
    toolName,
    toolVersion: '1.0.0',
    normalizedArguments,
    target: resolved.fingerprint,
    resourceKeys,
    risk: 'read',
    mutation: false,
    operationHash: operation(
      cryptoHash,
      context,
      toolName,
      resolved.fingerprint,
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
};

export const createFileReadTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_read',
    version: '1.0.0',
    description:
      'Read bounded UTF-8 text from a Workspace or SSH file selected by target + id. Returns a stable source SHA-256.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...targetSchema,
        path: pathSchema,
        offsetBytes: { type: 'integer', minimum: 0 },
        maxBytes: { type: 'integer', minimum: 1, maximum: 64 * 1024 },
      },
      required: ['target', 'id', 'path'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'file.read',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'offsetBytes', 'maxBytes']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const state = await files.stat(context, resolved, stringValue(args.path, MAX_PATH_BYTES));
    if (!state.exists || state.type !== 'file' || !state.sha256) throw new Error('NOT_FOUND');
    return readInspection(files, cryptoHash, 'file_read', args, context, policyRevision, state, {
      target: resolved.selector.target,
      id: resolved.selector.id,
      path: state.path,
      offsetBytes: boundedInteger(args.offsetBytes, 0, Number.MAX_SAFE_INTEGER, 0),
      maxBytes: boundedInteger(args.maxBytes, 1, 64 * 1024, 64 * 1024),
    });
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const data = await files.read(
      context,
      resolved,
      stringValue(args.path, MAX_PATH_BYTES),
      boundedInteger(args.offsetBytes, 0, Number.MAX_SAFE_INTEGER, 0),
      boundedInteger(args.maxBytes, 1, 64 * 1024, 64 * 1024),
    );
    return confirmed(
      `Read ${data.contentBytes} byte(s) from ${data.path}.`,
      data as unknown as JsonValue,
      'The selected target returned bounded UTF-8 content and a stable file SHA-256.',
      data.truncated,
      { key: 'agent.conversation.toolSummary.fileRead', params: { bytes: data.contentBytes, path: data.path } },
    );
  },
});

export const createFileListTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_list',
    version: '1.0.0',
    description: 'List bounded directory entries on a Workspace or SSH target selected by target + id.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...targetSchema, path: pathSchema, maxEntries: { type: 'integer', minimum: 1, maximum: 500 } },
      required: ['target', 'id', 'path'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'file.read',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'maxEntries']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const state = await files.stat(context, resolved, stringValue(args.path, MAX_PATH_BYTES));
    if (!state.exists || state.type !== 'directory') throw new Error('NOT_FOUND');
    return readInspection(files, cryptoHash, 'file_list', args, context, policyRevision, state, {
      target: resolved.selector.target,
      id: resolved.selector.id,
      path: state.path,
      maxEntries: boundedInteger(args.maxEntries, 1, 500, 100),
    });
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const data = await files.list(
      context,
      resolved,
      stringValue(args.path, MAX_PATH_BYTES),
      boundedInteger(args.maxEntries, 1, 500, 100),
    );
    return confirmed(
      `Listed ${data.entries.length} entries under ${data.path}.`,
      data as unknown as JsonValue,
      'The target filesystem returned bounded non-symlink directory entries.',
      data.truncated,
      { key: 'agent.conversation.toolSummary.fileList', params: { count: data.entries.length, path: data.path } },
    );
  },
});

export const createFileSearchTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_search',
    version: '1.0.0',
    description: 'Search bounded UTF-8 text on a Workspace or SSH target using the same target + id schema.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...targetSchema,
        path: pathSchema,
        query: { type: 'string', minLength: 1, maxLength: 1024 },
        glob: { type: 'string', minLength: 1, maxLength: 512 },
        maxResults: { type: 'integer', minimum: 1, maximum: 100 },
        contextLines: { type: 'integer', minimum: 0, maximum: 5 },
      },
      required: ['target', 'id', 'path', 'query'],
    },
    riskClass: 'read',
    parallelSafe: true,
    capability: 'file.read',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'query', 'glob', 'maxResults', 'contextLines']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const state = await files.stat(context, resolved, stringValue(args.path, MAX_PATH_BYTES));
    if (!state.exists) throw new Error('NOT_FOUND');
    return readInspection(files, cryptoHash, 'file_search', args, context, policyRevision, state, {
      target: resolved.selector.target,
      id: resolved.selector.id,
      path: state.path,
      query: stringValue(args.query, 1024),
      ...(args.glob === undefined ? {} : { glob: stringValue(args.glob, 512) }),
      maxResults: boundedInteger(args.maxResults, 1, 100, 20),
      contextLines: boundedInteger(args.contextLines, 0, 5, 2),
    });
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const data = await files.search(context, resolved, {
      query: stringValue(args.query, 1024),
      path: stringValue(args.path, MAX_PATH_BYTES),
      ...(args.glob === undefined ? {} : { glob: stringValue(args.glob, 512) }),
      maxResults: boundedInteger(args.maxResults, 1, 100, 20),
      contextLines: boundedInteger(args.contextLines, 0, 5, 2),
      maxOutputBytes: Math.max(1024, Math.min(256 * 1024, Math.floor(context.maxOutputBytes / 2))),
    });
    return confirmed(
      `Found ${data.matches.length} match(es) under ${data.path}.`,
      data as unknown as JsonValue,
      'The target adapter searched bounded UTF-8 source text without invoking model-authorized shell execution.',
      data.truncated,
      { key: 'agent.conversation.toolSummary.fileSearch', params: { count: data.matches.length, path: data.path } },
    );
  },
});

const expectedSha256 = (args: Record<string, JsonValue>, current: string | null): string | null => {
  if (args.expectedSha256 === undefined) return current;
  if (args.expectedSha256 === null) {
    if (current !== null) throw new Error('RESOURCE_CHANGED');
    return null;
  }
  const expected = stringValue(args.expectedSha256, 64);
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== current) throw new Error('RESOURCE_CHANGED');
  return expected;
};

const mutationInspection = async (
  files: FileCapabilityService,
  cryptoHash: CryptoHashPort,
  toolName: string,
  capabilityRisk: 'mutate' | 'destructive',
  args: Record<string, JsonValue>,
  context: ToolContext,
  policyRevision: number,
  states: UnifiedFileStat[],
  normalizedArguments: JsonValue,
): Promise<ToolInspection> => {
  const resolved = await files.resolve(context, selectorFrom(args));
  const resourceKeys = [...resolved.resourceKeys, ...states.map((state) => files.resourceKey(resolved, state.path))];
  const preconditions = [...resolved.preconditions, ...states.flatMap(statePreconditions)];
  return {
    toolName,
    toolVersion: '1.0.0',
    normalizedArguments,
    target: resolved.fingerprint,
    resourceKeys,
    risk: capabilityRisk,
    mutation: true,
    operationHash: operation(
      cryptoHash,
      context,
      toolName,
      resolved.fingerprint,
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
};

export const createFileWriteTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_write',
    version: '1.0.0',
    description:
      'Atomically create or replace one UTF-8 file on a Workspace or SSH target. Host-resolved hash and metadata preconditions prevent stale writes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...targetSchema, path: pathSchema, content: { type: 'string', maxLength: MAX_CONTENT_BYTES } },
      required: ['target', 'id', 'path', 'content'],
    },
    riskClass: 'mutate',
    capability: 'file.write',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'content', 'expectedSha256']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const state = await files.stat(context, resolved, stringValue(args.path, MAX_PATH_BYTES));
    if (state.type === 'directory') throw new Error('RESOURCE_FORBIDDEN');
    const expected = expectedSha256(args, state.sha256);
    return mutationInspection(files, cryptoHash, 'file_write', 'mutate', args, context, policyRevision, [state], {
      target: resolved.selector.target,
      id: resolved.selector.id,
      path: state.path,
      content: contentValue(args.content, MAX_CONTENT_BYTES),
      expectedSha256: expected,
    });
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const data = await files.write(
      context,
      resolved,
      stringValue(args.path, MAX_PATH_BYTES),
      contentValue(args.content, MAX_CONTENT_BYTES),
      args.expectedSha256 === null ? null : stringValue(args.expectedSha256, 64),
    );
    return confirmed(
      `${data.created ? 'Created' : 'Wrote'} ${data.path}.`,
      data as unknown as JsonValue,
      'The file was atomically replaced and re-read to verify the resulting SHA-256.',
      false,
      {
        key: data.created
          ? 'agent.conversation.toolSummary.fileCreated'
          : 'agent.conversation.toolSummary.fileReplaced',
        params: { path: data.path },
      },
    );
  },
});

const expectedFilesMap = (value: JsonValue | undefined): Map<string, string> | undefined => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error('TOOL_ARGUMENTS_INVALID');
  const map = new Map<string, string>();
  for (const item of value) {
    const entry = record(item);
    onlyKeys(entry, ['path', 'sha256']);
    const path = stringValue(entry.path, MAX_PATH_BYTES);
    const digest = stringValue(entry.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(digest) || map.has(path)) throw new Error('TOOL_ARGUMENTS_INVALID');
    map.set(path, digest);
  }
  return map;
};

export const createFilePatchTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_patch',
    version: '1.0.0',
    description:
      'Apply a strict unified diff with exact declared hunk context and fuzz=0 on either Workspace or SSH. Create/delete/rename patches are rejected.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...targetSchema, patch: { type: 'string', minLength: 1, maxLength: MAX_PATCH_BYTES } },
      required: ['target', 'id', 'patch'],
    },
    riskClass: 'mutate',
    capability: 'file.write',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'patch', 'expectedFiles']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const patch = stringValue(args.patch, MAX_PATCH_BYTES);
    const prepared = await files.preparePatch(context, resolved, patch, expectedFilesMap(args.expectedFiles));
    const states = await Promise.all(prepared.map((change) => files.stat(context, resolved, change.path)));
    return mutationInspection(files, cryptoHash, 'file_patch', 'mutate', args, context, policyRevision, states, {
      target: resolved.selector.target,
      id: resolved.selector.id,
      patch,
      expectedFiles: prepared.map((change) => ({ path: change.path, sha256: change.beforeSha256 })),
    });
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const expected = expectedFilesMap(args.expectedFiles);
    if (!expected) throw new Error('TOOL_STATE_CONFLICT');
    const changes = await files.applyPreparedPatch(
      context,
      resolved,
      stringValue(args.patch, MAX_PATCH_BYTES),
      expected,
    );
    const additions = changes.reduce((sum, change) => sum + change.additions, 0);
    const deletions = changes.reduce((sum, change) => sum + change.deletions, 0);
    return confirmed(
      `Applied patch to ${changes.length} file(s): +${additions}/-${deletions} lines.`,
      { changes, additions, deletions } as unknown as JsonValue,
      'Every patched file matched its frozen source hash; exact-context patching was applied and resulting hashes were verified.',
      false,
      {
        key: 'agent.conversation.toolSummary.filePatch',
        params: { files: changes.length, added: additions, removed: deletions },
      },
    );
  },
});

export const createFileMoveTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_move',
    version: '1.0.0',
    description:
      'Move or rename one file or directory on a Workspace or SSH target. Source and destination metadata are frozen during inspection.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...targetSchema, path: pathSchema, destinationPath: pathSchema },
      required: ['target', 'id', 'path', 'destinationPath'],
    },
    riskClass: 'mutate',
    capability: 'file.write',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'destinationPath', 'expectedSha256']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const [source, destination] = await Promise.all([
      files.stat(context, resolved, stringValue(args.path, MAX_PATH_BYTES)),
      files.stat(context, resolved, stringValue(args.destinationPath, MAX_PATH_BYTES)),
    ]);
    if (!source.exists || source.type === null || destination.exists || source.path === destination.path)
      throw new Error('RESOURCE_CHANGED');
    const expected = expectedSha256(args, source.type === 'file' ? source.sha256 : null);
    return mutationInspection(
      files,
      cryptoHash,
      'file_move',
      'mutate',
      args,
      context,
      policyRevision,
      [source, destination],
      {
        target: resolved.selector.target,
        id: resolved.selector.id,
        path: source.path,
        destinationPath: destination.path,
        expectedSha256: expected,
      },
    );
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const data = await files.move(
      context,
      resolved,
      stringValue(args.path, MAX_PATH_BYTES),
      stringValue(args.destinationPath, MAX_PATH_BYTES),
      args.expectedSha256 === null ? null : stringValue(args.expectedSha256, 64),
    );
    return confirmed(
      `Moved ${data.path} to ${data.destinationPath}.`,
      data as unknown as JsonValue,
      'The source precondition was rechecked, the move completed, the source disappeared, and destination identity was verified.',
      false,
      {
        key: 'agent.conversation.toolSummary.fileMove',
        params: { path: data.path, destination: data.destinationPath },
      },
    );
  },
});

export const createFileDeleteTool = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool => ({
  descriptor: {
    name: 'file_delete',
    version: '1.0.0',
    description:
      'Delete one file or directory on a Workspace or SSH target. Recursive directory deletion is explicit and destructive.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...targetSchema, path: pathSchema, recursive: { type: 'boolean' } },
      required: ['target', 'id', 'path'],
    },
    riskClass: 'destructive',
    capability: 'file.delete',
  },
  isAvailable: targetAvailable,
  inspect: async (input, context, policyRevision) => {
    const args = record(input);
    onlyKeys(args, ['target', 'id', 'path', 'recursive', 'expectedSha256']);
    const resolved = await files.resolve(context, selectorFrom(args));
    const state = await files.stat(context, resolved, stringValue(args.path, MAX_PATH_BYTES));
    if (!state.exists || state.type === null) throw new Error('NOT_FOUND');
    const expected = expectedSha256(args, state.type === 'file' ? state.sha256 : null);
    return mutationInspection(files, cryptoHash, 'file_delete', 'destructive', args, context, policyRevision, [state], {
      target: resolved.selector.target,
      id: resolved.selector.id,
      path: state.path,
      recursive: booleanValue(args.recursive, false),
      expectedSha256: expected,
    });
  },
  execute: async (inspection, context) => {
    const args = record(inspection.normalizedArguments);
    const resolved = files.bindInspectionTarget(inspection.target);
    const data = await files.delete(
      context,
      resolved,
      stringValue(args.path, MAX_PATH_BYTES),
      booleanValue(args.recursive, false),
      args.expectedSha256 === null ? null : stringValue(args.expectedSha256, 64),
    );
    return confirmed(
      `Deleted ${data.path}.`,
      data as unknown as JsonValue,
      'The frozen source precondition was rechecked and the target confirmed the path no longer exists.',
      false,
      { key: 'agent.conversation.toolSummary.fileDelete', params: { path: data.path } },
    );
  },
});

export const createUnifiedFileTools = (files: FileCapabilityService, cryptoHash: CryptoHashPort): AgentTool[] => [
  createFileReadTool(files, cryptoHash),
  createFileListTool(files, cryptoHash),
  createFileSearchTool(files, cryptoHash),
  createFileWriteTool(files, cryptoHash),
  createFilePatchTool(files, cryptoHash),
  createFileMoveTool(files, cryptoHash),
  createFileDeleteTool(files, cryptoHash),
];
