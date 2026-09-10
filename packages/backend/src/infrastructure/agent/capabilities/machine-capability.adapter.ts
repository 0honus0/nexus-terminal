import { createHash } from 'node:crypto';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import type {
  AgentConnectionResolverPort,
  AgentDiagnosticReport,
  AgentDiagnosticsPort,
  BoundedFileResult,
  DockerMutationInspection,
  DockerMutationResult,
  FileMutationInspection,
  FileMutationResult,
  MachineCapabilityPort,
  MachineTargetFingerprint,
  MachineToolContext,
  ShellMutationResult,
} from '../../../modules/agent/capabilities/machine.port';
import type { Scope } from '../../../modules/agent/agent.types';
import type { RemoteDockerService } from '../../../platform/docker/remote-docker.service';
import type { ExecutionSession } from '../../../platform/execution/execution-session';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import { isRemoteFileMissingError, type RemoteFileSystem } from '../../../platform/filesystem/remote-filesystem';

const MAX_FILE_READ_BYTES = 1024 * 1024;
const MAX_MUTATION_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SHELL_BYTES = 16 * 1024;
const MAX_PROBES = 32;
const MAX_PROBE_ID_LENGTH = 128;

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

const assertDeadline = (context: MachineToolContext): void => {
  if (context.signal.aborted) throw new DOMException('Agent machine operation aborted.', 'AbortError');
  if (Math.floor(Date.now() / 1000) >= context.deadlineAt) throw new Error('TOOL_TIMEOUT');
};

const readLength = (requested: number, context: MachineToolContext): number => {
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error('VALIDATION_FAILED');
  return Math.min(requested, context.maxOutputBytes, MAX_FILE_READ_BYTES);
};

export class MachineCapabilityAdapter implements MachineCapabilityPort {
  constructor(
    private readonly connections: AgentConnectionResolverPort,
    private readonly diagnostics: AgentDiagnosticsPort,
    private readonly sessions: ExecutionSessionManager,
    private readonly docker: RemoteDockerService,
  ) {}

  async target(_scope: Scope, connectionId: number): Promise<MachineTargetFingerprint> {
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    const endpoint = `${connection.host.trim().toLowerCase()}:${connection.port}`;
    const targetIdentity = createHash('sha256')
      .update(`${endpoint}\n${connection.username}\n${connection.configurationHash}`, 'utf8')
      .digest('hex');
    return {
      kind: 'machine',
      connectionId,
      targetIdentity,
      endpoint,
      loginUser: connection.username,
      configurationHash: connection.configurationHash,
      hostKeyTrust: 'unavailable',
    };
  }

  async diagnose(
    _scope: Scope,
    connectionId: number,
    probeIds: readonly string[],
    actorId: string,
    signal: AbortSignal,
  ): Promise<AgentDiagnosticReport> {
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    if (
      !Array.isArray(probeIds) ||
      probeIds.length > MAX_PROBES ||
      probeIds.some((id) => typeof id !== 'string' || id.length < 1 || id.length > MAX_PROBE_ID_LENGTH)
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    if (signal.aborted) throw new DOMException('Agent diagnostics aborted.', 'AbortError');
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    return this.diagnostics.run(connectionId, [...new Set(probeIds)], actorId);
  }

  async inspectFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
  ): Promise<FileMutationInspection> {
    return this.withSession(context, connectionId, async (session) => {
      const filesystem = await session.fileSystem('control');
      return this.inspectFileWithFilesystem(context, filesystem, remotePath);
    });
  }

