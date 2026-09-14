import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { LanguageModelPort } from '../../../modules/agent/ai/language-model.port';
import type {
  DiscoveredProviderModel,
  ModelEvent,
  ModelRequest,
  TokenUsage,
} from '../../../modules/agent/ai/model.types';
import type { OutboundPolicyPort, ResolvedEndpoint } from '../../../modules/agent/ai/outbound-policy.port';
import type { ProviderRepositoryPort } from '../../../modules/agent/ai/provider.repository.port';
import type { ProviderSecretPort } from '../../../modules/agent/ai/provider-secret.port';

const MAX_SSE_FRAME_BYTES = 1024 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 32 * 1024;
const HEADERS_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_MODELS_RESPONSE_BYTES = 1024 * 1024;

const retryAfterMs = (value: string | string[] | undefined): number | undefined => {
  const scalar = Array.isArray(value) ? value[0] : value;
  if (!scalar) return undefined;
  const seconds = Number(scalar);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
  const date = Date.parse(scalar);
  if (!Number.isFinite(date)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, date - Date.now()));
};

const providerHttpError = (status: number, retryAfter: string | string[] | undefined): Error => {
  const error = new Error(`PROVIDER_HTTP_${status || 'ERROR'}`) as Error & { retryAfterMs?: number };
  const parsed = retryAfterMs(retryAfter);
  if (parsed !== undefined) error.retryAfterMs = parsed;
  return error;
};

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface OpenAiResponsesEvent {
  type?: string;
  delta?: string;
  output_index?: number;
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
  };
  response?: {
    status?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    };
  };
}

const providerUrl = (baseUrl: string, path: string): string => {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(path, base).toString();
};

const chatCompletionsUrl = (baseUrl: string): string => providerUrl(baseUrl, 'chat/completions');
const responsesUrl = (baseUrl: string): string => providerUrl(baseUrl, 'responses');

const usageFromChunk = (chunk: OpenAiChunk): TokenUsage | null => {
  if (!chunk.usage) return null;
  return {
    inputTokens: Math.max(0, Math.trunc(chunk.usage.prompt_tokens ?? 0)),
    outputTokens: Math.max(0, Math.trunc(chunk.usage.completion_tokens ?? 0)),
    cachedInputTokens: Math.max(0, Math.trunc(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0)),
  };
};

const usageFromResponsesEvent = (event: OpenAiResponsesEvent): TokenUsage | null => {
  const usage = event.response?.usage;
  if (!usage) return null;
  return {
    inputTokens: Math.max(0, Math.trunc(usage.input_tokens ?? 0)),
    outputTokens: Math.max(0, Math.trunc(usage.output_tokens ?? 0)),
    cachedInputTokens: Math.max(0, Math.trunc(usage.input_tokens_details?.cached_tokens ?? 0)),
  };
};

const modelInstructions = (request: ModelRequest): string[] => request.instructions ?? [];

const chatMessages = (request: ModelRequest): unknown[] => [
  ...modelInstructions(request).map((content) => ({ role: 'system', content })),
  ...request.messages.map((message) => ({
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: toolCall.argumentsJson },
          })),
        }
      : {}),
  })),
];

const responsesInput = (request: ModelRequest): unknown[] => {
  const input: unknown[] = [];
  for (const message of request.messages) {
    if (message.role === 'tool') {
      if (!message.toolCallId) throw new Error('MODEL_TOOL_RESULT_INVALID');
      input.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      continue;
    }

    const role = message.role === 'system' ? 'developer' : message.role;
    if (message.content) {
      input.push({
        type: 'message',
        role,
        content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: message.content }],
      });
    }

    for (const toolCall of message.toolCalls ?? []) {
      input.push({
        type: 'function_call',
        call_id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.argumentsJson,
      });
    }
  }
  return input;
};

export class OpenAiCompatibleAdapter implements LanguageModelPort {
  constructor(
    private readonly providers: ProviderRepositoryPort,
    private readonly secrets: ProviderSecretPort,
    private readonly outboundPolicy: OutboundPolicyPort,
  ) {}

