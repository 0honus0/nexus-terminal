import { createHash } from 'node:crypto';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { AgentConnectionResolverPort } from '../../../modules/agent/capabilities/ssh-target-resolver.port';
import type { ToolContext } from '../../../modules/agent/capabilities/tool.types';
import type {
  SshFileDeleteResult,
  SshFileListResult,
  SshFileMoveResult,
  SshFileMutationInspection,
  SshFileMutationResult,
  SshFilePathInspection,
  SshFileReadResult,
  SshFileReplacement,
  SshFileReplacementResult,
  SshFileSearchResult,
  SshFileTargetPort,
} from '../../../modules/agent/capabilities/ssh-file-target.port';
import type { ExecutionSession } from '../../../platform/execution/execution-session';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import { isRemoteFileMissingError, type RemoteFileSystem } from '../../../platform/filesystem/remote-filesystem';

const MAX_FILE_READ_BYTES = 1024 * 1024;
const MAX_MUTATION_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_BYTES = 16 * 1024 * 1024;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_LINE_BYTES = 4 * 1024;
const MAX_RECURSIVE_DELETE_ENTRIES = 10_000;
const normalizeRemotePath = (value: string): string => {
  if (!value || value.length > 4096 || value.includes('\0')) throw new Error('VALIDATION_FAILED');
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (!path.posix.isAbsolute(normalized)) throw new Error('RESOURCE_FORBIDDEN');
  return normalized;
};

const hardDeniedPath = (value: string): boolean => {
  const normalized = value.toLowerCase();
  if (normalized === '/') return true;
  const exact = new Set([
    '/etc/shadow',
    '/etc/gshadow',
    '/etc/sudoers',
    '/etc/security/opasswd',
    '/proc/kcore',
    '/proc/keys',
  ]);
  if (exact.has(normalized)) return true;
  const prefixes = ['/dev/', '/proc/sysrq-trigger', '/sys/kernel/security/', '/etc/ssl/private/', '/var/lib/secret/'];
  if (prefixes.some((prefix) => normalized.startsWith(prefix))) return true;
  const segments = normalized.split('/').filter(Boolean);
  return (
    segments.includes('.ssh') || segments.includes('.gnupg') || segments.includes('.aws') || segments.includes('.kube')
  );
};

const assertDeadline = (context: ToolContext): void => {
  if (context.signal.aborted) throw new DOMException('Agent machine operation aborted.', 'AbortError');
  if (Math.floor(Date.now() / 1000) >= context.deadlineAt) throw new Error('TOOL_TIMEOUT');
};

const assertConnectionSelected = (context: ToolContext, connectionId: number): void => {
  if (!context.connectionIds.includes(connectionId)) throw new Error('TARGET_NOT_SELECTED');
};

const readLength = (requested: number, context: ToolContext): number => {
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('VALIDATION_FAILED');
  return Math.min(requested, context.maxOutputBytes, MAX_FILE_READ_BYTES);
};

const utf8Prefix = (value: string, maxBytes: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
};

const compileSearchRegex = (query: string): RegExp => {
  if (!query || query.length > 1024) throw new Error('VALIDATION_FAILED');
  try {
    return new RegExp(query, 'u');
  } catch {
    throw new Error('VALIDATION_FAILED');
  }
};

const decodeUtf8Prefix = (bytes: Uint8Array): { content: string; bytesRead: number } => {
  for (let trim = 0; trim <= Math.min(3, bytes.byteLength); trim += 1) {
    const candidate = bytes.subarray(0, bytes.byteLength - trim);
    try {
      return { content: new TextDecoder('utf-8', { fatal: true }).decode(candidate), bytesRead: candidate.byteLength };
    } catch {
      // A bounded read may split one UTF-8 code point; trim at most the incomplete suffix.
    }
  }
  throw new Error('REMOTE_FILE_NOT_TEXT');
};

const globRegex = (glob: string | undefined): RegExp | null => {
  if (glob === undefined) return null;
  if (!glob || glob.length > 512 || glob.includes('\\0')) throw new Error('VALIDATION_FAILED');
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === '*') {
      if (glob[index + 1] === '*') {
        source += '.*';
        index += 1;
      } else source += '[^/]*';
    } else if (char === '?') source += '[^/]';
    else source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  source += '$';
  return new RegExp(source, 'u');
};

