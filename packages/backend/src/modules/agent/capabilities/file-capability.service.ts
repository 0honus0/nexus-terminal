import { createHash } from 'node:crypto';
import { applyPatch, parsePatch, type StructuredPatch } from 'diff';
import type { MachineCapabilityPort, FilePathInspection } from './machine.port';
import type { ResolvedAgentTarget, AgentTargetResolver } from './target-resolver';
import type { AgentTargetKind, ToolTargetFingerprint } from './tool-target.types';
import type { ToolContext } from './tool.types';
import type { WorkspaceRuntimeService } from '../workspace-runtime/workspace-runtime.service';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 64 * 1024;
const MAX_PATCH_FILES = 16;
const MAX_PATCH_BYTES = 30 * 1024;

export interface FileTargetSelectorInput {
  target: AgentTargetKind;
  id: string;
}

export interface UnifiedFileStat {
  path: string;
  exists: boolean;
  type: 'file' | 'directory' | null;
  sizeBytes: number | null;
  modifiedAt: number | null;
  mode: number | null;
  sha256: string | null;
}

export interface UnifiedFileReadResult {
  path: string;
  sha256: string;
  sizeBytes: number;
  content: string;
  offsetBytes: number;
  contentBytes: number;
  truncated: boolean;
}

export interface UnifiedFileListResult {
  path: string;
  entries: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    sizeBytes: number;
    modifiedAt: number;
  }>;
  truncated: boolean;
}

export interface UnifiedFileSearchResult {
  query: string;
  path: string;
  engine: 'rg' | 'fallback' | 'sftp';
  matches: Array<{
    path: string;
    line: number;
    column: number;
    text: string;
    before: string[];
    after: string[];
  }>;
  truncated: boolean;
  scannedFiles: number;
  scannedBytes: number;
}

export interface PreparedPatchChange {
  path: string;
  beforeSha256: string;
  afterSha256: string;
  beforeBytes: number;
  afterBytes: number;
  additions: number;
  deletions: number;
  content: string;
}

const sha256 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

const patchPath = (value: string | undefined): string => {
  if (!value || value === '/dev/null') throw new Error('FILE_PATCH_UNSUPPORTED');
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value;
};

const sourceLinesAtDeclaredLocation = (source: string, patchSpec: StructuredPatch): boolean => {
  const sourceLines = source.split('\n');
  for (const hunk of patchSpec.hunks) {
    const expected = hunk.lines
      .filter((line) => line.startsWith(' ') || line.startsWith('-'))
      .map((line) => line.slice(1));
    const actual = sourceLines.slice(Math.max(0, hunk.oldStart - 1), Math.max(0, hunk.oldStart - 1) + expected.length);
    if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) return false;
  }
  return true;
};

export class FileCapabilityService {
  constructor(
    private readonly targets: AgentTargetResolver,
    private readonly workspaces: WorkspaceRuntimeService,
    private readonly machine: MachineCapabilityPort,
  ) {}

  resolve(context: ToolContext, selector: FileTargetSelectorInput): Promise<ResolvedAgentTarget> {
    return this.targets.resolve(context, selector);
  }

  bindInspectionTarget(fingerprint: ToolTargetFingerprint): ResolvedAgentTarget {
    if (fingerprint.kind === 'workspace') {
      if (
        fingerprint.target !== 'workspace' ||
        fingerprint.workspaceId !== fingerprint.id ||
        fingerprint.generation === undefined
      ) {
        throw new Error('TOOL_STATE_CONFLICT');
      }
      return {
        selector: { target: 'workspace', id: fingerprint.id },
        fingerprint,
        resourceKeys: [`workspace:${fingerprint.id}:${fingerprint.generation}`],
        preconditions: [],
        workspaceGeneration: fingerprint.generation,
      };
    }
    if (fingerprint.kind === 'ssh') {
      if (
        fingerprint.target !== 'ssh' ||
        fingerprint.connectionId === undefined ||
        String(fingerprint.connectionId) !== fingerprint.id
      ) {
        throw new Error('TOOL_STATE_CONFLICT');
      }
      return {
        selector: { target: 'ssh', id: fingerprint.id },
        fingerprint,
        resourceKeys: [`connection:${fingerprint.connectionId}`],
        preconditions: [],
        connectionId: fingerprint.connectionId,
      };
    }
    throw new Error('TOOL_STATE_CONFLICT');
  }

