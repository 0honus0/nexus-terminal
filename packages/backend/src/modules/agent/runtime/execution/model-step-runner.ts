import type { ContextPlan } from '../../ai/context.types';
import { ContextService } from '../../ai/context.service';
import type { LanguageModelPort } from '../../ai/language-model.port';
import type { ProviderModelConfig, TokenUsage } from '../../ai/model.types';
import { ProviderService } from '../../ai/provider.service';
import { AGENT_DEFAULTS } from '../../agent-defaults';
import type { Scope } from '../../agent.types';
import type { CatalogToolSchema } from '../../capabilities/tool-catalog';
import type { BackendSignal } from './agent-backend.port';
import { ModelCallLimiter } from './model-call-limiter';
import { waitForRetry } from './execution-errors';
import type { RunSnapshot } from '../runs/run.types';

const MAX_ASSISTANT_BYTES = 256 * 1024;

export interface PreparedModelStep {
  model: ProviderModelConfig;
  contextPlan: ContextPlan;
}

export interface ModelToolCall {
  id?: string;
  name?: string;
  argumentsJson: string;
}

export interface ModelAttemptResult {
  text: string;
  usage?: TokenUsage;
  finishReason: string | null;
  toolCalls: Map<number, ModelToolCall>;
  error?: unknown;
}

const latestInputText = (run: RunSnapshot): string => {
  for (let index = run.recentEntries.length - 1; index >= 0; index -= 1) {
    const entry = run.recentEntries[index]!;
    if (
      entry.kind !== 'user_input' ||
      !entry.payload ||
      typeof entry.payload !== 'object' ||
      Array.isArray(entry.payload)
    ) {
      continue;
    }
    const text = (entry.payload as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
  }
  return '';
};

const retryAfterMilliseconds = (error: unknown): number => {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return 0;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(30_000, Math.ceil(value)) : 0;
};

export class ModelStepRunner {
  constructor(
    private readonly providers: ProviderService,
    private readonly context: ContextService,
    private readonly modelPort: LanguageModelPort,
    private readonly modelCalls: ModelCallLimiter,
  ) {}

  async prepare(
    snapshot: RunSnapshot,
    scope: Scope,
    tools: CatalogToolSchema[],
    collaborationContext?: string,
  ): Promise<PreparedModelStep> {
    const provider = await this.providers.get(snapshot.userId, snapshot.definition.model.providerId);
    if (!provider.enabled || provider.version !== snapshot.definition.model.configurationVersion) {
      throw new Error('PROVIDER_CONFIGURATION_STALE');
    }
    const model = provider.models.find((candidate) => candidate.id === snapshot.definition.model.modelId);
    if (!model) throw new Error('MODEL_NOT_FOUND');

    const contextPlan = await this.context.compose({
      scope,
      threadId: snapshot.threadId,
      runId: snapshot.id,
      ...(snapshot.definition.contextBoundary === undefined
        ? {}
        : { historyBoundary: snapshot.definition.contextBoundary }),
      currentInput: latestInputText(snapshot),
      collaborationContext,
      modelContextWindow: model.contextWindow,
      maxContextTokens: snapshot.budget.maxContextTokens,
      reservedOutputTokens: snapshot.budget.maxOutputTokens,
      maxRecallItems: snapshot.budget.maxRecallItems,
      maxRecallBytes: snapshot.budget.maxRecallBytes,
      tools,
    });
    return { model, contextPlan };
  }

  async *runAttempt(
    snapshot: RunSnapshot,
    contextPlan: ContextPlan,
    signal: AbortSignal,
  ): AsyncGenerator<BackendSignal, ModelAttemptResult> {
    const toolCalls = new Map<number, ModelToolCall>();
    let text = '';
    let usage: TokenUsage | undefined;
    let finishReason: string | null = null;

    try {
      const releaseModelCall = await this.modelCalls.acquire(snapshot.userId, signal);
      try {
        for await (const event of this.modelPort.stream(
          {
            userId: snapshot.userId,
            providerId: snapshot.definition.model.providerId,
            modelId: snapshot.definition.model.modelId,
            messages: contextPlan.messages,
            tools: contextPlan.toolSchemas,
            maxOutputTokens: snapshot.budget.maxOutputTokens,
          },
          signal,
        )) {
          if (event.type === 'message.delta') {
            text += event.text;
            if (Buffer.byteLength(text, 'utf8') > MAX_ASSISTANT_BYTES) throw new Error('MODEL_RESPONSE_TOO_LARGE');
            yield {
              type: 'transient',
              runId: snapshot.id,
              eventType: 'message.delta',
              payload: { text: event.text },
            };
          } else if (event.type === 'tool.delta') {
            const current = toolCalls.get(event.index) ?? { argumentsJson: '' };
            if (event.id) current.id = event.id;
            if (event.name) current.name = event.name;
            if (event.argumentsDelta) current.argumentsJson += event.argumentsDelta;
            toolCalls.set(event.index, current);
            yield {
              type: 'transient',
              runId: snapshot.id,
              eventType: 'tool.delta',
              payload: {
                index: event.index,
                id: event.id ?? null,
                name: event.name ?? null,
                argumentsDelta: event.argumentsDelta ?? '',
              },
            };
          } else if (event.type === 'usage') {
            usage = event.usage;
          } else if (event.type === 'completed') {
            finishReason = event.finishReason;
          }
        }
      } finally {
        releaseModelCall();
      }
      return { text, usage, finishReason, toolCalls };
    } catch (error) {
      return { text, usage, finishReason, toolCalls, error };
    }
  }

  shouldRetry(error: unknown, currentAttemptIndex: number, signal: AbortSignal): boolean {
    if (signal.aborted || currentAttemptIndex > AGENT_DEFAULTS.modelRetryCount) return false;
    const message = error instanceof Error ? error.message : '';
    const code =
      error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    return (
      /^PROVIDER_HTTP_(429|502|503|504)$/.test(message) ||
      [
        'PROVIDER_UNAVAILABLE',
        'PROVIDER_DNS_RESOLUTION_FAILED',
        'PROVIDER_HEADERS_TIMEOUT',
        'PROVIDER_IDLE_TIMEOUT',
        'PROVIDER_STREAM_TRUNCATED',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EAI_AGAIN',
      ].includes(message) ||
      ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)
    );
  }

  waitBeforeRetry(error: unknown, nextAttemptIndex: number, signal: AbortSignal): Promise<void> {
    const defaultDelayMs = (nextAttemptIndex === 2 ? 1_000 : 2_000) + Math.floor(Math.random() * 251);
    return waitForRetry(Math.max(defaultDelayMs, retryAfterMilliseconds(error)), signal);
  }
}
