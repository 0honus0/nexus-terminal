import type { JsonValue } from '../../../modules/agent/agent.types';
import type { ProjectInstructionProjection } from '../../../modules/agent/ai/project-instruction-source.port';
import type { WorkspaceJobView } from '../../../modules/agent/workspace-runtime/workspace-runtime-gateway.port';
import type {
  RunnerCommandResult,
  WorkspaceApplyPatchResult,
  RunnerWorkspaceProjection,
  WorkspaceFileDeleteResult,
  WorkspaceFileListResult,
  WorkspaceFileMoveResult,
  WorkspaceFileReadResult,
  WorkspaceFileStatResult,
  WorkspaceFileWriteResult,
  WorkspaceSearchResult,
  WorkspaceRepoMapResult,
  WorkspaceCodeIntelResult,
} from '../../../modules/agent/workspace-runtime/workspace-runtime-controller.port';
import type {
  WorkspaceRuntimeAvailability,
  WorkspaceRuntimeCatalog,
  WorkspaceRuntimeStorageView,
} from '../../../modules/agent/workspace-runtime/workspace-runtime.types';

const MAX_PROTOCOL_COLLECTION_ITEMS = 4096;
const MAX_STORAGE_WORKSPACES = 16_384;
const MAX_PROTOCOL_STRING_BYTES = 16 * 1024;
const MAX_WORKSPACE_JOB_OUTPUT_BYTES = 1024 * 1024;

const jsonValue = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

type UnknownRecord = Record<string, unknown>;

const protocolError = (): Error => new Error('WORKSPACE_RUNTIME_PROTOCOL_INVALID');

export const parseRunnerJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw protocolError();
  }
};

const recordValue = (value: unknown): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw protocolError();
  return value as UnknownRecord;
};

const stringValue = (value: unknown, nullable = false): string | null => {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_PROTOCOL_STRING_BYTES) throw protocolError();
  return value;
};

const boundedStringValue = (value: unknown, maxBytes: number): string => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) throw protocolError();
  return value;
};

const integerValue = (value: unknown, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw protocolError();
  return Number(value);
};

const booleanValue = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw protocolError();
  return value;
};

const stringArrayValue = (value: unknown, maxItems = 256): string[] => {
  if (!Array.isArray(value) || value.length > maxItems) throw protocolError();
  return value.map((item) => stringValue(item) as string);
};

export const decodeAvailability = (value: unknown): WorkspaceRuntimeAvailability => {
  const record = recordValue(value);
  if (record.mode !== 'native' || record.isolation !== 'logical') throw protocolError();
  return {
    available: booleanValue(record.available),
    reason: stringValue(record.reason, true),
    mode: 'native',
    isolation: 'logical',
  };
};

export const decodeCatalog = (value: unknown): WorkspaceRuntimeCatalog => {
  const record = recordValue(value);
  if (!Array.isArray(record.recipes) || record.recipes.length > 256) throw protocolError();
  if (!Array.isArray(record.packs) || record.packs.length > MAX_PROTOCOL_COLLECTION_ITEMS) throw protocolError();
  return {
    revision: stringValue(record.revision) as string,
    runtimeDigest: stringValue(record.runtimeDigest) as string,
    recipes: record.recipes.map((item) => {
      const recipe = recordValue(item);
      if (!['shell', 'code', 'data', 'browser'].includes(String(recipe.kind))) throw protocolError();
      return {
        id: stringValue(recipe.id) as string,
        revision: stringValue(recipe.revision) as string,
        kind: recipe.kind as WorkspaceRuntimeCatalog['recipes'][number]['kind'],
        displayName: stringValue(recipe.displayName) as string,
        allowedFamilies: stringArrayValue(recipe.allowedFamilies),
        defaultFamilies: stringArrayValue(recipe.defaultFamilies),
      };
    }),
    packs: record.packs.map((item) => {
      const pack = recordValue(item);
      if (!['supported', 'deprecated', 'unavailable'].includes(String(pack.status))) throw protocolError();
      return {
        familyId: stringValue(pack.familyId) as string,
        versionId: stringValue(pack.versionId) as string,
        displayName: stringValue(pack.displayName) as string,
        contentDigest: stringValue(pack.contentDigest) as string,
        diskBytes: integerValue(pack.diskBytes),
        status: pack.status as WorkspaceRuntimeCatalog['packs'][number]['status'],
        installed: booleanValue(pack.installed),
        enabled: booleanValue(pack.enabled),
        inUse: booleanValue(pack.inUse),
      };
    }),
  };
};