  resourceKey(target: ResolvedAgentTarget, path: string): string {
    return target.selector.target === 'workspace'
      ? `workspace:${target.selector.id}:${target.workspaceGeneration}:file:${path}`
      : `connection:${target.connectionId}:file:${path}`;
  }

  async stat(context: ToolContext, target: ResolvedAgentTarget, path: string): Promise<UnifiedFileStat> {
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      return this.workspaces.statWorkspacePath(context, target.selector.id, generation, path, context.signal);
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    const state = await this.machine.inspectPath(context, connectionId, path, target.fingerprint.configurationHash);
    return this.remoteStat(state);
  }

  async read(
    context: ToolContext,
    target: ResolvedAgentTarget,
    path: string,
    offsetBytes: number,
    maxBytes: number,
  ): Promise<UnifiedFileReadResult> {
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      const result = await this.workspaces.readWorkspaceFile(
        context,
        target.selector.id,
        generation,
        { path, offsetBytes, maxBytes },
        context.signal,
      );
      return {
        path: result.path,
        sha256: result.sha256,
        sizeBytes: result.sizeBytes,
        content: result.content,
        offsetBytes: result.offsetBytes ?? 0,
        contentBytes: result.contentBytes,
        truncated: result.truncated,
      };
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    const [state, result] = await Promise.all([
      this.machine.inspectPath(context, connectionId, path, target.fingerprint.configurationHash),
      this.machine.readFile(context, connectionId, path, maxBytes, offsetBytes, target.fingerprint.configurationHash),
    ]);
    if (!state.exists || state.type !== 'file' || !state.sha256) throw new Error('RESOURCE_FORBIDDEN');
    return {
      path: result.resolvedPath,
      sha256: state.sha256,
      sizeBytes: result.sizeBytes,
      content: result.content,
      offsetBytes: result.offset,
      contentBytes: result.bytesRead,
      truncated: result.truncated,
    };
  }

  async list(
    context: ToolContext,
    target: ResolvedAgentTarget,
    path: string,
    maxEntries: number,
  ): Promise<UnifiedFileListResult> {
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      return this.workspaces.listWorkspaceFiles(
        context,
        target.selector.id,
        generation,
        { path, maxEntries },
        context.signal,
      );
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    return this.machine.listFiles(context, connectionId, path, maxEntries, target.fingerprint.configurationHash);
  }

  async search(
    context: ToolContext,
    target: ResolvedAgentTarget,
    request: {
      query: string;
      path: string;
      glob?: string;
      maxResults: number;
      contextLines: number;
      maxOutputBytes: number;
    },
  ): Promise<UnifiedFileSearchResult> {
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      return this.workspaces.searchWorkspace(context, target.selector.id, generation, request, context.signal);
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    return this.machine.searchFiles(context, connectionId, request, target.fingerprint.configurationHash);
  }

  async write(
    context: ToolContext,
    target: ResolvedAgentTarget,
    path: string,
    content: string,
    expectedSha256: string | null,
  ): Promise<{ path: string; sha256: string; sizeBytes: number; created: boolean }> {
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('TOOL_INPUT_TOO_LARGE');
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      const result = await this.workspaces.writeWorkspaceFile(
        context,
        target.selector.id,
        generation,
        { path, content, expectedSha256 },
        context.signal,
      );
      return { path: result.path, sha256: result.sha256, sizeBytes: result.sizeBytes, created: result.created };
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    const result = await this.machine.writeFile(
      context,
      connectionId,
      path,
      Buffer.from(content, 'utf8'),
      expectedSha256,
      target.fingerprint.configurationHash,
    );
    if (!result.sha256 || result.sizeBytes === null) throw new Error('VERIFICATION_FAILED');
    return { path: result.resolvedPath, sha256: result.sha256, sizeBytes: result.sizeBytes, created: !expectedSha256 };
  }

