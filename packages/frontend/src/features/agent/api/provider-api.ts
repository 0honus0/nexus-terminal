import type {
  AgentDiscoveredProviderModelDto,
  AgentModelRegistryResolveQueryDto,
  AgentModelRegistryResolveResponseDto,
  AgentModelRegistryStatusDto,
  AgentModelRegistryUpdateRequestDto,
  AgentProviderCreateRequestDto,
  AgentProviderDeleteQueryDto,
  AgentProviderDeleteResponseDto,
  AgentProviderModelInputDto,
  AgentProviderPatchRequestDto,
  AgentProviderPatchFieldsDto,
  AgentProviderTestRequestDto,
  AgentProviderTestResponseDto,
  AgentProviderViewDto,
} from '@nexus-terminal/protocol/agent-providers';
import type { AgentEnvelopeDto } from './agent-api.types';
import { httpClient, mutationHeaders, unwrap } from './agent-api-common';

const providerModelInput = (model: AgentProviderModelInputDto): AgentProviderModelInputDto => ({
  id: model.id,
  contextWindow: model.contextWindow,
  maxOutputTokens: model.maxOutputTokens,
  supportsTools: model.supportsTools,
  ...(model.supportsImageInput === undefined ? {} : { supportsImageInput: model.supportsImageInput }),
  ...(model.supportsFileInput === undefined ? {} : { supportsFileInput: model.supportsFileInput }),
  ...(model.supportsPromptCacheKey === undefined ? {} : { supportsPromptCacheKey: model.supportsPromptCacheKey }),
  ...(model.reasoningEfforts === undefined ? {} : { reasoningEfforts: [...model.reasoningEfforts] }),
  ...(model.defaultReasoningEffort === undefined ? {} : { defaultReasoningEffort: model.defaultReasoningEffort }),
  ...(model.reasoningMandatory === undefined ? {} : { reasoningMandatory: model.reasoningMandatory }),
});

export const createProviderApi = () => ({
  async resolveModelRegistry(modelId: string): Promise<AgentModelRegistryResolveResponseDto> {
    const params: AgentModelRegistryResolveQueryDto = { modelId };
    return unwrap(
      (
        await httpClient.get<AgentEnvelopeDto<AgentModelRegistryResolveResponseDto>>('/agent/ai/model-registry/resolve', {
          params,
        })
      ).data,
    );
  },
  async modelRegistryStatus(): Promise<AgentModelRegistryStatusDto> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentModelRegistryStatusDto>>('/agent/ai/model-registry')).data);
  },
  async refreshModelRegistry(): Promise<AgentModelRegistryStatusDto> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentModelRegistryStatusDto>>(
          '/agent/ai/model-registry/refresh',
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async setModelRegistryAutoUpdate(autoUpdate: boolean): Promise<AgentModelRegistryStatusDto> {
    const input: AgentModelRegistryUpdateRequestDto = { autoUpdate };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentModelRegistryStatusDto>>(
          '/agent/ai/model-registry',
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async providers(): Promise<AgentProviderViewDto[]> {
    return unwrap((await httpClient.get<AgentEnvelopeDto<AgentProviderViewDto[]>>('/agent/ai/providers')).data);
  },
  async createProvider(input: AgentProviderCreateRequestDto): Promise<AgentProviderViewDto> {
    const request: AgentProviderCreateRequestDto = { ...input, models: input.models.map(providerModelInput) };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentProviderViewDto>>('/agent/ai/providers', request, {
          headers: await mutationHeaders(),
        })
      ).data,
    );
  },
  async updateProvider(
    provider: AgentProviderViewDto,
    input: AgentProviderPatchFieldsDto,
  ): Promise<AgentProviderViewDto> {
    const request: AgentProviderPatchRequestDto = {
      ...input,
      ...(input.models === undefined ? {} : { models: input.models.map(providerModelInput) }),
      expectedVersion: provider.version,
    };
    return unwrap(
      (
        await httpClient.patch<AgentEnvelopeDto<AgentProviderViewDto>>(
          `/agent/ai/providers/${encodeURIComponent(provider.id)}`,
          request,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async discoverProviderModels(providerId: string): Promise<AgentDiscoveredProviderModelDto[]> {
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentDiscoveredProviderModelDto[]>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}/discover-models`,
          {},
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async deleteProvider(providerId: string, expectedVersion: number): Promise<AgentProviderDeleteResponseDto> {
    const params: AgentProviderDeleteQueryDto = { expectedVersion };
    return unwrap(
      (
        await httpClient.delete<AgentEnvelopeDto<AgentProviderDeleteResponseDto>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}`,
          { params, headers: await mutationHeaders() },
        )
      ).data,
    );
  },
  async testProvider(providerId: string, modelId: string): Promise<AgentProviderTestResponseDto> {
    const input: AgentProviderTestRequestDto = { modelId };
    return unwrap(
      (
        await httpClient.post<AgentEnvelopeDto<AgentProviderTestResponseDto>>(
          `/agent/ai/providers/${encodeURIComponent(providerId)}/test`,
          input,
          { headers: await mutationHeaders() },
        )
      ).data,
    );
  },
});
