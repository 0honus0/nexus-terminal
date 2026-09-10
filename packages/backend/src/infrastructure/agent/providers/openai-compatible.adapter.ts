import http, { type IncomingMessage, type RequestOptions } from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { LanguageModelPort } from '../../../modules/agent/ai/language-model.port';
import type { ModelEvent, ModelRequest, TokenUsage } from '../../../modules/agent/ai/model.types';
import type { OutboundPolicyPort, ResolvedEndpoint } from '../../../modules/agent/ai/outbound-policy.port';
import type { ProviderRepositoryPort } from '../../../modules/agent/ai/provider.repository.port';
import type { ProviderSecretPort } from '../../../modules/agent/ai/provider-secret.port';

const MAX_SSE_FRAME_BYTES = 1024 * 1024;
const MAX_TOOL_ARGUMENT_BYTES = 32 * 1024;
const HEADERS_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_MS = 30_000;

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

const chatCompletionsUrl = (baseUrl: string): string => {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', base).toString();
};

const usageFromChunk = (chunk: OpenAiChunk): TokenUsage | null => {
  if (!chunk.usage) return null;
  return {
    inputTokens: Math.max(0, Math.trunc(chunk.usage.prompt_tokens ?? 0)),
    outputTokens: Math.max(0, Math.trunc(chunk.usage.completion_tokens ?? 0)),
    cachedInputTokens: Math.max(0, Math.trunc(chunk.usage.prompt_tokens_details?.cached_tokens ?? 0)),
  };
};

export class OpenAiCompatibleAdapter implements LanguageModelPort {
  constructor(
    private readonly providers: ProviderRepositoryPort,
    private readonly secrets: ProviderSecretPort,
    private readonly outboundPolicy: OutboundPolicyPort,
  ) {}

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const provider = await this.providers.get(request.userId, request.providerId);
    if (!provider || !provider.enabled) throw new Error('PROVIDER_UNAVAILABLE');
    const model = provider.models.find((candidate) => candidate.id === request.modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');
    if (request.tools?.length && !model.supportsTools) throw new Error('MODEL_CAPABILITY_UNSUPPORTED');
    if (request.maxOutputTokens < 1 || request.maxOutputTokens > model.maxOutputTokens) {
      throw new Error('MODEL_OUTPUT_LIMIT_EXCEEDED');
    }

    const endpoint = await this.outboundPolicy.resolve(
      chatCompletionsUrl(provider.baseUrl),
      provider.privateHostExceptions,
    );
    const payload = JSON.stringify({
      model: request.modelId,
      messages: request.messages.map((message) => ({
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
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: request.maxOutputTokens,
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
            parallel_tool_calls: false,
          }
        : {}),
    });

    const response = await this.secrets.withCredential(
      request.userId,
      provider.id,
      provider.credentialRevision,
      (credential) => this.openStream(endpoint, payload, credential, signal),
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

  private openStream(
    endpoint: ResolvedEndpoint,
    body: string,
    credential: string | null,
    signal: AbortSignal,
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