export class SshFileTargetAdapter implements SshFileTargetPort {
  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly sessions: ExecutionSessionManager,
  ) {}

  async stat(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    expectedConfigurationHash: string,
  ): Promise<SshFilePathInspection> {
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        return this.inspectPathWithFilesystem(context, filesystem, remotePath);
      },
      expectedConfigurationHash,
    );
  }

  async list(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    maxEntries: number,
    expectedConfigurationHash: string,
  ): Promise<SshFileListResult> {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 500) throw new Error('VALIDATION_FAILED');
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        const directory = await this.inspectPathWithFilesystem(context, filesystem, remotePath);
        if (!directory.exists || directory.type !== 'directory') throw new Error('RESOURCE_FORBIDDEN');
        const raw = (await filesystem.readDirectory(directory.resolvedPath)).sort((left, right) =>
          left.name.localeCompare(right.name),
        );
        const entries: SshFileListResult['entries'] = [];
        for (const entry of raw) {
          if (entries.length >= maxEntries) break;
          if (entry.metadata.isSymbolicLink || (!entry.metadata.isFile && !entry.metadata.isDirectory)) continue;
          const childPath = normalizeRemotePath(path.posix.join(directory.resolvedPath, entry.name));
          if (hardDeniedPath(childPath)) continue;
          entries.push({
            name: entry.name,
            path: childPath,
            type: entry.metadata.isDirectory ? 'directory' : 'file',
            sizeBytes: entry.metadata.size,
            modifiedAt: entry.metadata.modifiedAt,
          });
        }
        return { path: directory.resolvedPath, entries, truncated: raw.length > entries.length };
      },
      expectedConfigurationHash,
    );
  }

  async search(
    context: ToolContext,
    connectionId: number,
    request: {
      query: string;
      path: string;
      glob?: string;
      maxResults: number;
      contextLines: number;
      maxOutputBytes: number;
    },
    expectedConfigurationHash: string,
  ): Promise<SshFileSearchResult> {
    if (
      !Number.isSafeInteger(request.maxResults) ||
      request.maxResults < 1 ||
      request.maxResults > 100 ||
      !Number.isSafeInteger(request.contextLines) ||
      request.contextLines < 0 ||
      request.contextLines > 5 ||
      !Number.isSafeInteger(request.maxOutputBytes) ||
      request.maxOutputBytes < 1024 ||
      request.maxOutputBytes > 256 * 1024
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    const expression = compileSearchRegex(request.query);
    const glob = globRegex(request.glob);
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        const root = await this.inspectPathWithFilesystem(context, filesystem, request.path);
        if (!root.exists) throw new Error('NOT_FOUND');
        const queue: string[] = [root.resolvedPath];
        const matches: SshFileSearchResult['matches'] = [];
        let scannedFiles = 0;
        let scannedBytes = 0;
        let visitedEntries = 0;
        let outputBytes = 2;
        let truncated = false;
        while (queue.length > 0 && !truncated) {
          const currentPath = queue.shift()!;
          const current = await this.inspectPathWithFilesystem(context, filesystem, currentPath);
          if (!current.exists) continue;
          if (current.type === 'directory') {
            const entries = await filesystem.readDirectory(current.resolvedPath);
            for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
              visitedEntries += 1;
              if (visitedEntries > MAX_RECURSIVE_DELETE_ENTRIES) {
                truncated = true;
                break;
              }
              if (entry.metadata.isSymbolicLink || (!entry.metadata.isFile && !entry.metadata.isDirectory)) continue;
              const child = normalizeRemotePath(path.posix.join(current.resolvedPath, entry.name));
              if (hardDeniedPath(child)) continue;
              queue.push(child);
            }
            continue;
          }
          if (scannedFiles >= MAX_SEARCH_FILES || scannedBytes >= MAX_SEARCH_BYTES) {
            truncated = true;
            break;
          }
          const relative =
            root.type === 'directory'
              ? path.posix.relative(root.resolvedPath, current.resolvedPath)
              : path.posix.basename(current.resolvedPath);
          if (glob && !glob.test(relative)) continue;
          if (
            (current.sizeBytes ?? 0) > MAX_SEARCH_FILE_BYTES ||
            scannedBytes + (current.sizeBytes ?? 0) > MAX_SEARCH_BYTES
          ) {
            truncated = true;
            continue;
          }
          const stream = await filesystem.openRead(current.resolvedPath);
          const chunks: Buffer[] = [];
          let bytesRead = 0;
          for await (const chunk of stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytesRead += bytes.byteLength;
            if (bytesRead > MAX_SEARCH_FILE_BYTES) {
              truncated = true;
              break;
            }
            chunks.push(bytes);
            assertDeadline(context);
          }
          if (bytesRead > MAX_SEARCH_FILE_BYTES) continue;
          scannedFiles += 1;
          scannedBytes += bytesRead;
          let text: string;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          } catch {
            continue;
          }
          const lines = text.split('\n');
          for (let index = 0; index < lines.length; index += 1) {
            const found = expression.exec(lines[index]!);
            if (!found) continue;
            const candidate = {
              path: current.resolvedPath,
              line: index + 1,
              column: found.index + 1,
              text: utf8Prefix(lines[index]!, MAX_SEARCH_LINE_BYTES),
              before: lines
                .slice(Math.max(0, index - request.contextLines), index)
                .map((line) => utf8Prefix(line, MAX_SEARCH_LINE_BYTES)),
              after: lines
                .slice(index + 1, index + 1 + request.contextLines)
                .map((line) => utf8Prefix(line, MAX_SEARCH_LINE_BYTES)),
            };
            const candidateBytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8') + (matches.length > 0 ? 1 : 0);
            if (matches.length >= request.maxResults || outputBytes + candidateBytes > request.maxOutputBytes) {
              truncated = true;
              break;
            }
            matches.push(candidate);
            outputBytes += candidateBytes;
          }
        }
        return {
          query: request.query,
          path: root.resolvedPath,
          engine: 'sftp',
          matches,
          truncated,
          scannedFiles,
          scannedBytes,
        };
      },
      expectedConfigurationHash,
    );
  }

  async move(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    destinationPath: string,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<SshFileMoveResult> {
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('VALIDATION_FAILED');
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        const source = await this.inspectPathWithFilesystem(context, filesystem, remotePath);
        if (!source.exists || source.type === null) throw new Error('NOT_FOUND');
        if (source.type === 'file' ? source.sha256 !== expectedSha256 : expectedSha256 !== null) {
          throw new Error('RESOURCE_CHANGED');
        }
        const destination = await this.inspectPathWithFilesystem(context, filesystem, destinationPath);
        if (destination.exists) throw new Error('RESOURCE_CHANGED');
        await filesystem.rename(source.resolvedPath, destination.resolvedPath);
        const [sourceAfter, destinationAfter] = await Promise.all([
          this.inspectPathWithFilesystem(context, filesystem, source.resolvedPath),
          this.inspectPathWithFilesystem(context, filesystem, destination.resolvedPath),
        ]);
        if (
          sourceAfter.exists ||
          !destinationAfter.exists ||
          destinationAfter.type !== source.type ||
          destinationAfter.sha256 !== source.sha256
        ) {
          throw new Error('VERIFICATION_FAILED');
        }
        return {
          path: source.resolvedPath,
          destinationPath: destination.resolvedPath,
          type: source.type,
          sha256: source.sha256,
        };
      },
      expectedConfigurationHash,
    );
  }

  async delete(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    recursive: boolean,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<SshFileDeleteResult> {
    if (typeof recursive !== 'boolean' || (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256))) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        const before = await this.inspectPathWithFilesystem(context, filesystem, remotePath);
        if (!before.exists || before.type === null) throw new Error('NOT_FOUND');
        if (before.type === 'file' ? before.sha256 !== expectedSha256 : expectedSha256 !== null) {
          throw new Error('RESOURCE_CHANGED');
        }
        if (before.type === 'file') await filesystem.removeFile(before.resolvedPath);
        else if (recursive) await this.removeDirectoryTree(context, filesystem, before.resolvedPath);
        else {
          if ((await filesystem.readDirectory(before.resolvedPath)).length > 0) throw new Error('DIRECTORY_NOT_EMPTY');
          await filesystem.removeDirectory(before.resolvedPath);
        }
        if ((await this.inspectPathWithFilesystem(context, filesystem, before.resolvedPath)).exists) {
          throw new Error('VERIFICATION_FAILED');
        }
        return { path: before.resolvedPath, type: before.type, deleted: true };
      },
      expectedConfigurationHash,
    );
  }

  async replace(
    context: ToolContext,
    connectionId: number,
    replacements: readonly SshFileReplacement[],
    expectedConfigurationHash: string,
  ): Promise<SshFileReplacementResult[]> {
    if (
      !Array.isArray(replacements) ||
      replacements.length < 1 ||
      replacements.length > 16 ||
      new Set(replacements.map((replacement) => replacement.path)).size !== replacements.length ||
      replacements.some(
        (replacement) =>
          !(replacement.content instanceof Uint8Array) ||
          replacement.content.byteLength > MAX_MUTATION_FILE_BYTES ||
          !/^[a-f0-9]{64}$/.test(replacement.expectedSha256),
      )
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        const prepared: Array<{
          before: SshFileMutationInspection;
          content: Buffer;
          temporary: string;
          expectedAfter: string;
        }> = [];
        try {
          for (const replacement of replacements) {
            const before = await this.inspectFileWithFilesystem(context, filesystem, replacement.path);
            if (!before.exists || before.sha256 !== replacement.expectedSha256) throw new Error('RESOURCE_CHANGED');
            const content = Buffer.from(replacement.content);
            const expectedAfter = createHash('sha256').update(content).digest('hex');
            const temporary = path.posix.join(
              path.posix.dirname(before.resolvedPath),
              `.nexus-agent-patch-${createHash('sha256').update(`${Date.now()}-${Math.random()}-${before.resolvedPath}`).digest('hex')}.tmp`,
            );
            const stream = await filesystem.openWrite(temporary, {
              flags: 'wx',
              ...(before.mode === null ? {} : { mode: before.mode }),
            });
            stream.end(content);
            await finished(stream);
            prepared.push({ before, content, temporary, expectedAfter });
          }
          for (const item of prepared) {
            const current = await this.inspectFileWithFilesystem(context, filesystem, item.before.resolvedPath);
            if (!current.exists || current.sha256 !== item.before.sha256) throw new Error('RESOURCE_CHANGED');
          }
          for (const item of prepared) await filesystem.replaceFile(item.temporary, item.before.resolvedPath);
          const results: SshFileReplacementResult[] = [];
          for (const item of prepared) {
            const after = await this.inspectFileWithFilesystem(context, filesystem, item.before.resolvedPath);
            if (!after.exists || after.sha256 !== item.expectedAfter) throw new Error('VERIFICATION_FAILED');
            results.push({ path: after.resolvedPath, sha256: after.sha256, sizeBytes: item.content.byteLength });
          }
          return results;
        } finally {
          for (const item of prepared)
            await filesystem.removeFile(item.temporary, { ignoreMissing: true }).catch(() => undefined);
        }
      },
      expectedConfigurationHash,
    );
  }

  async write(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    content: Uint8Array,
    expectedSha256: string | null,
    expectedConfigurationHash: string,
  ): Promise<SshFileMutationResult> {
    assertDeadline(context);
    if (!(content instanceof Uint8Array) || content.byteLength > MAX_MUTATION_FILE_BYTES)
      throw new Error('TOOL_INPUT_TOO_LARGE');
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('VALIDATION_FAILED');
    return this.withSession(
      context,
      connectionId,
      async (session) => {
        const filesystem = await session.fileSystem('control');
        const before = await this.inspectFileWithFilesystem(context, filesystem, remotePath);
        if ((before.exists ? before.sha256 : null) !== expectedSha256) throw new Error('RESOURCE_CHANGED');
        const directory = path.posix.dirname(before.resolvedPath);
        const temporary = path.posix.join(
          directory,
          `.nexus-agent-${createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex')}.tmp`,
        );
        if (hardDeniedPath(temporary)) throw new Error('RESOURCE_FORBIDDEN');
        const bytes = Buffer.from(content);
        let temporaryCreated = false;
        try {
          const stream = await filesystem.openWrite(temporary, {
            flags: 'wx',
            ...(before.mode !== null ? { mode: before.mode } : {}),
          });
          temporaryCreated = true;
          stream.end(bytes);
          await finished(stream);
          assertDeadline(context);
          const current = await this.inspectFileWithFilesystem(context, filesystem, remotePath);
          if ((current.exists ? current.sha256 : null) !== expectedSha256) throw new Error('RESOURCE_CHANGED');
          await filesystem.replaceFile(temporary, before.resolvedPath);
          temporaryCreated = false;
          const after = await this.inspectFileWithFilesystem(context, filesystem, before.resolvedPath);
          const expectedNewHash = createHash('sha256').update(bytes).digest('hex');
          if (!after.exists || after.sha256 !== expectedNewHash) throw new Error('VERIFICATION_FAILED');
          return { ...after, bytesWritten: bytes.byteLength };
        } finally {
          if (temporaryCreated) await filesystem.removeFile(temporary, { ignoreMissing: true }).catch(() => undefined);
        }
      },
      expectedConfigurationHash,
    );
  }

  async read(
    context: ToolContext,
    connectionId: number,
    remotePath: string,
    maxBytes: number,
    offset = 0,
    expectedConfigurationHash?: string,
  ): Promise<SshFileReadResult> {
    assertDeadline(context);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('VALIDATION_FAILED');
    }
    assertConnectionSelected(context, connectionId);
    const requestedPath = normalizeRemotePath(remotePath);
    if (hardDeniedPath(requestedPath)) throw new Error('RESOURCE_FORBIDDEN');
    const limit = readLength(maxBytes, context);
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    if (expectedConfigurationHash !== undefined && connection.configurationHash !== expectedConfigurationHash) {
      throw new Error('RESOURCE_CHANGED');
    }
    const resolved = await this.connections.resolve(connectionId, expectedConfigurationHash);
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.agentRuntimeId,
      connection: resolved,
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      assertDeadline(context);
      const filesystem = await session.fileSystem('control');
      try {
        const requestedMetadata = await filesystem.metadata(requestedPath, { followSymbolicLinks: false });
        if (requestedMetadata.isSymbolicLink) throw new Error('RESOURCE_FORBIDDEN');
        if (!requestedMetadata.isFile) throw new Error('RESOURCE_FORBIDDEN');
        const resolvedPath = await filesystem.resolvePath(requestedPath);
        const normalizedResolved = normalizeRemotePath(resolvedPath);
        if (hardDeniedPath(normalizedResolved)) throw new Error('RESOURCE_FORBIDDEN');
        const metadata = await filesystem.metadata(normalizedResolved, { followSymbolicLinks: false });
        if (!metadata.isFile || metadata.isSymbolicLink) throw new Error('RESOURCE_FORBIDDEN');
        if (offset >= metadata.size) {
          return {
            path: requestedPath,
            resolvedPath: normalizedResolved,
            sizeBytes: metadata.size,
            modifiedAt: metadata.modifiedAt,
            offset,
            bytesRead: 0,
            truncated: false,
            content: '',
          };
        }
        const reader = await filesystem.openPositionedReader(normalizedResolved);
        try {
          assertDeadline(context);
          const available = Math.max(0, metadata.size - offset);
          const bytes = await reader.read(offset, Math.min(limit, available));
          assertDeadline(context);
          const decoded = decodeUtf8Prefix(bytes);
          if (decoded.bytesRead === 0 && bytes.byteLength > 0) throw new Error('REMOTE_FILE_RANGE_TOO_SMALL');
          return {
            path: requestedPath,
            resolvedPath: normalizedResolved,
            sizeBytes: metadata.size,
            modifiedAt: metadata.modifiedAt,
            offset,
            bytesRead: decoded.bytesRead,
            truncated: offset + decoded.bytesRead < metadata.size,
            content: decoded.content,
          };
        } finally {
          await reader.close().catch(() => undefined);
        }
      } catch (error) {
        if (isRemoteFileMissingError(error)) throw new Error('REMOTE_FILE_NOT_FOUND');
        throw error;
      }
    } finally {
      await this.sessions.close(session.id).catch(() => undefined);
    }
  }

  private async inspectPathWithFilesystem(
    context: ToolContext,
    filesystem: RemoteFileSystem,
    remotePath: string,
  ): Promise<SshFilePathInspection> {
    assertDeadline(context);
    const requestedPath = normalizeRemotePath(remotePath);
    if (hardDeniedPath(requestedPath)) throw new Error('RESOURCE_FORBIDDEN');
    let metadata;
    try {
      metadata = await filesystem.metadata(requestedPath, { followSymbolicLinks: false });
    } catch (error) {
      if (!isRemoteFileMissingError(error)) throw error;
      const parent = normalizeRemotePath(await filesystem.resolvePath(path.posix.dirname(requestedPath)));
      const resolvedPath = normalizeRemotePath(path.posix.join(parent, path.posix.basename(requestedPath)));
      if (hardDeniedPath(resolvedPath)) throw new Error('RESOURCE_FORBIDDEN');
      return {
        path: requestedPath,
        resolvedPath,
        exists: false,
        type: null,
        sizeBytes: null,
        modifiedAt: null,
        mode: null,
        sha256: null,
      };
    }
    if (metadata.isSymbolicLink || (!metadata.isFile && !metadata.isDirectory)) throw new Error('RESOURCE_FORBIDDEN');
    const resolvedPath = normalizeRemotePath(await filesystem.resolvePath(requestedPath));
    if (hardDeniedPath(resolvedPath)) throw new Error('RESOURCE_FORBIDDEN');
    const resolvedMetadata = await filesystem.metadata(resolvedPath, { followSymbolicLinks: false });
    if (resolvedMetadata.isSymbolicLink || (!resolvedMetadata.isFile && !resolvedMetadata.isDirectory)) {
      throw new Error('RESOURCE_FORBIDDEN');
    }
    if (resolvedMetadata.isDirectory) {
      return {
        path: requestedPath,
        resolvedPath,
        exists: true,
        type: 'directory',
        sizeBytes: resolvedMetadata.size,
        modifiedAt: resolvedMetadata.modifiedAt,
        mode: resolvedMetadata.mode,
        sha256: null,
      };
    }
    if (resolvedMetadata.size > MAX_MUTATION_FILE_BYTES) throw new Error('RESOURCE_TOO_LARGE');
    const reader = await filesystem.openPositionedReader(resolvedPath);
    const hash = createHash('sha256');
    let offset = 0;
    try {
      while (offset < resolvedMetadata.size) {
        const bytes = await reader.read(offset, Math.min(64 * 1024, resolvedMetadata.size - offset));
        if (bytes.byteLength === 0) throw new Error('RESOURCE_CHANGED');
        offset += bytes.byteLength;
        if (offset > MAX_MUTATION_FILE_BYTES) throw new Error('RESOURCE_TOO_LARGE');
        hash.update(bytes);
        assertDeadline(context);
      }
    } finally {
      await reader.close().catch(() => undefined);
    }
    return {
      path: requestedPath,
      resolvedPath,
      exists: true,
      type: 'file',
      sizeBytes: resolvedMetadata.size,
      modifiedAt: resolvedMetadata.modifiedAt,
      mode: resolvedMetadata.mode,
      sha256: hash.digest('hex'),
    };
  }

  private async inspectFileWithFilesystem(
    context: ToolContext,
    filesystem: RemoteFileSystem,
    remotePath: string,
  ): Promise<SshFileMutationInspection> {
    const inspected = await this.inspectPathWithFilesystem(context, filesystem, remotePath);
    if (inspected.type === 'directory') throw new Error('RESOURCE_FORBIDDEN');
    return inspected as SshFileMutationInspection;
  }

  private async removeDirectoryTree(
    context: ToolContext,
    filesystem: RemoteFileSystem,
    remotePath: string,
  ): Promise<void> {
    const root = await this.inspectPathWithFilesystem(context, filesystem, remotePath);
    if (!root.exists || root.type !== 'directory') throw new Error('RESOURCE_FORBIDDEN');
    let visited = 0;
    const remove = async (directoryPath: string): Promise<void> => {
      const entries = await filesystem.readDirectory(directoryPath);
      for (const entry of entries) {
        visited += 1;
        if (visited > MAX_RECURSIVE_DELETE_ENTRIES) throw new Error('RESOURCE_TOO_LARGE');
        if (entry.metadata.isSymbolicLink || (!entry.metadata.isFile && !entry.metadata.isDirectory)) {
          throw new Error('RESOURCE_FORBIDDEN');
        }
        const child = normalizeRemotePath(path.posix.join(directoryPath, entry.name));
        if (hardDeniedPath(child)) throw new Error('RESOURCE_FORBIDDEN');
        if (entry.metadata.isDirectory) await remove(child);
        else await filesystem.removeFile(child);
        assertDeadline(context);
      }
      await filesystem.removeDirectory(directoryPath);
    };
    await remove(root.resolvedPath);
  }

  private async withSession<T>(
    context: ToolContext,
    connectionId: number,
    work: (session: ExecutionSession) => Promise<T>,
    expectedConfigurationHash?: string,
  ): Promise<T> {
    assertDeadline(context);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    assertConnectionSelected(context, connectionId);
    const safe = await this.connections.get(connectionId);
    if (!safe || safe.type !== 'SSH') throw new Error('NOT_FOUND');
    if (expectedConfigurationHash !== undefined && safe.configurationHash !== expectedConfigurationHash) {
      throw new Error('RESOURCE_CHANGED');
    }
    const resolved = await this.connections.resolve(connectionId, expectedConfigurationHash);
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.agentRuntimeId,
      connection: resolved,
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      assertDeadline(context);
      return await work(session);
    } finally {
      await this.sessions.close(session.id).catch(() => undefined);
    }
  }
}
