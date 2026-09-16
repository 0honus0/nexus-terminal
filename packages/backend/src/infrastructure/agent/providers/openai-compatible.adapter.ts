import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelPort } from '../../../modules/agent/ai/language-model.port';
import type {
  DiscoveredProviderModel,
  ModelEvent,
  ModelRequest,
  TokenUsage,
} from '../../../modules/agent/ai/model.types';
import type { ProviderRuntimeConfigPort } from '../../../modules/agent/ai/provider.repository.port';
import type { ProviderSecretPort } from '../../../modules/agent/ai/provider-secret.port';

const MAX_MODELS_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 32 * 1024;

const providerUrl = (baseUrl: string, path: string): string =>
  `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;

const providerHttpError = (status: number, retryAfter?: string | null): Error => {
  const error = new Error(`PROVIDER_HTTP_${status || 'ERROR'}`) as Error & { retryAfterMs?: number };
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) error.retryAfterMs = Math.min(30_000, Math.ceil(seconds * 1000));
  }
  return error;
};

const mapProviderError = (error: unknown, signal?: AbortSignal): Error => {
  if (signal?.aborted) {
    const reason = signal.reason;
    return reason instanceof Error ? reason : new Error('ABORTED');
  }
  if (error && typeof error === 'object') {
    const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined;
    if (statusCode === 401 || statusCode === 403) return new Error('PROVIDER_AUTH_FAILED');
    if (statusCode) {
      const headers =
        'responseHeaders' in error && error.responseHeaders && typeof error.responseHeaders === 'object'
          ? (error.responseHeaders as Record<string, string>)
          : undefined;
      return providerHttpError(statusCode, headers?.['retry-after']);
    }
  }
  return error instanceof Error ? error : new Error('PROVIDER_UNAVAILABLE');
};

const parseToolInput = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('MODEL_TOOL_ARGUMENTS_INVALID');
  }
};

const promptFor = (request: ModelRequest) => {
  const toolNames = new Map<string, string>();
  const prompt: Array<Record<string, unknown>> = [];
  for (const instruction of request.instructions ?? []) {
    prompt.push({ role: 'system', content: instruction });
  }
  for (const message of request.messages) {
    if (message.role === 'system') {
      prompt.push({ role: 'system', content: message.content });
      continue;
    }
    if (message.role === 'user') {
      prompt.push({ role: 'user', content: [{ type: 'text', text: message.content }] });
      continue;
    }
    if (message.role === 'assistant') {
      const content: Array<Record<string, unknown>> = [];
      if (message.content) content.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        toolNames.set(call.id, call.name);
        content.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: call.name,
          input: parseToolInput(call.argumentsJson),
        });
      }
      prompt.push({ role: 'assistant', content });
      continue;
    }
    if (!message.toolCallId) throw new Error('MODEL_TOOL_RESULT_INVALID');
    const toolName = toolNames.get(message.toolCallId);
    if (!toolName) throw new Error('MODEL_TOOL_RESULT_INVALID');
    prompt.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: message.toolCallId,
          toolName,
          output: { type: 'text', value: message.content },
        },
      ],
    });
  }
  return prompt;
};

const toolsFor = (request: ModelRequest): Array<Record<string, unknown>> | undefined =>
  request.tools?.map((definition) => ({
    type: 'function',
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
  }));

const usageFrom = (usage: {
  inputTokens: { total?: number; cacheRead?: number };
  outputTokens: { total?: number };
}): TokenUsage => ({
  inputTokens: Math.max(0, Math.trunc(usage.inputTokens.total ?? 0)),
  outputTokens: Math.max(0, Math.trunc(usage.outputTokens.total ?? 0)),
  cachedInputTokens: Math.max(0, Math.trunc(usage.inputTokens.cacheRead ?? 0)),
});

const finishReasonFrom = (reason: { unified: string; raw?: string }): string =>
  reason.raw ?? (reason.unified === 'tool-calls' ? 'tool_calls' : reason.unified);

export class OpenAiCompatibleAdapter implements LanguageModelPort {
  constructor(
    private readonly providers: ProviderRuntimeConfigPort,
    private readonly secrets: ProviderSecretPort,
  ) {}

  async discoverModels(userId: number, providerId: string, signal: AbortSignal): Promise<DiscoveredProviderModel[]> {
    const provider = await this.providers.get(userId, providerId);
    if (!provider || !provider.enabled) throw new Error('PROVIDER_UNAVAILABLE');
    return this.secrets.withCredential(userId, provider.id, provider.credentialRevision, async (credential) => {
      let response: Response;
      try {
        response = await fetch(providerUrl(provider.baseUrl, 'models'), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
          },
          signal,
        });
      } catch (error) {
        throw mapProviderError(error, signal);
      }
      if (response.status === 401 || response.status === 403) throw new Error('PROVIDER_AUTH_FAILED');
      if (!response.ok) throw providerHttpError(response.status, response.headers.get('retry-after'));
      const declaredLength = Number(response.headers.get('content-length') ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MODELS_RESPONSE_BYTES) {
        throw new Error('PROVIDER_MODELS_RESPONSE_TOO_LARGE');
      }
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > MAX_MODELS_RESPONSE_BYTES) {
        throw new Error('PROVIDER_MODELS_RESPONSE_TOO_LARGE');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('PROVIDER_MODELS_RESPONSE_INVALID');
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('PROVIDER_MODELS_RESPONSE_INVALID');
      }
      const data = (payload as { data?: unknown }).data;
      if (!Array.isArray(data)) throw new Error('PROVIDER_MODELS_RESPONSE_INVALID');
      const discovered = new Map<string, DiscoveredProviderModel>();
      for (const raw of data.slice(0, 1000)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const record = raw as { id?: unknown; owned_by?: unknown; created?: unknown };
        if (typeof record.id !== 'string' || !record.id.trim()) continue;
        const id = record.id.trim();
        discovered.set(id, {
          id,
          ...(typeof record.owned_by === 'string' && record.owned_by.trim() ? { ownedBy: record.owned_by.trim() } : {}),
          ...(Number.isSafeInteger(record.created) && (record.created as number) >= 0
            ? { createdAt: record.created as number }
            : {}),
        });
      }
      return [...discovered.values()].sort((left, right) => left.id.localeCompare(right.id));
    });
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const provider = await this.providers.get(request.userId, request.providerId);
    if (!provider || !provider.enabled) throw new Error('PROVIDER_UNAVAILABLE');
    const model = provider.models.find((candidate) => candidate.id === request.modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');
    if (request.tools?.length && !model.supportsTools) throw new Error('MODEL_CAPABILITY_UNSUPPORTED');
    if (request.maxOutputTokens < 1 || request.maxOutputTokens > model.maxOutputTokens) {
      throw new Error('MODEL_OUTPUT_LIMIT_EXCEEDED');
    }

    const result = await (async () => {
      try {
        return await this.secrets.withCredential(
          request.userId,
          provider.id,
          provider.credentialRevision,
          async (credential) => {
            const compatible = createOpenAICompatible({
              name: 'nexus',
              baseURL: provider.baseUrl,
              ...(credential ? { apiKey: credential } : {}),
              includeUsage: true,
              // NativeAgentBackend persists and executes one tool proposal at a time so
              // approvals, leases, budgets, and reconciliation stay deterministic. Ask
              // OpenAI-compatible providers to honor that execution contract instead of
              // accepting parallel calls and failing the whole Run afterwards.
              transformRequestBody: (body) =>
                Array.isArray(body.tools) && body.tools.length > 0
                  ? { ...body, parallel_tool_calls: false }
                  : body,
            });
            return compatible.chatModel(request.modelId).doStream({
              prompt: promptFor(request) as never,
              maxOutputTokens: request.maxOutputTokens,
              ...(request.reasoningEffort === undefined
                ? {}
                : { providerOptions: { openaiCompatible: { reasoningEffort: request.reasoningEffort } } }),
              ...(request.tools?.length
                ? {
                    tools: toolsFor(request) as never,
                    toolChoice: { type: request.toolMode === 'none' ? 'none' : 'auto' } as const,
                  }
                : {}),
              ...(request.cache?.affinityKey ? { headers: { 'session-id': request.cache.affinityKey } } : {}),
              abortSignal: signal,
            });
          },
        );
      } catch (error) {
        throw mapProviderError(error, signal);
      }
    })();

    const toolIndexes = new Map<string, number>();
    const toolBytes = new Map<string, number>();
    const sawToolDelta = new Set<string>();
    const indexFor = (id: string): number => {
      const existing = toolIndexes.get(id);
      if (existing !== undefined) return existing;
      const index = toolIndexes.size;
      toolIndexes.set(id, index);
      return index;
    };

    try {
      for await (const part of result.stream) {
        if (part.type === 'text-delta' && part.delta) {
          yield { type: 'message.delta', text: part.delta };
          continue;
        }
        if (part.type === 'tool-input-start') {
          yield { type: 'tool.delta', index: indexFor(part.id), id: part.id, name: part.toolName };
          continue;
        }
        if (part.type === 'tool-input-delta') {
          const nextBytes = (toolBytes.get(part.id) ?? 0) + Buffer.byteLength(part.delta, 'utf8');
          if (nextBytes > MAX_TOOL_ARGUMENT_BYTES) throw new Error('MODEL_TOOL_ARGUMENTS_TOO_LARGE');
          toolBytes.set(part.id, nextBytes);
          sawToolDelta.add(part.id);
          yield { type: 'tool.delta', index: indexFor(part.id), argumentsDelta: part.delta };
          continue;
        }
        if (part.type === 'tool-call') {
          const index = indexFor(part.toolCallId);
          if (!sawToolDelta.has(part.toolCallId)) {
            const argumentsJson = part.input;
            if (Buffer.byteLength(argumentsJson, 'utf8') > MAX_TOOL_ARGUMENT_BYTES) {
              throw new Error('MODEL_TOOL_ARGUMENTS_TOO_LARGE');
            }
            yield {
              type: 'tool.delta',
              index,
              id: part.toolCallId,
              name: part.toolName,
              argumentsDelta: argumentsJson,
            };
          }
          continue;
        }
        if (part.type === 'finish') {
          yield { type: 'usage', usage: usageFrom(part.usage) };
          yield { type: 'completed', finishReason: finishReasonFrom(part.finishReason) };
          return;
        }
        if (part.type === 'error') throw part.error;
      }
      throw new Error('PROVIDER_STREAM_TRUNCATED');
    } catch (error) {
      throw mapProviderError(error, signal);
    }
  }
}
