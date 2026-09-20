import path from 'node:path';
import type { ContextPlan } from '../../ai/context.types';
import { ContextService } from '../../ai/context.service';
import type { LanguageModelPort } from '../../ai/language-model.port';
import type {
  ProjectInstructionSnapshot,
  ProjectInstructionSourcePort,
} from '../../ai/project-instruction-source.port';
import { applyModelCapabilitySnapshot } from '../../ai/model-capability-resolver';
import { modelCacheLineageKey } from '../../ai/model-cache-hint';
import type {
  ModelFinishReason,
  ModelProviderContinuation,
  ModelRef,
  ModelCapabilitySnapshot,
  ProviderModelConfig,
  TokenUsage,
} from '../../ai/model.types';
import { ProviderService } from '../../ai/provider.service';
import { AGENT_DEFAULTS } from '../../agent-defaults';
import type { Scope } from '../../agent.types';
import type { CatalogToolSchema } from '../../capabilities/tool-catalog';
import type { ModelAttemptIdentity } from '../events/event.types';
import type { BackendSignal } from './agent-backend.port';
import { ModelCallLimiter } from './model-call-limiter';
import { waitForRetry } from './execution-errors';
import type { RunInputProjection, RunSnapshot } from '../runs/run.types';
import { logger } from '../../../../shared/logging/logger';

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
  finishReason: ModelFinishReason | null;
  providerContinuation?: ModelProviderContinuation;
  toolCalls: Map<number, ModelToolCall>;
  error?: unknown;
}

const latestInput = (run: RunSnapshot): { id: string; text: string; artifactRefs: string[] } => {
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
    const record = entry.payload as Record<string, unknown>;
    const text = record.text;
    const artifactRefs = Array.isArray(record.artifactRefs)
      ? record.artifactRefs.filter((value): value is string => typeof value === 'string')
      : [];
    if (typeof text === 'string') return { id: entry.id, text, artifactRefs };
  }
  return { id: '', text: '', artifactRefs: [] };
};

const retryAfterMilliseconds = (error: unknown): number => {
  if (!error || typeof error !== 'object' || !('retryAfterMs' in error)) return 0;
  const value = (error as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(30_000, Math.ceil(value)) : 0;
};

const PROJECT_WORK_ROOT = '/workspace/work';

const projectInstructionTargetDirectories = (snapshot: RunSnapshot): string[] => {
  const targets = new Set<string>([PROJECT_WORK_ROOT]);
  for (const entry of [...snapshot.recentEntries].reverse()) {
    if (targets.size >= 8) break;
    if (entry.kind !== 'assistant_message' || !entry.payload || Array.isArray(entry.payload) || typeof entry.payload !== 'object') {
      continue;
    }
    const rawCalls = (entry.payload as Record<string, unknown>).toolCalls;
    if (!Array.isArray(rawCalls)) continue;
    for (const rawCall of rawCalls) {
      if (!rawCall || Array.isArray(rawCall) || typeof rawCall !== 'object') continue;
      const call = rawCall as Record<string, unknown>;
      if (typeof call.name !== 'string' || typeof call.argumentsJson !== 'string') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.argumentsJson);
      } catch {
        continue;
      }
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') continue;
      const argumentsRecord = parsed as Record<string, unknown>;
      const addTarget = (rawValue: unknown, relativeBase: 'workspace' | 'work', fileTarget = false): void => {
        if (typeof rawValue !== 'string' || !rawValue.trim() || rawValue.length > 4096 || rawValue.includes('\0')) return;
        const raw = rawValue.trim();
        const base = relativeBase === 'workspace' ? '/workspace/' : PROJECT_WORK_ROOT + '/';
        const logical = path.posix.normalize(raw.startsWith('/') ? raw : base + raw);
        if (logical !== PROJECT_WORK_ROOT && !logical.startsWith(PROJECT_WORK_ROOT + '/')) return;
        targets.add(fileTarget ? path.posix.dirname(logical) : logical);
      };
      if (call.name === 'workspace_execute_argv') {
        addTarget(argumentsRecord.cwd ?? PROJECT_WORK_ROOT, 'workspace');
      } else if (call.name === 'workspace_read_file') {
        addTarget(argumentsRecord.path, 'work', true);
      } else if (call.name === 'workspace_search') {
        addTarget(argumentsRecord.path ?? PROJECT_WORK_ROOT, 'work');
      } else if (call.name === 'workspace_apply_patch' && Array.isArray(argumentsRecord.expectedFiles)) {
        for (const item of argumentsRecord.expectedFiles) {
          if (!item || Array.isArray(item) || typeof item !== 'object') continue;
          addTarget((item as Record<string, unknown>).path, 'work', true);
          if (targets.size >= 8) break;
        }
      }
      if (targets.size >= 8) break;
    }
  }
  return [...targets];
};