export const decodeStorage = (value: unknown): WorkspaceRuntimeStorageView => {
  const record = recordValue(value);
  if (!Array.isArray(record.byPack) || record.byPack.length > MAX_PROTOCOL_COLLECTION_ITEMS) throw protocolError();
  if (!Array.isArray(record.byWorkspace) || record.byWorkspace.length > MAX_STORAGE_WORKSPACES) throw protocolError();
  const filesystem = recordValue(record.filesystem);
  return {
    stateBytes: integerValue(record.stateBytes),
    packBytes: integerValue(record.packBytes),
    stagingPackBytes: integerValue(record.stagingPackBytes),
    cacheBytes: integerValue(record.cacheBytes),
    runtimeBytes: integerValue(record.runtimeBytes),
    quarantineBytes: integerValue(record.quarantineBytes),
    reclaimableBytes: integerValue(record.reclaimableBytes),
    byPack: record.byPack.map((item) => {
      const pack = recordValue(item);
      return {
        familyId: stringValue(pack.familyId) as string,
        versionId: stringValue(pack.versionId) as string,
        bytes: integerValue(pack.bytes),
        inUse: booleanValue(pack.inUse),
      };
    }),
    byWorkspace: record.byWorkspace.map((item) => {
      const workspace = recordValue(item);
      return {
        workspaceId: stringValue(workspace.workspaceId) as string,
        runtimeBytes: integerValue(workspace.runtimeBytes),
        status: stringValue(workspace.status) as string,
      };
    }),
    filesystem: {
      totalBytes: integerValue(filesystem.totalBytes),
      freeBytes: integerValue(filesystem.freeBytes),
    },
  };
};

interface RunnerCommandWireResponse {
  commandId: string;
  status: RunnerCommandResult['status'];
  result?: unknown;
  error?: unknown;
}

const commandStatuses = new Set<RunnerCommandResult['status']>([
  'pending',
  'running',
  'succeeded',
  'failed',
  'unknown',
]);

export const decodeCommandWireResponse = (value: unknown): RunnerCommandWireResponse => {
  const record = recordValue(value);
  if (typeof record.status !== 'string' || !commandStatuses.has(record.status as RunnerCommandResult['status']))
    throw protocolError();
  if (record.result !== undefined && record.error !== undefined) throw protocolError();
  return {
    commandId: stringValue(record.commandId) as string,
    status: record.status as RunnerCommandResult['status'],
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.error === undefined ? {} : { error: record.error }),
  };
};

export const decodeRunnerWorkspaceProjection = (value: unknown): RunnerWorkspaceProjection => {
  const record = recordValue(value);
  if (!['creating', 'ready', 'running', 'stopped', 'deleted', 'failed'].includes(String(record.status))) {
    throw protocolError();
  }
  return {
    workspaceId: stringValue(record.workspaceId) as string,
    generation: integerValue(record.generation, 1),
    status: record.status as RunnerWorkspaceProjection['status'],
  };
};

const jobStatuses = new Set<WorkspaceJobView['status']>([
  'pending',
  'running',
  'succeeded',
  'failed',
  'unknown',
  'cancelled',
]);

export const decodeWorkspaceJobView = (value: unknown): WorkspaceJobView => {
  const record = recordValue(value);
  if (typeof record.status !== 'string' || !jobStatuses.has(record.status as WorkspaceJobView['status']))
    throw protocolError();
  let result: WorkspaceJobView['result'] = null;
  if (record.result !== null) {
    const rawResult = recordValue(record.result);
    const exitCode = rawResult.exitCode === null ? null : integerValue(rawResult.exitCode);
    result = {
      exitCode,
      signal: stringValue(rawResult.signal, true),
      stdout: boundedStringValue(rawResult.stdout, MAX_WORKSPACE_JOB_OUTPUT_BYTES),
      stderr: boundedStringValue(rawResult.stderr, MAX_WORKSPACE_JOB_OUTPUT_BYTES),
      truncated: booleanValue(rawResult.truncated),
      timedOut: booleanValue(rawResult.timedOut),
    };
  }
  return {
    jobId: stringValue(record.jobId) as string,
    workspaceId: stringValue(record.workspaceId) as string,
    generation: integerValue(record.generation, 1),
    status: record.status as WorkspaceJobView['status'],
    result,
    error: stringValue(record.error, true),
    createdAt: integerValue(record.createdAt),
    completedAt: record.completedAt === null ? null : integerValue(record.completedAt),
  };
};

