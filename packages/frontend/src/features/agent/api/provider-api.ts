import type { AgentEnvelope } from './agent-api.types';
import type {
  AgentDiscoveredProviderModel,
  AgentModelRegistryStatus,
  AgentProviderView,
  ModelCapabilityDefaults,
} from './agent-api';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';

export const createProviderApi = () => ({
  async resolveModelRegistry(modelId: string): Promise<{ modelId: string; defaults: ModelCapabilityDefaults | null }> {
    return unwrap(
      (
        await httpClient.get<AgentEnvelope<{ modelId: string; defaults: ModelCapabilityDefaults | null }>>(
          '/agent/ai/model-registry/resolve',
          { params: { modelId } },
        )
      ).data,
    );
  },
  async modelRegistryStatus(): Promise<AgentModelRegistryStatus> {
    return unwrap((await httpClient.get<AgentEnvelope<AgentModelRegistryStatus>>('/agent/ai/model-registry')).data);
  },
  async refreshModelRegistry(): Promise<AgentModelRegistryStatus> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentModelRegistryStatus>>(
          '/agent/ai/model-registry/refresh',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async setModelRegistryAutoUpdate(autoUpdate: boolean): Promise<AgentModelRegistryStatus> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentModelRegistryStatus>>(
          '/agent/ai/model-registry',
          { autoUpdate },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async providers(): Promise<AgentProviderView[]> {
    return unwrap((await httpClient.get<AgentEnvelope<AgentProviderView[]>>('/agent/ai/providers')).data);
  },
  async createProvider(input: Record<string, unknown>): Promise<AgentProviderView> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentProviderView>>('/agent/ai/providers', input, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async updateProvider(provider: AgentProviderView, input: Record<string, unknown>): Promise<AgentProviderView> {
    return unwrap(
      (
        await httpClient.patch<AgentEnvelope<AgentProviderView>>(
          `/agent/ai/providers/${encodeURIComponent(provider.id)}`,
          { ...input, expectedVersion: provider.version },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async discoverProviderModels(providerId: string): Promise<AgentDiscoveredProviderModel[]> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<AgentDiscoveredProviderModel[]>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}/discover-models`,
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteProvider(providerId: string, expectedVersion: number): Promise<{ deleted: boolean }> {
    return unwrap(
      (
        await httpClient.delete<AgentEnvelope<{ deleted: boolean }>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}?expectedVersion=${encodeURIComponent(expectedVersion)}`,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async testProvider(providerId: string, modelId: string): Promise<{ ok: boolean; latencyMs: number }> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelope<{ ok: boolean; latencyMs: number }>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}/test`,
          { modelId },
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
