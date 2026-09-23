import type { DiscoveredProviderModel, ModelEvent, ModelRequest } from './model.types';

export interface LanguageModelPort {
  discoverModels(userId: number, providerId: string, signal: AbortSignal): Promise<DiscoveredProviderModel[]>;
  discoverEndpointModels(
    baseUrl: string,
    credential: string | undefined,
    signal: AbortSignal,
  ): Promise<DiscoveredProviderModel[]>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