export const decodeWrittenBytes = (value: unknown): number => {
  const record = recordValue(value);
  return integerValue(record.writtenBytes);
};

export const decodeProjectInstructionProjection = (
  value: unknown,
): Omit<ProjectInstructionProjection, 'workspaceId' | 'generation'> => {
  const record = recordValue(value);
  const targetDirectories = stringArrayValue(record.targetDirectories, 8);
  if (!Array.isArray(record.instructions) || record.instructions.length > 16) throw protocolError();
  if (!Array.isArray(record.omitted) || record.omitted.length > 32) throw protocolError();
  const instructions = record.instructions.map((item) => {
    const entry = recordValue(item);
    const hash = stringValue(entry.hash) as string;
    if (!/^[a-f0-9]{64}$/.test(hash) || entry.provenance !== 'workspace') throw protocolError();
    return {
      path: stringValue(entry.path) as string,
      scopePath: stringValue(entry.scopePath) as string,
      projectRoot: stringValue(entry.projectRoot) as string,
      hash,
      content: stringValue(entry.content) as string,
      sourceBytes: integerValue(entry.sourceBytes),
      contentBytes: integerValue(entry.contentBytes),
      truncated: booleanValue(entry.truncated),
      provenance: 'workspace' as const,
    };
  });
  const omitted = record.omitted.map((item) => {
    const entry = recordValue(item);
    if (!['source_too_large', 'invalid_utf8', 'total_budget', 'too_many_files'].includes(String(entry.reason))) {
      throw protocolError();
    }
    return {
      path: stringValue(entry.path) as string,
      reason: entry.reason as 'source_too_large' | 'invalid_utf8' | 'total_budget' | 'too_many_files',
    };
  });
  return { targetDirectories, instructions, omitted };
};

export const decodeWorkspaceFileRead = (value: unknown): WorkspaceFileReadResult => {
  const record = recordValue(value);
  const digest = stringValue(record.sha256) as string;
  if (!/^[a-f0-9]{64}$/.test(digest)) throw protocolError();
  const nullableInteger = (item: unknown): number | null => (item === null ? null : integerValue(item));
  return {
    path: stringValue(record.path) as string,
    sha256: digest,
    sizeBytes: integerValue(record.sizeBytes),
    content: boundedStringValue(record.content, 64 * 1024),
    startLine: nullableInteger(record.startLine),
    endLine: nullableInteger(record.endLine),
    offsetBytes: nullableInteger(record.offsetBytes),
    contentBytes: integerValue(record.contentBytes),
    truncated: booleanValue(record.truncated),
  };
};

export const decodeWorkspaceFileStat = (value: unknown): WorkspaceFileStatResult => {
  const record = recordValue(value);
  if (record.type !== null && record.type !== 'file' && record.type !== 'directory') throw protocolError();
  const nullableInteger = (item: unknown): number | null => (item === null ? null : integerValue(item));
  const digest = record.sha256 === null ? null : (stringValue(record.sha256) as string);
  if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) throw protocolError();
  return {
    path: stringValue(record.path) as string,
    exists: booleanValue(record.exists),
    type: record.type,
    sizeBytes: nullableInteger(record.sizeBytes),
    modifiedAt: nullableInteger(record.modifiedAt),
    mode: nullableInteger(record.mode),
    sha256: digest,
  };
};

export const decodeWorkspaceFileWrite = (value: unknown): WorkspaceFileWriteResult => {
  const record = recordValue(value);
  const digest = stringValue(record.sha256) as string;
  if (!/^[a-f0-9]{64}$/.test(digest)) throw protocolError();
  return {
    path: stringValue(record.path) as string,
    sha256: digest,
    sizeBytes: integerValue(record.sizeBytes),
    modifiedAt: integerValue(record.modifiedAt),
    created: booleanValue(record.created),
  };
};

export const decodeWorkspaceFileList = (value: unknown): WorkspaceFileListResult => {
  const record = recordValue(value);
  if (!Array.isArray(record.entries) || record.entries.length > 500) throw protocolError();
  return {
    path: stringValue(record.path) as string,
    entries: record.entries.map((item) => {
      const entry = recordValue(item);
      if (entry.type !== 'file' && entry.type !== 'directory') throw protocolError();
      return {
        name: stringValue(entry.name) as string,
        path: stringValue(entry.path) as string,
        type: entry.type,
        sizeBytes: integerValue(entry.sizeBytes),
        modifiedAt: integerValue(entry.modifiedAt),
      };
    }),
    truncated: booleanValue(record.truncated),
  };
};

