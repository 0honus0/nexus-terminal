import type { Scope } from '../agent.types';
import type { ArtifactRef } from '../ai/artifact.port';
import type { ArtifactService } from '../ai/artifact.service';
import type { WorkspaceRuntimeService } from '../workspace-runtime/workspace-runtime.service';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import type { AgentCapability } from '../host/app.types';
import type {
  WorkspaceArtifactExportInput,
  WorkspaceArtifactImportInput,
  WorkspaceArtifactImportResult,
} from './workspace-artifact.types';

const ARTIFACT_READ_CHUNK_BYTES = 8 * 1024 * 1024;

export class WorkspaceArtifactService {
  constructor(
    private readonly workspaceRuntime: WorkspaceRuntimeService,
    private readonly artifacts: ArtifactService,
    private readonly capabilities: AppCapabilityBroker,
  ) {}

  async export(scope: Scope, input: WorkspaceArtifactExportInput, signal: AbortSignal): Promise<ArtifactRef> {
    await Promise.all([
      this.requireCapability(scope, 'workspace.runtime.execute'),
      this.requireCapability(scope, 'artifacts.write'),
    ]);
    const read = await this.workspaceRuntime.openWorkspaceFileRead(
      scope,
      input.workspaceId,
      input.targetPluginId,
      input.path,
      signal,
    );
    try {
      const reservation = await this.artifacts.begin(scope, {
        name: input.name,
        mediaType: input.mediaType,
        declaredBytes: read.sizeBytes,
      });
      return await this.artifacts.write(scope, reservation.artifactId, read.source, signal);
    } finally {
      await read.close();
    }
  }

  async import(
    scope: Scope,
    input: WorkspaceArtifactImportInput,
    signal: AbortSignal,
  ): Promise<WorkspaceArtifactImportResult> {
    await Promise.all([
      this.requireCapability(scope, 'workspace.runtime.execute'),
      this.requireCapability(scope, 'artifacts.read'),
    ]);
    const artifact = await this.artifacts.get(scope, input.artifactId);
    if (!artifact || artifact.status !== 'ready') throw new Error('ARTIFACT_NOT_READY');
    const source = this.artifactChunks(scope, artifact, signal);
    await this.workspaceRuntime.writeWorkspaceFileStream(
      scope,
      input.workspaceId,
      input.targetPluginId,
      input.path,
      source,
      artifact.sizeBytes,
      signal,
    );
    return {
      artifact,
      workspaceId: input.workspaceId,
      targetPluginId: input.targetPluginId,
      path: input.path,
      writtenBytes: artifact.sizeBytes,
    };
  }

  private async *artifactChunks(scope: Scope, artifact: ArtifactRef, signal: AbortSignal): AsyncIterable<Uint8Array> {
    let offset = 0;
    let total = 0;
    while (offset < artifact.sizeBytes) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      const endInclusive = Math.min(offset + ARTIFACT_READ_CHUNK_BYTES, artifact.sizeBytes) - 1;
      for await (const chunk of this.artifacts.read(scope, artifact.id, { start: offset, endInclusive })) {
        if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
        total += chunk.byteLength;
        if (total > artifact.sizeBytes) throw new Error('ARTIFACT_SIZE_MISMATCH');
        yield chunk;
      }
      offset = endInclusive + 1;
    }
    if (total !== artifact.sizeBytes) throw new Error('ARTIFACT_SIZE_MISMATCH');
  }

  private async requireCapability(scope: Scope, capability: AgentCapability): Promise<void> {
    const decision = await this.capabilities.authorize(scope, capability);
    if (!decision.allowed) throw new Error(decision.code);
  }
}