export class ModelStepRunner {
  constructor(
    private readonly providers: ProviderService,
    private readonly context: ContextService,
    private readonly modelPort: LanguageModelPort,
    private readonly modelCalls: ModelCallLimiter,
    private readonly projectInstructionSource: ProjectInstructionSourcePort | null = null,
  ) {}

  async prepare(
    snapshot: RunSnapshot,
    scope: Scope,
    tools: CatalogToolSchema[],
    inputProjections: Record<string, RunInputProjection>,
    collaborationContext?: string,
    route?: { model: ModelRef; capabilities?: ModelCapabilitySnapshot },
    runtimeId?: string,
  ): Promise<PreparedModelStep> {
    const modelRef = route?.model ?? snapshot.definition.model;
    const capabilitySnapshot = route?.capabilities ?? snapshot.definition.modelCapabilities;
    const provider = await this.providers.get(snapshot.userId, modelRef.providerId);
    if (!provider.enabled || provider.version !== modelRef.configurationVersion) {
      throw new Error('PROVIDER_CONFIGURATION_STALE');
    }
    const configuredModel = provider.models.find((candidate) => candidate.id === modelRef.modelId);
    if (!configuredModel) throw new Error('MODEL_NOT_FOUND');
    const model = applyModelCapabilitySnapshot(configuredModel, capabilitySnapshot);

    const reservedOutputTokens = Math.max(1, Math.min(model.maxOutputTokens, model.contextWindow - 1));

    const currentProjection = inputProjections[snapshot.id] ?? { ordered: [], pending: [] };
    const currentInput = currentProjection.ordered.at(-1) ?? latestInput(snapshot);
    let projectInstructions: ProjectInstructionSnapshot[] | undefined;
    if (this.projectInstructionSource && runtimeId && snapshot.definition.environment) {
      const targetDirectories = projectInstructionTargetDirectories(snapshot);
      try {
        const projection = await this.projectInstructionSource.load(
          scope,
          snapshot.id,
          runtimeId,
          targetDirectories,
        );
        projectInstructions = projection?.instructions;
        if (projection?.omitted.length) {
          logger.debug(
            {
              runId: snapshot.id,
              runtimeId,
              workspaceId: projection.workspaceId,
              generation: projection.generation,
              targetDirectories: projection.targetDirectories,
              omitted: projection.omitted,
            },
            'Agent project instructions were partially omitted by bounded Workspace projection',
          );
        }
      } catch (error) {
        logger.warn(
          {
            err: error,
            runId: snapshot.id,
            runtimeId,
            targetDirectories,
          },
          'Agent project instructions unavailable; continuing without repository project context',
        );
      }
    }
    const previousContext = snapshot.usage.context;
    const usageAnchor =
      previousContext?.source === 'provider' &&
      previousContext.heuristicInputTokens !== undefined &&
      previousContext.model?.providerId === modelRef.providerId &&
      previousContext.model.modelId === modelRef.modelId &&
      previousContext.model.configurationVersion === modelRef.configurationVersion
        ? {
            heuristicInputTokens: previousContext.heuristicInputTokens,
            providerInputTokens: previousContext.inputTokens,
          }
        : undefined;
    const contextPlan = await this.context.compose({
      scope,
      threadId: snapshot.threadId,
      runId: snapshot.id,
      ...(snapshot.definition.contextBoundary === undefined
        ? {}
        : { historyBoundary: snapshot.definition.contextBoundary }),
      currentInput: currentInput.text,
      ...(currentInput.id ? { currentInputEntryId: currentInput.id } : {}),
      ...(currentInput.artifactRefs.length ? { currentInputArtifactRefs: currentInput.artifactRefs } : {}),
      modelInputCapabilities: {
        supportsImageInput: model.supportsImageInput,
        supportsFileInput: model.supportsFileInput,
      },
      effectiveRunInputsByRun: Object.fromEntries(
        Object.entries(inputProjections).map(([runId, projection]) => [runId, projection.ordered]),
      ),
      ...(snapshot.goal.text ? { goal: snapshot.goal.text } : {}),
      ...(snapshot.plan.items.length
        ? {
            taskPlan: snapshot.plan.items
              .map((item) => `${item.status}: ${item.title}${item.detail ? ` — ${item.detail}` : ''}`)
              .join('\n'),
          }
        : {}),
      collaborationContext,
      ...(projectInstructions?.length ? { projectInstructions } : {}),
      modelContextWindow: model.contextWindow,
      maxContextTokens: model.contextWindow,
      reservedOutputTokens,
      compactionMode: snapshot.budget.contextCompactionMode,
      maxRecallItems: snapshot.budget.maxRecallItems,
      maxRecallBytes: snapshot.budget.maxRecallBytes,
      tools,
      ...(usageAnchor ? { usageAnchor } : {}),
    });
    return { model, contextPlan };
  }