export const decodeWorkspaceFileMove = (value: unknown): WorkspaceFileMoveResult => {
  const record = recordValue(value);
  if (record.type !== 'file' && record.type !== 'directory') throw protocolError();
  const digest = record.sha256 === null ? null : (stringValue(record.sha256) as string);
  if (digest !== null && !/^[a-f0-9]{64}$/.test(digest)) throw protocolError();
  return {
    path: stringValue(record.path) as string,
    destinationPath: stringValue(record.destinationPath) as string,
    type: record.type,
    sha256: digest,
  };
};

export const decodeWorkspaceFileDelete = (value: unknown): WorkspaceFileDeleteResult => {
  const record = recordValue(value);
  if ((record.type !== 'file' && record.type !== 'directory') || record.deleted !== true) throw protocolError();
  return {
    path: stringValue(record.path) as string,
    type: record.type,
    deleted: true,
  };
};

export const decodeWorkspaceSearch = (value: unknown): WorkspaceSearchResult => {
  const record = recordValue(value);
  if (
    (record.engine !== 'rg' && record.engine !== 'fallback') ||
    !Array.isArray(record.matches) ||
    record.matches.length > 100
  ) {
    throw protocolError();
  }
  return {
    query: boundedStringValue(record.query, 1024),
    path: stringValue(record.path) as string,
    engine: record.engine,
    matches: record.matches.map((item) => {
      const match = recordValue(item);
      return {
        path: stringValue(match.path) as string,
        line: integerValue(match.line, 1),
        column: integerValue(match.column, 1),
        text: boundedStringValue(match.text, 4 * 1024),
        before: stringArrayValue(match.before, 5),
        after: stringArrayValue(match.after, 5),
      };
    }),
    truncated: booleanValue(record.truncated),
    scannedFiles: integerValue(record.scannedFiles),
    scannedBytes: integerValue(record.scannedBytes),
  };
};

export const decodeWorkspaceRepoMap = (value: unknown): WorkspaceRepoMapResult => {
  const record = recordValue(value);
  if (
    record.engine !== 'typescript-native' ||
    !Array.isArray(record.files) ||
    record.files.length > 64 ||
    !record.fallback ||
    typeof record.fallback !== 'object' ||
    Array.isArray(record.fallback)
  ) {
    throw protocolError();
  }
  const fallback = recordValue(record.fallback);
  if (
    fallback.searchTool !== 'file_search' ||
    fallback.readTool !== 'file_read' ||
    fallback.unsupportedLanguages !== true
  ) {
    throw protocolError();
  }
  const revision = stringValue(record.revision) as string;
  if (!/^[a-f0-9]{64}$/.test(revision)) throw protocolError();
  return {
    engine: 'typescript-native',
    path: stringValue(record.path) as string,
    query: record.query === null ? null : boundedStringValue(record.query, 1024),
    revision,
    indexedFiles: integerValue(record.indexedFiles),
    indexedBytes: integerValue(record.indexedBytes),
    cacheHits: integerValue(record.cacheHits),
    cacheMisses: integerValue(record.cacheMisses),
    files: record.files.map((item) => {
      const file = recordValue(item);
      const digest = stringValue(file.sha256) as string;
      if (!/^[a-f0-9]{64}$/.test(digest) || !Array.isArray(file.symbols) || file.symbols.length > 160) {
        throw protocolError();
      }
      return {
        path: stringValue(file.path) as string,
        sha256: digest,
        sizeBytes: integerValue(file.sizeBytes),
        imports: stringArrayValue(file.imports, 32),
        symbols: file.symbols.map((entry) => {
          const symbol = recordValue(entry);
          return {
            name: boundedStringValue(symbol.name, 160),
            kind: boundedStringValue(symbol.kind, 128),
            line: integerValue(symbol.line, 1),
            column: integerValue(symbol.column, 1),
            signature: boundedStringValue(symbol.signature, 320),
          };
        }),
      };
    }),
    truncated: booleanValue(record.truncated),
    fallback: {
      searchTool: 'file_search',
      readTool: 'file_read',
      unsupportedLanguages: true,
    },
  };
};

