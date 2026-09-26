import { isDeepStrictEqual } from 'node:util';
import { logger } from '../../../../shared/logging/logger';
import type { AgentRunEnvironmentSnapshot, Scope } from '../../agent.types';
import type { ArtifactRef } from '../../ai/artifact.port';
import type { ArtifactService } from '../../ai/artifact.service';
import { isAgentUuid } from '../../uuid';
import type { AgentWorkspaceRepositoryPort } from '../../workspace-runtime/workspace-runtime.repository.port';
import type { WorkspaceRuntimeControllerPort } from '../../workspace-runtime/workspace-runtime-controller.port';
import type { WorkspaceRuntimeService } from '../../workspace-runtime/workspace-runtime.service';
import type { CheckpointWorkspaceCapture } from './checkpoint.repository.port';

const MANIFEST_MEDIA_TYPE = 'application/vnd.nexus.workspace-checkpoint+json';
const ARCHIVE_MEDIA_TYPE = 'application/x-tar';
const MAX_MANIFEST_BYTES = 128 * 1024;
const ARTIFACT_READ_CHUNK_BYTES = 8 * 1024 * 1024;

export interface WorkspaceCheckpointManifest {
  schemaVersion: 1;
  kind: 'nexus.workspace.checkpoint';
  source: {
    workspaceId: string;
    runId: string;
    agentRuntimeId: string;
    generation: number;
    workspaceVersion: number;
    status: 'ready' | 'running' | 'stopped';
    retained: boolean;
  };
  profile: AgentRunEnvironmentSnapshot;
  work: {
    logicalRoot: '/workspace/work';
    archiveArtifactId: string;
    archiveSha256: string;
    archiveBytes: number;
    mediaType: typeof ARCHIVE_MEDIA_TYPE;
  };
}

const sourceOf = (bytes: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield bytes;
  })();

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
  }
  return value as Record<string, unknown>;
};

const stringValue = (value: unknown, maxBytes = 4096): string => {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
  }
  return value;
};

const positiveInteger = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
  }
  return Number(value);
};

const decodeManifest = (
  raw: string,
  expectedEnvironment: AgentRunEnvironmentSnapshot | null | undefined,
): WorkspaceCheckpointManifest => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const root = record(parsed);
    if (
      root.schemaVersion !== 1 ||
      root.kind !== 'nexus.workspace.checkpoint' ||
      !expectedEnvironment ||
      !isDeepStrictEqual(root.profile, expectedEnvironment)
    ) {
      throw new Error('invalid');
    }
    const source = record(root.source);
    const work = record(root.work);
    const workspaceId = stringValue(source.workspaceId);
    const runId = stringValue(source.runId);
    const agentRuntimeId = stringValue(source.agentRuntimeId);
    const archiveArtifactId = stringValue(work.archiveArtifactId);
    const archiveSha256 = stringValue(work.archiveSha256, 128);
    if (
      !isAgentUuid(workspaceId) ||
      !isAgentUuid(runId) ||
      !isAgentUuid(agentRuntimeId) ||
      !isAgentUuid(archiveArtifactId) ||
      !['ready', 'running', 'stopped'].includes(String(source.status)) ||
      typeof source.retained !== 'boolean' ||
      work.logicalRoot !== '/workspace/work' ||
      work.mediaType !== ARCHIVE_MEDIA_TYPE ||
      !/^[a-f0-9]{64}$/.test(archiveSha256)
    ) {
      throw new Error('invalid');
    }
    return {
      schemaVersion: 1,
      kind: 'nexus.workspace.checkpoint',
      source: {
        workspaceId,
        runId,
        agentRuntimeId,
        generation: positiveInteger(source.generation),
        workspaceVersion: positiveInteger(source.workspaceVersion),
        status: source.status as 'ready' | 'running' | 'stopped',
        retained: source.retained,
      },
      profile: structuredClone(expectedEnvironment),
      work: {
        logicalRoot: '/workspace/work',
        archiveArtifactId,
        archiveSha256,
        archiveBytes: positiveInteger(work.archiveBytes),
        mediaType: ARCHIVE_MEDIA_TYPE,
      },
    };
  } catch {
    throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
  }
};

