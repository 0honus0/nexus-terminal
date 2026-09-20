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
  async files(
    query: {
      before?: string;
      q?: string;
      appId?: string;
      retained?: boolean;
      kind?: 'image' | 'document' | 'code' | 'archive' | 'media' | 'other';
    } = {},
  ): Promise<AgentArtifactPage> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<AgentArtifactPage>>('/agent/files', {
          params: { limit: 100, ...query },
        })
      ).data,
    );
  },
  async uploadArtifact(appId: string, file: File): Promise<AgentArtifactRef> {
    const reservation = unwrap(
      (
        await httpClient.post<AgentEnvelope<{ artifactId: string; uploadUrl: string; expiresAt: number }>>(
          `/apps/${encodeURIComponent(appId)}/artifacts`,
          { name: file.name, mediaType: file.type || 'application/octet-stream', declaredBytes: file.size },
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
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentArtifactRef>>(
          `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
          { retained, expectedVersion: artifact.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteArtifact(artifact: AgentArtifactRef): Promise<void> {
    await httpClient.delete(
      `/apps/${encodeURIComponent(artifact.appId)}/artifacts/${encodeURIComponent(artifact.id)}`,
      {
        params: { expectedVersion: artifact.version },
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
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<ArtifactCleanupResult>>(
          '/agent/files/cleanup/confirm',
          { confirmationId },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async attachArtifact(
    artifact: AgentArtifactRef,
    input: { targetAppId: string; threadId: string; runId?: string },
  ): Promise<{ artifact: AgentArtifactRef; crossApp: boolean }> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<{ artifact: AgentArtifactRef; crossApp: boolean }>>(
          `/agent/files/${encodeURIComponent(artifact.id)}/attach`,
          {
            targetAppId: input.targetAppId,
            threadId: input.threadId,
            ...(input.runId ? { runId: input.runId } : {}),
            role: 'input',
            expectedVersion: artifact.version,
          },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
