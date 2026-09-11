import type { ProviderModelConfig, TokenUsage } from '../../ai/model.types';
import { calculateModelCostMicros } from '../../ai/provider.service';

export const estimateTokens = (value: string): number => Math.max(1, Math.ceil(Buffer.byteLength(value, 'utf8') / 4));

export const modelCost = (model: ProviderModelConfig, usage: TokenUsage): number =>
  calculateModelCostMicros(model, usage.inputTokens, usage.outputTokens) ?? 0;
