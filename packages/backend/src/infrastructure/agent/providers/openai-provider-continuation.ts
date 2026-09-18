import {
  continuationMatchesRoute,
  decodeModelProviderContinuation,
} from '../../../modules/agent/ai/model-continuation';
import type {
  ModelProviderContinuation,
  ModelRequest,
  OpenAiCompatibleProtocol,
} from '../../../modules/agent/ai/model.types';

export const OPENAI_RESPONSES_CONTINUATION_FORMAT = 'openai.responses.stateless.v1';
const MAX_CONTINUATION_PARTS = 512;

export type OpenAiResponsesContinuationPart =
  | { type: 'reasoning'; itemId: string; reasoningEncryptedContent: string }
  | { type: 'tool-call'; toolCallId: string; itemId: string };

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const openAiProviderMetadata = (value: unknown): Record<string, unknown> | null => {
  const record = recordOf(value);
  return record ? recordOf(record.openai) : null;
};

export const decodeOpenAiResponsesContinuation = (
  continuation: ModelProviderContinuation,
  request: ModelRequest,
  protocol: OpenAiCompatibleProtocol,
): OpenAiResponsesContinuationPart[] => {
  if (
    !continuationMatchesRoute(continuation, {
      providerId: request.providerId,
      modelId: request.modelId,
      configurationVersion: request.configurationVersion,
      protocol,
    })
  ) {
    return [];
  }
  if (continuation.format !== OPENAI_RESPONSES_CONTINUATION_FORMAT) {
    throw new Error('MODEL_PROVIDER_CONTINUATION_UNSUPPORTED');
  }
  const data = recordOf(continuation.data);
  if (!data || !Array.isArray(data.parts) || data.parts.length > MAX_CONTINUATION_PARTS) {
    throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
  }
  return data.parts.map((raw): OpenAiResponsesContinuationPart => {
    const part = recordOf(raw);
    if (!part) throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
    if (
      part.type === 'reasoning' &&
      typeof part.itemId === 'string' &&
      part.itemId &&
      typeof part.reasoningEncryptedContent === 'string' &&
      part.reasoningEncryptedContent
    ) {
      return {
        type: 'reasoning',
        itemId: part.itemId,
        reasoningEncryptedContent: part.reasoningEncryptedContent,
      };
    }
    if (
      part.type === 'tool-call' &&
      typeof part.toolCallId === 'string' &&
      part.toolCallId &&
      typeof part.itemId === 'string' &&
      part.itemId
    ) {
      return { type: 'tool-call', toolCallId: part.toolCallId, itemId: part.itemId };
    }
    throw new Error('MODEL_PROVIDER_CONTINUATION_INVALID');
  });
};

export class OpenAiResponsesContinuationCollector {
  private readonly reasoning = new Map<string, string>();
  private readonly tools = new Map<string, string>();

  recordReasoning(providerMetadata: unknown): void {
    const metadata = openAiProviderMetadata(providerMetadata);
    const itemId = metadata?.itemId;
    const encrypted = metadata?.reasoningEncryptedContent;
    if (typeof itemId === 'string' && itemId && typeof encrypted === 'string' && encrypted) {
      this.reasoning.set(itemId, encrypted);
    }
  }

  recordToolCall(toolCallId: string, providerMetadata: unknown): void {
    const metadata = openAiProviderMetadata(providerMetadata);
    const itemId = metadata?.itemId;
    if (typeof itemId === 'string' && itemId) this.tools.set(toolCallId, itemId);
  }

  build(route: {
    providerId: string;
    modelId: string;
    configurationVersion: number;
    protocol: OpenAiCompatibleProtocol;
  }): ModelProviderContinuation | undefined {
    if (route.protocol !== 'responses' || (this.reasoning.size === 0 && this.tools.size === 0)) return undefined;
    return decodeModelProviderContinuation({
      schemaVersion: 1,
      providerId: route.providerId,
      modelId: route.modelId,
      configurationVersion: route.configurationVersion,
      protocol: route.protocol,
      format: OPENAI_RESPONSES_CONTINUATION_FORMAT,
      data: {
        parts: [
          ...[...this.reasoning.entries()].map(([itemId, reasoningEncryptedContent]) => ({
            type: 'reasoning',
            itemId,
            reasoningEncryptedContent,
          })),
          ...[...this.tools.entries()].map(([toolCallId, itemId]) => ({
            type: 'tool-call',
            toolCallId,
            itemId,
          })),
        ],
      },
    });
  }
}