export class WorkspaceCheckpointService {
  constructor(
    private readonly repository: AgentWorkspaceRepositoryPort,
    private readonly runtime: WorkspaceRuntimeService,
    private readonly controller: WorkspaceRuntimeControllerPort,
    private readonly artifacts: ArtifactService,
  ) {}

  async capture(scope: Scope, runId: string): Promise<CheckpointWorkspaceCapture[]> {
    const candidates = (await this.repository.listWorkspaces(scope, runId)).filter(
      (workspace) => !['deleted', 'failed'].includes(workspace.status),
    );
    if (candidates.length === 0) return [];
    if (candidates.length !== 1) throw new Error('CHECKPOINT_NOT_SAFE');
    const workspace = candidates[0]!;
    if (!['ready', 'running', 'stopped'].includes(workspace.status)) throw new Error('CHECKPOINT_NOT_SAFE');

    const read = await this.controller.openWorkspaceCheckpointArchive(workspace.id, workspace.generation);
    let archive: ArtifactRef;
    try {
      const reservation = await this.artifacts.begin(scope, {
        name: `workspace-${workspace.id}-g${workspace.generation}.tar`,
        mediaType: ARCHIVE_MEDIA_TYPE,
        declaredBytes: read.sizeBytes,
      });
      archive = await this.artifacts.write(scope, reservation.artifactId, read.source, new AbortController().signal);
    } finally {
      await read.close();
    }
    if (!archive.sha256 || archive.status !== 'ready') throw new Error('CHECKPOINT_ARTIFACT_UNAVAILABLE');

    const manifest: WorkspaceCheckpointManifest = {
      schemaVersion: 1,
      kind: 'nexus.workspace.checkpoint',
      source: {
        workspaceId: workspace.id,
        runId: workspace.runId,
        agentRuntimeId: workspace.agentRuntimeId,
        generation: workspace.generation,
        workspaceVersion: workspace.version,
        status: workspace.status as 'ready' | 'running' | 'stopped',
        retained: workspace.retained,
      },
      profile: structuredClone(workspace.profile),
      work: {
        logicalRoot: '/workspace/work',
        archiveArtifactId: archive.id,
        archiveSha256: archive.sha256,
        archiveBytes: archive.sizeBytes,
        mediaType: ARCHIVE_MEDIA_TYPE,
      },
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8');
    if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    const reservation = await this.artifacts.begin(scope, {
      name: `workspace-${workspace.id}-checkpoint.json`,
      mediaType: MANIFEST_MEDIA_TYPE,
      declaredBytes: manifestBytes.byteLength,
    });
    const manifestArtifact = await this.artifacts.write(
      scope,
      reservation.artifactId,
      sourceOf(manifestBytes),
      new AbortController().signal,
    );
    if (manifestArtifact.status !== 'ready' || !manifestArtifact.sha256) {
      throw new Error('CHECKPOINT_ARTIFACT_UNAVAILABLE');
    }
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId,
        workspaceId: workspace.id,
        generation: workspace.generation,
        manifestArtifactId: manifestArtifact.id,
        archiveArtifactId: archive.id,
        archiveBytes: archive.sizeBytes,
      },
      'Agent Workspace checkpoint captured',
    );
    return [
      {
        workspaceId: workspace.id,
        generation: workspace.generation,
        expectedVersion: workspace.version,
        manifestArtifactId: manifestArtifact.id,
        artifactRefs: [manifestArtifact.id, archive.id],
      },
    ];
  }

  async validate(
    scope: Scope,
    sourceRunId: string,
    expectedEnvironment: AgentRunEnvironmentSnapshot | null | undefined,
    manifestArtifactIds: readonly string[],
  ): Promise<WorkspaceCheckpointManifest[]> {
    if (manifestArtifactIds.length === 0) return [];
    if (manifestArtifactIds.length !== 1) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    const manifestArtifact = await this.artifacts.get(scope, manifestArtifactIds[0]!);
    if (
      !manifestArtifact ||
      manifestArtifact.status !== 'ready' ||
      manifestArtifact.mediaType !== MANIFEST_MEDIA_TYPE ||
      manifestArtifact.sizeBytes < 1 ||
      manifestArtifact.sizeBytes > MAX_MANIFEST_BYTES
    ) {
      throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    }
    const raw = await this.readText(scope, manifestArtifact);
    const manifest = decodeManifest(raw, expectedEnvironment);
    if (manifest.source.runId !== sourceRunId) {
      throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    }
    const archive = await this.artifacts.get(scope, manifest.work.archiveArtifactId);
    if (
      !archive ||
      archive.status !== 'ready' ||
      archive.mediaType !== ARCHIVE_MEDIA_TYPE ||
      archive.sha256 !== manifest.work.archiveSha256 ||
      archive.sizeBytes !== manifest.work.archiveBytes
    ) {
      throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    }
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        sourceRunId,
        workspaceId: manifest.source.workspaceId,
        generation: manifest.source.generation,
        manifestArtifactId: manifestArtifact.id,
      },
      'Agent Workspace checkpoint validated',
    );
    return [manifest];
  }

  async restore(
    scope: Scope,
    newRunId: string,
    newRuntimeId: string,
    manifests: readonly WorkspaceCheckpointManifest[],
  ): Promise<void> {
    if (manifests.length === 0) return;
    if (manifests.length !== 1) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    const manifest = manifests[0]!;
    const existing = (await this.repository.listWorkspaces(scope, newRunId)).find(
      (workspace) => workspace.agentRuntimeId === newRuntimeId && !['deleted', 'failed'].includes(workspace.status),
    );
    let workspace = existing;
    if (!workspace) {
      workspace = await this.runtime.createWorkspace(
        scope,
        newRunId,
        newRuntimeId,
        null,
        false,
        `checkpoint:${newRunId}:${manifest.work.archiveSha256}`,
        manifest.profile.catalogRevision,
        manifest.profile,
      );
    }
    if (workspace.profile.runtimeDigest !== manifest.profile.runtimeDigest) {
      throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    }
    if (workspace.status === 'running') return;
    if (workspace.status !== 'ready') throw new Error('CHECKPOINT_WORKSPACE_RESTORE_NOT_READY');

    const archive = await this.artifacts.get(scope, manifest.work.archiveArtifactId);
    if (
      !archive ||
      archive.status !== 'ready' ||
      archive.sha256 !== manifest.work.archiveSha256 ||
      archive.sizeBytes !== manifest.work.archiveBytes
    ) {
      throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    }
    await this.controller.restoreWorkspaceCheckpointArchive(
      workspace.id,
      workspace.generation,
      this.artifactChunks(scope, archive),
      archive.sizeBytes,
    );
    await this.runtime.action(scope, workspace.id, 'start', workspace.version, true);
    const restored = await this.repository.getWorkspace(scope, workspace.id);
    if (!restored || restored.status !== 'running') throw new Error('CHECKPOINT_WORKSPACE_RESTORE_FAILED');
    logger.info(
      {
        userId: scope.userId,
        appId: scope.appId,
        runId: newRunId,
        runtimeId: newRuntimeId,
        workspaceId: restored.id,
        generation: restored.generation,
        archiveArtifactId: manifest.work.archiveArtifactId,
      },
      'Agent Workspace checkpoint restored',
    );
  }

  private async readText(scope: Scope, artifact: ArtifactRef): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of this.artifacts.read(scope, artifact.id, {
      start: 0,
      endInclusive: artifact.sizeBytes - 1,
    })) {
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.byteLength !== artifact.sizeBytes) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
    return bytes.toString('utf8');
  }

  private async *artifactChunks(scope: Scope, artifact: ArtifactRef): AsyncIterable<Uint8Array> {
    let offset = 0;
    let total = 0;
    while (offset < artifact.sizeBytes) {
      const endInclusive = Math.min(offset + ARTIFACT_READ_CHUNK_BYTES, artifact.sizeBytes) - 1;
      for await (const chunk of this.artifacts.read(scope, artifact.id, { start: offset, endInclusive })) {
        total += chunk.byteLength;
        if (total > artifact.sizeBytes) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
        yield chunk;
      }
      offset = endInclusive + 1;
    }
    if (total !== artifact.sizeBytes) throw new Error('CHECKPOINT_WORKSPACE_MANIFEST_INVALID');
  }
}
