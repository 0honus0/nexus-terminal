import type {
  AgentArtifactAttachRequestDto,
  AgentArtifactAttachResponseDto,
  AgentArtifactBeginRequestDto,
  AgentArtifactCleanupConfirmRequestDto,
  AgentArtifactDeleteQueryDto,
  AgentArtifactLibraryQueryDto,
  AgentArtifactRetainRequestDto,
  AgentArtifactUploadReservationDto,
} from '@nexus-terminal/protocol/agent-artifacts';
import type { AgentArtifactRef, AgentEnvelope } from './agent-api.types';
import type {
  AgentArtifactPage,
  ArtifactCleanupPreview,
  ArtifactCleanupResult,
  ArtifactStorageSummary,
} from './agent-api';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';

export const createArtifactApi = () => ({
  async storage(): Promise<ArtifactStorageSummary> {
    return unwrap((await httpClient.get<AgentEnvelope<ArtifactStorageSummary>>('/agent/files/storage')).data);
  },
  async files(query: Omit<AgentArtifactLibraryQueryDto, 'limit'> = {}): Promise<AgentArtifactPage> {
    const params: AgentArtifactLibraryQueryDto = { limit: 100, ...query };
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentArtifactPage>>('/agent/files', {
          params,
        })
      ).data,
    );
  },
  async uploadArtifact(appId: string, file: File): Promise<AgentArtifactRef> {
    const input: AgentArtifactBeginRequestDto = {
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      declaredBytes: file.size,
    };
    const reservation = unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentArtifactUploadReservationDto>>(
          `/apps/${encodeURIComponent(appId)}/artifacts`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
    const uploadPath = reservation.uploadUrl.replace(/^\/api\/v1/, '');
    await httpClient.put(uploadPath, file, {
      headers: { ...(await mutationHeaders()), 'Content-Type': file.type || 'application/octet-stream' },
      timeout: 120_000,
    });
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentArtifactRef>>(
          `/apps/${encodeURIComponent(appId)}/artifacts/${encodeURIComponent(reservation.artifactId)}`,
        )
      ).data,
    );
  },
  async retainArtifact(artifact: AgentArtifactRef, retained: boolean): Promise<AgentArtifactRef> {
    const input: AgentArtifactRetainRequestDto = { retained, expectedVersion: artifact.version };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentArtifactRef>>(
          `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteArtifact(artifact: AgentArtifactRef): Promise<void> {
    const params: AgentArtifactDeleteQueryDto = { expectedVersion: artifact.version };
    await httpClient.delete(
      `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
      {
        params,
        headers: await mutationHeaders(),
      },
    );
  },
  async previewArtifactCleanup(): Promise<ArtifactCleanupPreview> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<ArtifactCleanupPreview>>(
          '/agent/files/cleanup/preview',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmArtifactCleanup(confirmationId: string): Promise<ArtifactCleanupResult> {
    const input: AgentArtifactCleanupConfirmRequestDto = { confirmationId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<ArtifactCleanupResult>>(
          '/agent/files/cleanup/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async attachArtifact(
    artifact: AgentArtifactRef,
    input: { targetAppId: string; threadId: string; runId?: string },
  ): Promise<AgentArtifactAttachResponseDto> {
    const request: AgentArtifactAttachRequestDto = {
      targetAppId: input.targetAppId,
      threadId: input.threadId,
      ...(input.runId ? { runId: input.runId } : {}),
      role: 'input',
      expectedVersion: artifact.version,
    };
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentArtifactAttachResponseDto>>(
          `/agent/files/${encodeURIComponent(artifact.id)}/attach`,
          request,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