  async *runAttempt(
    snapshot: RunSnapshot,
    contextPlan: ContextPlan,
    attemptIdentity: ModelAttemptIdentity,
    signal: AbortSignal,
    toolMode: 'auto' | 'none' = 'auto',
    route?: { model: ModelRef; capabilities?: ModelCapabilitySnapshot },
  ): AsyncGenerator<BackendSignal, ModelAttemptResult> {
    const modelRef = route?.model ?? snapshot.definition.model;
    const capabilitySnapshot = route?.capabilities ?? snapshot.definition.modelCapabilities;
    const toolCalls = new Map<number, ModelToolCall>();
    let text = '';
    let usage: TokenUsage | undefined;
    let finishReason: ModelFinishReason | null = null;
    let providerContinuation: ModelProviderContinuation | undefined;
    const startedAt = Date.now();
    const cacheLineageKey = modelCacheLineageKey({
      stablePrefixHash: contextPlan.stablePrefixHash,
      toolSchemaHash: contextPlan.toolSchemaHash,
      skillMetadataHash: contextPlan.skillMetadataHash,
    });

    try {
      logger.debug(
        {
          runId: snapshot.id,
          threadId: snapshot.threadId,
          providerId: modelRef.providerId,
          modelId: modelRef.modelId,
          reasoningEffort: snapshot.definition.reasoningEffort ?? null,
          toolMode,
          messageCount: contextPlan.messages.length,
          toolSchemaCount: contextPlan.toolSchemas.length,
          estimatedInputTokens: contextPlan.estimatedInputTokens,
          heuristicInputTokens: contextPlan.heuristicInputTokens,
          estimationSource: contextPlan.estimationSource,
          anchorDeltaTokens: contextPlan.anchorDeltaTokens,
          reservedOutputTokens: contextPlan.reservedOutputTokens,
          contextEpoch: contextPlan.contextEpoch,
          tokenDiagnostics: contextPlan.tokenDiagnostics,
        },
        'Agent model attempt started',
      );
      const releaseModelCall = await this.modelCalls.acquire(snapshot.userId, signal);
      try {
        for await (const event of this.modelPort.stream(
          {
            userId: snapshot.userId,
            providerId: modelRef.providerId,
            modelId: modelRef.modelId,
            configurationVersion: modelRef.configurationVersion,
            instructions: contextPlan.instructions,
            messages: contextPlan.messages,
            tools: contextPlan.toolSchemas,
            toolMode,
            cache: {
              scopeKey: `nexus:thread:${snapshot.threadId}`,
              affinityKey: `nexus:thread:${snapshot.threadId}`,
              lineageKey: cacheLineageKey,
            },
            ...(snapshot.definition.reasoningEffort === undefined
              ? {}
              : { reasoningEffort: snapshot.definition.reasoningEffort }),
            ...(capabilitySnapshot === undefined
              ? {}
              : { capabilitySnapshot }),
            maxOutputTokens: contextPlan.reservedOutputTokens,
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
              payload: { ...attemptIdentity, text: event.text },
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
                ...attemptIdentity,
                index: event.index,
                id: event.id ?? null,
                name: event.name ?? null,
                argumentsDelta: event.argumentsDelta ?? '',
              },
            };
          } else if (event.type === 'usage') {
            usage = event.usage;
          } else if (event.type === 'continuation') {
            providerContinuation = event.continuation;
          } else if (event.type === 'completed') {
            finishReason = event.finishReason;
          }
        }
      } finally {
        releaseModelCall();
      }
      logger.debug(
        {
          runId: snapshot.id,
          threadId: snapshot.threadId,
          providerId: modelRef.providerId,
          modelId: modelRef.modelId,
          configurationVersion: modelRef.configurationVersion,
          cacheLineageKey,
          contextEpoch: contextPlan.contextEpoch,
          stablePrefixHash: contextPlan.stablePrefixHash,
          toolSchemaHash: contextPlan.toolSchemaHash,
          skillMetadataHash: contextPlan.skillMetadataHash,
          messageDiagnostics: contextPlan.messageDiagnostics,
          toolMode,
          inputTokens: usage?.inputTokens ?? null,
          estimatedInputTokens: contextPlan.estimatedInputTokens,
          heuristicInputTokens: contextPlan.heuristicInputTokens,
          inputTokenEstimateError:
            usage?.inputTokens === undefined ? null : contextPlan.estimatedInputTokens - usage.inputTokens,
          heuristicInputTokenError:
            usage?.inputTokens === undefined ? null : contextPlan.heuristicInputTokens - usage.inputTokens,
          cachedInputTokens: usage?.cachedInputTokens ?? null,
          uncachedInputTokens:
            usage?.inputTokens === undefined || usage.cachedInputTokens === undefined
              ? null
              : Math.max(0, usage.inputTokens - usage.cachedInputTokens),
          cacheRate:
            usage?.inputTokens && usage.cachedInputTokens !== undefined
              ? usage.cachedInputTokens / usage.inputTokens
              : null,
          finishReason,
          textBytes: Buffer.byteLength(text, 'utf8'),
          toolCallCount: toolCalls.size,
          elapsedMs: Math.max(0, Date.now() - startedAt),
        },
        'Agent model cache diagnostics',
      );
      return { text, usage, finishReason, providerContinuation, toolCalls };
    } catch (error) {
      logger.debug(
        {
          runId: snapshot.id,
          threadId: snapshot.threadId,
          providerId: modelRef.providerId,
          modelId: modelRef.modelId,
          reasoningEffort: snapshot.definition.reasoningEffort ?? null,
          toolMode,
          textBytes: Buffer.byteLength(text, 'utf8'),
          toolCallCount: toolCalls.size,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          err: error,
        },
        'Agent model attempt failed',
      );
      return { text, usage, finishReason, providerContinuation, toolCalls, error };
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

  shouldFailover(error: unknown, signal: AbortSignal): boolean {
    return this.shouldRetry(error, 0, signal);
  }

  waitBeforeRetry(error: unknown, nextAttemptIndex: number, signal: AbortSignal): Promise<void> {
    const defaultDelayMs = (nextAttemptIndex === 2 ? 1_000 : 2_000) + Math.floor(Math.random() * 251);
    return waitForRetry(Math.max(defaultDelayMs, retryAfterMilliseconds(error)), signal);
  }
}