  async writeFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    content: Uint8Array,
    expectedSha256: string | null,
  ): Promise<FileMutationResult> {
    assertDeadline(context);
    if (!(content instanceof Uint8Array) || content.byteLength > MAX_MUTATION_FILE_BYTES)
      throw new Error('TOOL_INPUT_TOO_LARGE');
    if (expectedSha256 !== null && !/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('VALIDATION_FAILED');
    return this.withSession(context, connectionId, async (session) => {
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
    });
  }

  async executeShell(
    context: MachineToolContext,
    connectionId: number,
    command: string,
    timeoutSeconds: number,
  ): Promise<ShellMutationResult> {
    assertDeadline(context);
    if (
      typeof command !== 'string' ||
      command.length < 1 ||
      command.includes('\0') ||
      Buffer.byteLength(command, 'utf8') > MAX_SHELL_BYTES ||
      !Number.isSafeInteger(timeoutSeconds) ||
      timeoutSeconds < 1 ||
      timeoutSeconds > 300
    ) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.withSession(context, connectionId, async (session) => {
      const remainingMs = Math.max(1, context.deadlineAt * 1000 - Date.now());
      const result = await session.execute({
        command,
        timeoutMs: Math.min(timeoutSeconds * 1000, remainingMs),
        maxOutputBytes: context.maxOutputBytes,
        signal: context.signal,
      });
      return {
        exitCode: result.exitCode,
        signal: result.signal ?? null,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
      };
    });
  }

  async inspectDockerContainer(
    context: MachineToolContext,
    connectionId: number,
    containerId: string,
  ): Promise<DockerMutationInspection> {
    if (!/^[a-fA-F0-9]{12,64}$/.test(containerId)) throw new Error('VALIDATION_FAILED');
    return this.withSession(context, connectionId, async (session) =>
      this.inspectDockerWithSession(session, containerId),
    );
  }

  async mutateDockerContainer(
    context: MachineToolContext,
    connectionId: number,
    containerId: string,
    action: 'start' | 'stop' | 'restart' | 'remove',
    expectedState: string,
  ): Promise<DockerMutationResult> {
    if (!['start', 'stop', 'restart', 'remove'].includes(action) || !expectedState || expectedState.length > 64) {
      throw new Error('VALIDATION_FAILED');
    }
    return this.withSession(context, connectionId, async (session) => {
      const before = await this.inspectDockerWithSession(session, containerId);
      if (before.state !== expectedState) throw new Error('RESOURCE_CHANGED');
      await this.docker.executeCommand(session, before.containerId, action);
      assertDeadline(context);
      if (action === 'remove') {
        const status = await this.docker.getStatus(session);
        const remains = status.containers.some((candidate) => candidate.id === before.containerId);
        if (remains) throw new Error('VERIFICATION_FAILED');
        return { ...before, action, confirmed: true };
      }
      const after = await this.inspectDockerWithSession(session, before.containerId);
      const expectedAfter = action === 'stop' ? 'exited' : 'running';
      if (after.state !== expectedAfter) throw new Error('VERIFICATION_FAILED');
      return { ...after, action, confirmed: true };
    });
  }

  async readFile(
    context: MachineToolContext,
    connectionId: number,
    remotePath: string,
    maxBytes: number,
    offset = 0,
  ): Promise<BoundedFileResult> {
    assertDeadline(context);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('VALIDATION_FAILED');
    }
    const requestedPath = normalizeRemotePath(remotePath);
    if (hardDeniedPath(requestedPath)) throw new Error('RESOURCE_FORBIDDEN');
    const limit = readLength(maxBytes, context);
    const connection = await this.connections.get(connectionId);
    if (!connection || connection.type !== 'SSH') throw new Error('NOT_FOUND');
    const resolved = await this.connections.resolve(connectionId);
    const session = await this.sessions.connect({
      ownerType: 'agent',
      ownerId: context.agentRuntimeId,
      connection: resolved,
      connect: { signal: context.signal, timeoutMs: Math.max(1, context.deadlineAt * 1000 - Date.now()) },
    });
    try {
      assertDeadline(context);
      const filesystem = await session.fileSystem('control');
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
        return {
          path: requestedPath,
          resolvedPath: normalizedResolved,
          sizeBytes: metadata.size,
          modifiedAt: metadata.modifiedAt,
          offset,
          bytesRead: bytes.byteLength,
          truncated: offset + bytes.byteLength < metadata.size,
          content: Buffer.from(bytes).toString('utf8'),
        };
      } finally {
        await reader.close().catch(() => undefined);
      }
    } finally {
      await this.sessions.close(session.id).catch(() => undefined);
    }
  }

  private async inspectFileWithFilesystem(
    context: MachineToolContext,
    filesystem: RemoteFileSystem,
    remotePath: string,
  ): Promise<FileMutationInspection> {
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
        sizeBytes: null,
        modifiedAt: null,
        mode: null,
        sha256: null,
      };
    }
    if (metadata.isSymbolicLink || !metadata.isFile) throw new Error('RESOURCE_FORBIDDEN');
    if (metadata.size > MAX_MUTATION_FILE_BYTES) throw new Error('RESOURCE_TOO_LARGE');
    const resolvedPath = normalizeRemotePath(await filesystem.resolvePath(requestedPath));
    if (hardDeniedPath(resolvedPath)) throw new Error('RESOURCE_FORBIDDEN');
    const resolvedMetadata = await filesystem.metadata(resolvedPath, { followSymbolicLinks: false });
    if (resolvedMetadata.isSymbolicLink || !resolvedMetadata.isFile) throw new Error('RESOURCE_FORBIDDEN');
    const reader = await filesystem.openRead(resolvedPath);
    const hash = createHash('sha256');
    let total = 0;
    for await (const chunk of reader) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > MAX_MUTATION_FILE_BYTES) throw new Error('RESOURCE_TOO_LARGE');
      hash.update(bytes);
      assertDeadline(context);
    }
    return {
      path: requestedPath,
      resolvedPath,
      exists: true,
      sizeBytes: resolvedMetadata.size,
      modifiedAt: resolvedMetadata.modifiedAt,
      mode: resolvedMetadata.mode,
      sha256: hash.digest('hex'),
    };
  }

  private async inspectDockerWithSession(
    session: ExecutionSession,
    containerId: string,
  ): Promise<DockerMutationInspection> {
    const status = await this.docker.getStatus(session);
    if (!status.available) throw new Error('DOCKER_UNAVAILABLE');
    const matches = status.containers.filter(
      (candidate) => candidate.id === containerId || candidate.id.startsWith(containerId),
    );
    if (matches.length !== 1) throw new Error(matches.length === 0 ? 'NOT_FOUND' : 'VALIDATION_FAILED');
    const container = matches[0]!;
    return { containerId: container.id, state: container.State, image: container.ImageID || container.Image };
  }

  private async withSession<T>(
    context: MachineToolContext,
    connectionId: number,
    work: (session: ExecutionSession) => Promise<T>,
  ): Promise<T> {
    assertDeadline(context);
    if (!Number.isSafeInteger(connectionId) || connectionId < 1) throw new Error('VALIDATION_FAILED');
    const safe = await this.connections.get(connectionId);
    if (!safe || safe.type !== 'SSH') throw new Error('NOT_FOUND');
    const resolved = await this.connections.resolve(connectionId);
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
