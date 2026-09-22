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
import type { AgentArtifactRefDto, AgentEnvelopeDto } from './agent-api.types';
import type {
  AgentArtifactPageDto,
  AgentArtifactCleanupPreviewDto,
  AgentArtifactCleanupResultDto,
  AgentArtifactStorageSummaryDto,
} from './agent-api';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';

export const createArtifactApi = () => ({
  async storage(): Promise<AgentArtifactStorageSummaryDto> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentArtifactStorageSummaryDto>>('/agent/files/storage')).data);
  },
  async files(query: Omit<AgentArtifactLibraryQueryDto, 'limit'> = {}): Promise<AgentArtifactPageDto> {
    const params: AgentArtifactLibraryQueryDto = { limit: 100, ...query };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentArtifactPageDto>>('/agent/files', {
          params,
        })
      ).data,
    );
  },
  async uploadArtifact(appId: string, file: File): Promise<AgentArtifactRefDto> {
    const input: AgentArtifactBeginRequestDto = {
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      declaredBytes: file.size,
    };
    const reservation = unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentArtifactUploadReservationDto>>(
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
        await httpClient.get<AgentEnvelopeDto<AgentArtifactRefDto>>(
          `/apps/${encodeURIComponent(appId)}/artifacts/${encodeURIComponent(reservation.artifactId)}`,
        )
      ).data,
    );
  },
  async retainArtifact(artifact: AgentArtifactRefDto, retained: boolean): Promise<AgentArtifactRefDto> {
    const input: AgentArtifactRetainRequestDto = { retained, expectedVersion: artifact.version };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentArtifactRefDto>>(
          `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteArtifact(artifact: AgentArtifactRefDto): Promise<void> {
    const params: AgentArtifactDeleteQueryDto = { expectedVersion: artifact.version };
    await httpClient.delete(
      `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
      {
        params,
        headers: await mutationHeaders(),
      },
    );
  },
  async previewArtifactCleanup(): Promise<AgentArtifactCleanupPreviewDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentArtifactCleanupPreviewDto>>(
          '/agent/files/cleanup/preview',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async confirmArtifactCleanup(confirmationId: string): Promise<AgentArtifactCleanupResultDto> {
    const input: AgentArtifactCleanupConfirmRequestDto = { confirmationId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentArtifactCleanupResultDto>>(
          '/agent/files/cleanup/confirm',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async attachArtifact(
    artifact: AgentArtifactRefDto,
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
        await httpClient.post<AgentEnvelopeDto<AgentArtifactAttachResponseDto>>(
          `/agent/files/${encodeURIComponent(artifact.id)}/attach`,
          request,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