  async discoverModels(userId: number, providerId: string, signal: AbortSignal): Promise<DiscoveredProviderModel[]> {
    const provider = await this.providers.get(userId, providerId);
    if (!provider) throw new Error('PROVIDER_UNAVAILABLE');
    const endpoint = await this.outboundPolicy.resolve(
      providerUrl(provider.baseUrl, 'models'),
      provider.privateHostExceptions,
    );
    const response = await this.secrets.withCredential(userId, provider.id, provider.credentialRevision, (credential) =>
      this.openJsonGet(endpoint, credential, signal),
    );
    response.socket?.setTimeout(IDLE_TIMEOUT_MS, () => response.destroy(new Error('PROVIDER_IDLE_TIMEOUT')));
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of response) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_MODELS_RESPONSE_BYTES) {
        response.destroy();
        throw new Error('PROVIDER_MODELS_RESPONSE_TOO_LARGE');
      }
      chunks.push(buffer);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('PROVIDER_MODELS_RESPONSE_INVALID');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload))
      throw new Error('PROVIDER_MODELS_RESPONSE_INVALID');
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

    if (provider.protocol === 'responses') {
      yield* this.streamResponsesInstructions(
        request,
        provider.baseUrl,
        provider.privateHostExceptions,
        provider.credentialRevision,
        signal,
      );
      return;
    }

    const endpoint = await this.outboundPolicy.resolve(
      chatCompletionsUrl(provider.baseUrl),
      provider.privateHostExceptions,
    );
    const payload = JSON.stringify({
      model: request.modelId,
      messages: chatMessages(request),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: request.maxOutputTokens,
      ...(request.reasoningEffort === undefined ? {} : { reasoning_effort: request.reasoningEffort }),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
              },
            })),
            tool_choice: request.toolMode === 'none' ? 'none' : 'auto',
            parallel_tool_calls: false,
          }
        : {}),
    });

    const response = await this.secrets.withCredential(
      request.userId,
      provider.id,
      provider.credentialRevision,
      (credential) => this.openStream(endpoint, payload, credential, signal, request.cache?.affinityKey),
    );

    const toolArgumentBytes = new Map<number, number>();
    const events: EventSourceMessage[] = [];
    const parser = createParser({
      maxBufferSize: MAX_SSE_FRAME_BYTES,
      onEvent: (event) => events.push(event),
      onError: (error) => {
        throw error;
      },
    });
    let completed = false;
    response.setEncoding('utf8');
    response.socket?.setTimeout(IDLE_TIMEOUT_MS, () => response.destroy(new Error('PROVIDER_IDLE_TIMEOUT')));

    for await (const rawChunk of response) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      try {
        parser.feed(String(rawChunk));
      } catch {
        throw new Error('PROVIDER_STREAM_INVALID');
      }

      while (events.length > 0) {
        const event = events.shift()!;
        const data = event.data;
        if (Buffer.byteLength(data, 'utf8') > MAX_SSE_FRAME_BYTES) throw new Error('PROVIDER_FRAME_TOO_LARGE');
        if (!data) continue;
        if (data === '[DONE]') {
          if (!completed) yield { type: 'completed', finishReason: null };
          return;
        }

        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(data) as OpenAiChunk;
        } catch {
          throw new Error('PROVIDER_STREAM_INVALID');
        }

        const choice = chunk.choices?.[0];
        const content = choice?.delta?.content;
        if (typeof content === 'string' && content) yield { type: 'message.delta', text: content };

        for (const toolCall of choice?.delta?.tool_calls ?? []) {
          const argumentsDelta = toolCall.function?.arguments;
          if (argumentsDelta) {
            const nextBytes = (toolArgumentBytes.get(toolCall.index) ?? 0) + Buffer.byteLength(argumentsDelta, 'utf8');
            if (nextBytes > MAX_TOOL_ARGUMENT_BYTES) throw new Error('MODEL_TOOL_ARGUMENTS_TOO_LARGE');
            toolArgumentBytes.set(toolCall.index, nextBytes);
          }
          yield {
            type: 'tool.delta',
            index: toolCall.index,
            ...(toolCall.id ? { id: toolCall.id } : {}),
            ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
            ...(argumentsDelta !== undefined ? { argumentsDelta } : {}),
          };
        }

        const usage = usageFromChunk(chunk);
        if (usage) yield { type: 'usage', usage };
        if (choice && choice.finish_reason !== undefined && choice.finish_reason !== null) {
          completed = true;
          yield { type: 'completed', finishReason: choice.finish_reason };
        }
      }
    }

    if (!completed) throw new Error('PROVIDER_STREAM_TRUNCATED');
  }

  private async *streamResponsesInstructions(
    request: ModelRequest,
    baseUrl: string,
    privateHostExceptions: readonly string[],
    credentialRevision: number,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const endpoint = await this.outboundPolicy.resolve(responsesUrl(baseUrl), privateHostExceptions);
    const instructions = modelInstructions(request).join('\n\n');
    const input = responsesInput(request);
    const payload = JSON.stringify({
      model: request.modelId,
      ...(instructions ? { instructions } : {}),
      input,
      stream: true,
      store: false,
      max_output_tokens: request.maxOutputTokens,
      ...(request.reasoningEffort === undefined ? {} : { reasoning: { effort: request.reasoningEffort } }),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: 'function',
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
            tool_choice: request.toolMode === 'none' ? 'none' : 'auto',
            parallel_tool_calls: false,
          }
        : {}),
    });

    const response = await this.secrets.withCredential(
      request.userId,
      request.providerId,
      credentialRevision,
      (credential) => this.openStream(endpoint, payload, credential, signal, request.cache?.affinityKey),
    );

    const events: EventSourceMessage[] = [];
    const parser = createParser({
      maxBufferSize: MAX_SSE_FRAME_BYTES,
      onEvent: (event) => events.push(event),
      onError: (error) => {
        throw error;
      },
    });
    const toolArgumentBytes = new Map<number, number>();
    let sawToolCall = false;
    let completed = false;
    response.setEncoding('utf8');
    response.socket?.setTimeout(IDLE_TIMEOUT_MS, () => response.destroy(new Error('PROVIDER_IDLE_TIMEOUT')));

    for await (const rawChunk of response) {
      if (signal.aborted) throw signal.reason ?? new Error('ABORTED');
      try {
        parser.feed(String(rawChunk));
      } catch {
        throw new Error('PROVIDER_STREAM_INVALID');
      }

      while (events.length > 0) {
        const event = events.shift()!;
        const data = event.data;
        if (Buffer.byteLength(data, 'utf8') > MAX_SSE_FRAME_BYTES) throw new Error('PROVIDER_FRAME_TOO_LARGE');
        if (!data || data === '[DONE]') continue;

        let chunk: OpenAiResponsesEvent;
        try {
          chunk = JSON.parse(data) as OpenAiResponsesEvent;
        } catch {
          throw new Error('PROVIDER_STREAM_INVALID');
        }

        if (chunk.type === 'response.output_text.delta' && typeof chunk.delta === 'string' && chunk.delta) {
          yield { type: 'message.delta', text: chunk.delta };
        } else if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call') {
          const index = Math.max(0, Math.trunc(chunk.output_index ?? 0));
          sawToolCall = true;
          yield {
            type: 'tool.delta',
            index,
            ...(chunk.item.call_id ? { id: chunk.item.call_id } : {}),
            ...(chunk.item.name ? { name: chunk.item.name } : {}),
          };
        } else if (chunk.type === 'response.function_call_arguments.delta' && typeof chunk.delta === 'string') {
          const index = Math.max(0, Math.trunc(chunk.output_index ?? 0));
          const nextBytes = (toolArgumentBytes.get(index) ?? 0) + Buffer.byteLength(chunk.delta, 'utf8');
          if (nextBytes > MAX_TOOL_ARGUMENT_BYTES) throw new Error('MODEL_TOOL_ARGUMENTS_TOO_LARGE');
          toolArgumentBytes.set(index, nextBytes);
          yield { type: 'tool.delta', index, argumentsDelta: chunk.delta };
        }

        const usage = usageFromResponsesEvent(chunk);
        if (usage) yield { type: 'usage', usage };
        if (chunk.type === 'response.completed') {
          completed = true;
          yield { type: 'completed', finishReason: sawToolCall ? 'tool_calls' : 'stop' };
          return;
        }
        if (chunk.type === 'response.failed' || chunk.type === 'response.incomplete') {
          throw new Error('PROVIDER_RESPONSE_INCOMPLETE');
        }
      }
    }

    if (!completed) throw new Error('PROVIDER_STREAM_TRUNCATED');
  }

  private openJsonGet(
    endpoint: ResolvedEndpoint,
    credential: string | null,
    signal: AbortSignal,
  ): Promise<IncomingMessage> {
    const address = endpoint.addresses[0];
    if (!address) return Promise.reject(new Error('PROVIDER_DNS_RESOLUTION_FAILED'));
    const url = new URL(endpoint.url);
    const headers: Record<string, string> = { Host: endpoint.authority, Accept: 'application/json' };
    if (credential) headers.Authorization = `Bearer ${credential}`;
    const options: RequestOptions = {
      protocol: endpoint.protocol,
      hostname: address,
      port: endpoint.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      family: net.isIP(address),
      signal,
      ...(endpoint.protocol === 'https:' && net.isIP(endpoint.hostname) === 0
        ? { servername: endpoint.tlsServerName }
        : {}),
    };
    return new Promise<IncomingMessage>((resolve, reject) => {
      const transport = endpoint.protocol === 'https:' ? https : http;
      const outgoing = transport.request(options, (response) => {
        clearTimeout(headersTimer);
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new Error('PROVIDER_REDIRECT_DENIED'));
          return;
        }
        if (status === 401 || status === 403) {
          response.resume();
          reject(new Error('PROVIDER_AUTH_FAILED'));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(providerHttpError(status, response.headers['retry-after']));
          return;
        }
        resolve(response);
      });
      const headersTimer = setTimeout(
        () => outgoing.destroy(new Error('PROVIDER_HEADERS_TIMEOUT')),
        HEADERS_TIMEOUT_MS,
      );
      outgoing.once('error', (error) => {
        clearTimeout(headersTimer);
        reject(error);
      });
      outgoing.end();
    });
  }

  private openStream(
    endpoint: ResolvedEndpoint,
    body: string,
    credential: string | null,
    signal: AbortSignal,
    affinityKey?: string,
  ): Promise<IncomingMessage> {
    const address = endpoint.addresses[0];
    if (!address) return Promise.reject(new Error('PROVIDER_DNS_RESOLUTION_FAILED'));
    const url = new URL(endpoint.url);
    const headers: Record<string, string | number> = {
      Host: endpoint.authority,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
    };
    if (credential) headers.Authorization = `Bearer ${credential}`;
    if (affinityKey) headers['session-id'] = affinityKey;
    const options: RequestOptions = {
      protocol: endpoint.protocol,
      hostname: address,
      port: endpoint.port,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers,
      family: net.isIP(address),
      signal,
      ...(endpoint.protocol === 'https:' && net.isIP(endpoint.hostname) === 0
        ? { servername: endpoint.tlsServerName }
        : {}),
    };

    return new Promise<IncomingMessage>((resolve, reject) => {
      const transport = endpoint.protocol === 'https:' ? https : http;
      const outgoing = transport.request(options, (response) => {
        clearTimeout(headersTimer);
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(new Error('PROVIDER_REDIRECT_DENIED'));
          return;
        }
        if (status === 401 || status === 403) {
          response.resume();
          reject(new Error('PROVIDER_AUTH_FAILED'));
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          reject(providerHttpError(status, response.headers['retry-after']));
          return;
        }
        resolve(response);
      });
      const headersTimer = setTimeout(
        () => outgoing.destroy(new Error('PROVIDER_HEADERS_TIMEOUT')),
        HEADERS_TIMEOUT_MS,
      );
      outgoing.once('error', (error) => {
        clearTimeout(headersTimer);
        reject(error);
      });
      outgoing.end(body);
    });
  }
}
