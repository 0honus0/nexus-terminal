import type { ModelContentPart, ModelMessage, ModelToolSchema } from './model.types';

export interface ContextUsageAnchor {
  heuristicInputTokens: number;
  providerInputTokens: number;
}

export interface AnchoredTokenEstimate {
  inputTokens: number;
  source: 'estimated' | 'anchored_estimate';
  anchorDeltaTokens: number;
}

export const estimateTokens = (value: string): number => Math.max(1, Math.ceil(Buffer.byteLength(value, 'utf8') / 4));

export const estimateModelContentPartTokens = (part: ModelContentPart): number => {
  const encodedBytes = Buffer.byteLength(part.dataBase64, 'ascii');
  const decodedBytes = Math.floor((encodedBytes * 3) / 4);
  return Math.max(64, Math.ceil(decodedBytes / 1024) * 64);
};

export const estimateModelMessageTokens = (message: ModelMessage): number => {
  let tokens = estimateTokens(message.content);
  for (const part of message.contentParts ?? []) tokens += estimateModelContentPartTokens(part);
  if (message.role === 'assistant' && message.toolCalls?.length) {
    tokens += estimateTokens(
      JSON.stringify(message.toolCalls.map((call) => ({ name: call.name, argumentsJson: call.argumentsJson }))),
    );
  }
  if (message.role === 'assistant' && message.providerContinuation) {
    tokens += estimateTokens(JSON.stringify(message.providerContinuation));
  }
  if (message.role === 'tool' && message.toolCallId) tokens += estimateTokens(message.toolCallId);
  return tokens;
};

export const estimateModelInputTokens = (
  instructions: readonly string[],
  messages: readonly ModelMessage[],
  tools: readonly ModelToolSchema[] = [],
): number => {
  const instructionTokens = instructions.reduce((total, instruction) => total + estimateTokens(instruction), 0);
  const messageTokens = messages.reduce((total, message) => total + estimateModelMessageTokens(message), 0);
  const toolSchemaTokens = tools.length > 0 ? estimateTokens(JSON.stringify(tools)) : 0;
  return instructionTokens + messageTokens + toolSchemaTokens;
};

export const anchoredInputTokenEstimate = (
  heuristicInputTokens: number,
  anchor?: ContextUsageAnchor,
): AnchoredTokenEstimate => {
  if (!anchor) {
    return { inputTokens: heuristicInputTokens, source: 'estimated', anchorDeltaTokens: 0 };
  }
  const anchorDeltaTokens = anchor.providerInputTokens - anchor.heuristicInputTokens;
  return {
    inputTokens: Math.max(1, heuristicInputTokens + anchorDeltaTokens),
    source: 'anchored_estimate',
    anchorDeltaTokens,
  };
};
