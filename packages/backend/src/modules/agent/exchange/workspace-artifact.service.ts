import { logErrorCode, logger } from '../../../shared/logging/logger';
import type { Scope } from '../agent.types';
import type { ArtifactRef } from '../ai/artifact.port';
import type { ArtifactService } from '../ai/artifact.service';
import type { WorkspaceRuntimeService } from '../workspace-runtime/workspace-runtime.service';
import type { AppCapabilityBroker } from '../host/app-capability-broker';
import type { AgentCapability, CapabilityResource } from '../host/capability.types';
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
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        workspaceId: input.workspaceId,
        targetPluginId: input.targetPluginId,
      },
      'Agent Workspace Artifact export started',
    );
    await this.requireCapability(scope, 'file.read', { target: { target: 'workspace', id: input.workspaceId } });
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
      const artifact = await this.artifacts.write(scope, reservation.artifactId, read.source, signal);
      logger.info(
        {
          userId: scope.userId,
          appId: scope.appId,
          workspaceId: input.workspaceId,
          targetPluginId: input.targetPluginId,
          artifactId: artifact.id,
          sizeBytes: artifact.sizeBytes,
        },
        'Agent Workspace Artifact export completed',
      );
      return artifact;
    } catch (error) {
      logger.warn(
        {
          errorCode: logErrorCode(error, signal.aborted ? 'ABORTED' : 'WORKSPACE_ARTIFACT_EXPORT_FAILED'),
          userId: scope.userId,
          appId: scope.appId,
          workspaceId: input.workspaceId,
          targetPluginId: input.targetPluginId,
          sizeBytes: read.sizeBytes,
          aborted: signal.aborted,
        },
        'Agent Workspace Artifact export failed',
      );
      throw error;
    } finally {
      try {
        await read.close();
      } catch (error) {
        logger.warn(
          {
            errorCode: logErrorCode(error, 'WORKSPACE_ARTIFACT_READ_CLOSE_FAILED'),
            userId: scope.userId,
            appId: scope.appId,
            workspaceId: input.workspaceId,
            targetPluginId: input.targetPluginId,
          },
          'Agent Workspace Artifact source close failed',
        );
      }
    }
  }

  async import(
    scope: Scope,
    input: WorkspaceArtifactImportInput,
    signal: AbortSignal,
  ): Promise<WorkspaceArtifactImportResult> {
    logger.debug(
      {
        userId: scope.userId,
        appId: scope.appId,
        workspaceId: input.workspaceId,
        targetPluginId: input.targetPluginId,
        artifactId: input.artifactId,
      },
      'Agent Workspace Artifact import started',
    );
    try {
      await Promise.all([
        this.requireCapability(scope, 'file.write', { target: { target: 'workspace', id: input.workspaceId } }),
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
      logger.info(
        {
          userId: scope.userId,
          appId: scope.appId,
          workspaceId: input.workspaceId,
          targetPluginId: input.targetPluginId,
          artifactId: artifact.id,
          sizeBytes: artifact.sizeBytes,
        },
        'Agent Workspace Artifact import completed',
      );
      return {
        artifact,
        workspaceId: input.workspaceId,
        targetPluginId: input.targetPluginId,
        path: input.path,
        writtenBytes: artifact.sizeBytes,
      };
    } catch (error) {
      logger.warn(
        {
          errorCode: logErrorCode(error, signal.aborted ? 'ABORTED' : 'WORKSPACE_ARTIFACT_IMPORT_FAILED'),
          userId: scope.userId,
          appId: scope.appId,
          workspaceId: input.workspaceId,
          targetPluginId: input.targetPluginId,
          artifactId: input.artifactId,
          aborted: signal.aborted,
        },
        'Agent Workspace Artifact import failed',
      );
      throw error;
    }
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

  private async requireCapability(
    scope: Scope,
    capability: AgentCapability,
    resource: CapabilityResource = {},
  ): Promise<void> {
    const decision = await this.capabilities.authorize(scope, capability, resource);
    if (!decision.allowed) throw new Error(decision.code);
  }
}