  async move(
    context: ToolContext,
    target: ResolvedAgentTarget,
    path: string,
    destinationPath: string,
    expectedSha256: string | null,
  ): Promise<{ path: string; destinationPath: string; type: 'file' | 'directory'; sha256: string | null }> {
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      return this.workspaces.moveWorkspaceFile(
        context,
        target.selector.id,
        generation,
        { path, destinationPath, expectedSha256 },
        context.signal,
      );
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    return this.machine.movePath(
      context,
      connectionId,
      path,
      destinationPath,
      expectedSha256,
      target.fingerprint.configurationHash,
    );
  }

  async delete(
    context: ToolContext,
    target: ResolvedAgentTarget,
    path: string,
    recursive: boolean,
    expectedSha256: string | null,
  ): Promise<{ path: string; type: 'file' | 'directory'; deleted: true }> {
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      return this.workspaces.deleteWorkspaceFile(
        context,
        target.selector.id,
        generation,
        { path, recursive, expectedSha256 },
        context.signal,
      );
    }
    const connectionId = target.connectionId;
    if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
    return this.machine.deletePath(
      context,
      connectionId,
      path,
      recursive,
      expectedSha256,
      target.fingerprint.configurationHash,
    );
  }

  async preparePatch(
    context: ToolContext,
    target: ResolvedAgentTarget,
    patch: string,
    expectedFiles?: ReadonlyMap<string, string>,
  ): Promise<PreparedPatchChange[]> {
    if (!patch || Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) throw new Error('TOOL_ARGUMENTS_INVALID');
    let patches: StructuredPatch[];
    try {
      patches = parsePatch(patch);
    } catch {
      throw new Error('FILE_PATCH_INVALID');
    }
    if (!patches.length || patches.length > MAX_PATCH_FILES) throw new Error('FILE_PATCH_INVALID');
    const changes: PreparedPatchChange[] = [];
    const seen = new Set<string>();
    for (const patchSpec of patches) {
      if (
        patchSpec.isBinary ||
        patchSpec.isCreate ||
        patchSpec.isDelete ||
        patchSpec.isRename ||
        patchSpec.isCopy ||
        patchSpec.hunks.length < 1
      ) {
        throw new Error('FILE_PATCH_UNSUPPORTED');
      }
      const oldPath = patchPath(patchSpec.oldFileName);
      const newPath = patchPath(patchSpec.newFileName);
      const oldState = await this.stat(context, target, oldPath);
      const newState = await this.stat(context, target, newPath);
      if (
        !oldState.exists ||
        oldState.type !== 'file' ||
        !oldState.sha256 ||
        oldState.path !== newState.path ||
        seen.has(oldState.path)
      ) {
        throw new Error('FILE_PATCH_UNSUPPORTED');
      }
      seen.add(oldState.path);
      if (expectedFiles && expectedFiles.get(oldState.path) !== oldState.sha256) throw new Error('RESOURCE_CHANGED');
      const source = await this.readWholeText(context, target, oldState);
      if (!sourceLinesAtDeclaredLocation(source, patchSpec)) throw new Error('FILE_PATCH_CONTEXT_MISMATCH');
      const patched = applyPatch(source, patchSpec, { fuzzFactor: 0, autoConvertLineEndings: false });
      if (patched === false) throw new Error('FILE_PATCH_CONTEXT_MISMATCH');
      const after = Buffer.from(patched, 'utf8');
      if (after.byteLength > MAX_FILE_BYTES) throw new Error('RESOURCE_TOO_LARGE');
      let additions = 0;
      let deletions = 0;
      for (const hunk of patchSpec.hunks) {
        for (const line of hunk.lines) {
          if (line.startsWith('+')) additions += 1;
          else if (line.startsWith('-')) deletions += 1;
        }
      }
      changes.push({
        path: oldState.path,
        beforeSha256: oldState.sha256,
        afterSha256: sha256(after),
        beforeBytes: Buffer.byteLength(source, 'utf8'),
        afterBytes: after.byteLength,
        additions,
        deletions,
        content: patched,
      });
    }
    if (
      expectedFiles &&
      (expectedFiles.size !== changes.length || changes.some((change) => !expectedFiles.has(change.path)))
    ) {
      throw new Error('RESOURCE_CHANGED');
    }
    return changes;
  }

  async applyPreparedPatch(
    context: ToolContext,
    target: ResolvedAgentTarget,
    patch: string,
    expectedFiles: ReadonlyMap<string, string>,
  ): Promise<Omit<PreparedPatchChange, 'content'>[]> {
    const prepared = await this.preparePatch(context, target, patch, expectedFiles);
    if (target.selector.target === 'workspace') {
      const generation = target.workspaceGeneration;
      if (generation === undefined) throw new Error('TOOL_STATE_CONFLICT');
      const result = await this.workspaces.applyWorkspacePatch(
        context,
        target.selector.id,
        generation,
        {
          patch,
          expectedFiles: prepared.map((change) => ({ path: change.path, sha256: change.beforeSha256 })),
        },
        context.signal,
      );
      if (!result.applied || result.changes.length !== prepared.length) throw new Error('VERIFICATION_FAILED');
      for (const change of prepared) {
        const confirmed = result.changes.find((candidate) => candidate.path === change.path);
        if (
          !confirmed ||
          confirmed.afterSha256 !== change.afterSha256 ||
          confirmed.beforeSha256 !== change.beforeSha256
        ) {
          throw new Error('VERIFICATION_FAILED');
        }
      }
    } else {
      const connectionId = target.connectionId;
      if (connectionId === undefined) throw new Error('TOOL_STATE_CONFLICT');
      const results = await this.machine.replaceFiles(
        context,
        connectionId,
        prepared.map((change) => ({
          path: change.path,
          content: Buffer.from(change.content, 'utf8'),
          expectedSha256: change.beforeSha256,
        })),
        target.fingerprint.configurationHash,
      );
      if (results.length !== prepared.length) throw new Error('VERIFICATION_FAILED');
      for (const change of prepared) {
        const confirmed = results.find((candidate) => candidate.path === change.path);
        if (!confirmed || confirmed.sha256 !== change.afterSha256) throw new Error('VERIFICATION_FAILED');
      }
    }
    return prepared.map(({ content: _content, ...change }) => change);
  }

  private remoteStat(state: FilePathInspection): UnifiedFileStat {
    return {
      path: state.resolvedPath,
      exists: state.exists,
      type: state.type,
      sizeBytes: state.sizeBytes,
      modifiedAt: state.modifiedAt,
      mode: state.mode,
      sha256: state.sha256,
    };
  }

  private async readWholeText(
    context: ToolContext,
    target: ResolvedAgentTarget,
    state: UnifiedFileStat,
  ): Promise<string> {
    if (!state.exists || state.type !== 'file' || state.sizeBytes === null || state.sizeBytes > MAX_FILE_BYTES) {
      throw new Error('RESOURCE_TOO_LARGE');
    }
    let offset = 0;
    let content = '';
    while (offset < state.sizeBytes) {
      const result = await this.read(
        context,
        target,
        state.path,
        offset,
        Math.min(MAX_READ_BYTES, state.sizeBytes - offset),
      );
      if (result.sha256 !== state.sha256) throw new Error('RESOURCE_CHANGED');
      if (result.contentBytes < 1 && result.truncated) throw new Error('VERIFICATION_FAILED');
      content += result.content;
      offset += result.contentBytes;
      if (!result.truncated) break;
    }
    if (Buffer.byteLength(content, 'utf8') !== state.sizeBytes) throw new Error('RESOURCE_CHANGED');
    return content;
  }
}