export const decodeWorkspaceCodeIntel = (value: unknown): WorkspaceCodeIntelResult => {
  const record = recordValue(value);
  if (
    !['symbols', 'definition', 'references', 'diagnostics'].includes(String(record.action)) ||
    (record.engine !== 'typescript-native' && record.engine !== 'fallback') ||
    !Array.isArray(record.results) ||
    record.results.length > 100
  ) {
    throw protocolError();
  }
  const revision =
    record.revision === null
      ? null
      : (() => {
          const candidate = stringValue(record.revision) as string;
          if (!/^[a-f0-9]{64}$/.test(candidate)) throw protocolError();
          return candidate;
        })();
  const digest =
    record.sha256 === null
      ? null
      : (() => {
          const candidate = stringValue(record.sha256) as string;
          if (!/^[a-f0-9]{64}$/.test(candidate)) throw protocolError();
          return candidate;
        })();
  const fallback =
    record.fallback === null
      ? null
      : (() => {
          const item = recordValue(record.fallback);
          if (
            (item.reason !== 'LANGUAGE_UNSUPPORTED' && item.reason !== 'FILE_NOT_INDEXED') ||
            item.searchTool !== 'file_search' ||
            item.readTool !== 'file_read'
          ) {
            throw protocolError();
          }
          return {
            reason: item.reason as 'LANGUAGE_UNSUPPORTED' | 'FILE_NOT_INDEXED',
            searchTool: 'file_search' as const,
            readTool: 'file_read' as const,
          };
        })();

  return {
    action: record.action as WorkspaceCodeIntelResult['action'],
    path: stringValue(record.path) as string,
    engine: record.engine,
    supported: booleanValue(record.supported),
    revision,
    sha256: digest,
    results: record.results.map((entry) => {
      const item = recordValue(entry);
      if ('code' in item) {
        return {
          path: stringValue(item.path) as string,
          line: integerValue(item.line, 1),
          column: integerValue(item.column, 1),
          endLine: integerValue(item.endLine, 1),
          endColumn: integerValue(item.endColumn, 1),
          code: integerValue(item.code),
          category: boundedStringValue(item.category, 128),
          text: boundedStringValue(item.text, 1024),
        };
      }
      if ('path' in item) {
        return {
          path: stringValue(item.path) as string,
          line: integerValue(item.line, 1),
          column: integerValue(item.column, 1),
          endLine: integerValue(item.endLine, 1),
          endColumn: integerValue(item.endColumn, 1),
          ...(item.name === undefined ? {} : { name: boundedStringValue(item.name, 160) }),
          ...(item.kind === undefined ? {} : { kind: boundedStringValue(item.kind, 128) }),
          ...(item.signature === undefined ? {} : { signature: boundedStringValue(item.signature, 320) }),
        };
      }
      return {
        name: boundedStringValue(item.name, 160),
        kind: boundedStringValue(item.kind, 128),
        line: integerValue(item.line, 1),
        column: integerValue(item.column, 1),
        signature: boundedStringValue(item.signature, 320),
      };
    }),
    truncated: booleanValue(record.truncated),
    fallback,
  };
};

export const decodeWorkspaceApplyPatch = (value: unknown): WorkspaceApplyPatchResult => {
  const record = recordValue(value);
  if (!Array.isArray(record.changes) || record.changes.length > 16) throw protocolError();
  return {
    changes: record.changes.map((item) => {
      const change = recordValue(item);
      const beforeSha256 = stringValue(change.beforeSha256) as string;
      const afterSha256 = stringValue(change.afterSha256) as string;
      if (!/^[a-f0-9]{64}$/.test(beforeSha256) || !/^[a-f0-9]{64}$/.test(afterSha256)) throw protocolError();
      return {
        path: stringValue(change.path) as string,
        beforeSha256,
        afterSha256,
        beforeBytes: integerValue(change.beforeBytes),
        afterBytes: integerValue(change.afterBytes),
        additions: integerValue(change.additions),
        deletions: integerValue(change.deletions),
      };
    }),
    applied: booleanValue(record.applied),
  };
};

export const decodeErrorCode = (value: unknown): string | null => {
  const record = recordValue(value);
  return typeof record.error === 'string' && /^[A-Z][A-Z0-9_]+$/.test(record.error) ? record.error : null;
};

export const commandResult = (value: RunnerCommandWireResponse): RunnerCommandResult => ({
  commandId: value.commandId,
  status: value.status,
  result:
    value.result !== undefined && value.result !== null
      ? jsonValue(value.result)
      : typeof value.error === 'string' && value.error
        ? { errorCode: value.error.slice(0, 1024) }
        : null,
});
