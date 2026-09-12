import type { DiscoveredProviderModel, ModelEvent, ModelRequest } from './model.types';

export interface LanguageModelPort {
  discoverModels(userId: number, providerId: string, signal: AbortSignal): Promise<DiscoveredProviderModel[]>;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
