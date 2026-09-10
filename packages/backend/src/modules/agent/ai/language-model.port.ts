import type { ModelEvent, ModelRequest } from './model.types';

export interface LanguageModelPort {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
