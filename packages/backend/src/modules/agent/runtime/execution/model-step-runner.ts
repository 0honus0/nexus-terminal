import type { ClockPort } from '../../agent.types';
import { runtimeProgressContext, activeExecutionSeconds } from './runtime-progress';
import type { AgentModelAttemptIdentityDto } from '@nexus-terminal/protocol/agent-events';
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
import type { Scope } from '../../agent.types';
import type { CatalogToolSchema } from '../../capabilities/tool-catalog';
import type { BackendSignal } from './agent-backend.port';
import { ModelCallLimiter } from './model-call-limiter';
import { estimateTokens } from '../../ai/model-accounting';
import {
	CHECKPOINT_INSTRUCTIONS,
	completeCheckpoint,
	type ContextCheckpointGeneration,
} from '../../ai/context-checkpoint.service';
import { shouldRetryModel, waitBeforeModelRetry } from './model-retry-policy';
import { resolveModelContextBudget } from '../runs/run-budget-policy';
import type { RunInputProjection, RunSnapshot } from '../runs/run.types';
import { logger } from '../../../../shared/logging/logger';
import { MAX_TOOL_CALLS_PER_MODEL_STEP } from './root-model-execution-common';

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

const projectInstructionTargetDirectories = (snapshot: RunSnapshot): string[] => {
	const targets = new Set<string>();
	for (const entry of [...snapshot.recentEntries].reverse()) {
		if (targets.size >= 8) break;
		if (
			entry.kind !== 'assistant_message' ||
			!entry.payload ||
			Array.isArray(entry.payload) ||
			typeof entry.payload !== 'object'
		)
			continue;
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
			const args = parsed as Record<string, unknown>;
			if (args.target !== 'ssh' || typeof args.id !== 'string' || !/^[1-9][0-9]*$/.test(args.id)) continue;

			const addDirectory = (value: unknown, useParent = false): void => {
				if (typeof value !== 'string' || !value.startsWith('/') || value.length > 4096 || value.includes('\0'))
					return;
				const resolved = path.posix.normalize(value);
				targets.add(`ssh:${args.id}:${useParent ? path.posix.dirname(resolved) : resolved}`);
			};

			if (call.name === 'shell_execute') addDirectory(args.cwd);
			if (call.name === 'file_list' || call.name === 'file_search') addDirectory(args.path);
			if (['file_read', 'file_write', 'file_delete', 'file_move'].includes(call.name)) {
				addDirectory(args.path, true);
				if (call.name === 'file_move') addDirectory(args.destinationPath, true);
			}
			if (call.name === 'file_patch' && Array.isArray(args.expectedFiles)) {
				for (const item of args.expectedFiles) {
					if (!item || Array.isArray(item) || typeof item !== 'object') continue;
					addDirectory((item as Record<string, unknown>).path, true);
					if (targets.size >= 8) break;
				}
			}
			if (targets.size >= 8) break;
		}
	}
	return [...targets].slice(0, 8);
};

export class ModelStepRunner {
	async compact(
		snapshot: RunSnapshot,
		generation: ContextCheckpointGeneration,
		signal: AbortSignal,
		route: { model: ModelRef; capabilities?: ModelCapabilitySnapshot },
	) {
		let text = '';
		let usage: TokenUsage | undefined;
		let finishReason: ModelFinishReason | null = null;
		let error: unknown;
		const remainingSeconds = Math.max(
			1,
			snapshot.budget.activeExecutionCeilingSeconds -
				activeExecutionSeconds(snapshot, this.clock.nowUnixSeconds()),
		);
		const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(remainingSeconds * 1000)]);
		let checkpoint;
		let requested = false;
		try {
			const release = await this.modelCalls.acquire(snapshot.userId, requestSignal);
			try {
				requested = true;
				for await (const event of this.modelPort.stream(
					{
						userId: snapshot.userId,
						providerId: route.model.providerId,
						modelId: route.model.modelId,
						configurationVersion: route.model.configurationVersion,
						capabilitySnapshot: route.capabilities,
						instructions: [CHECKPOINT_INSTRUCTIONS],
						messages: generation.messages,
						tools: [],
						toolMode: 'none',
						maxOutputTokens: Math.min(
							generation.maxOutputTokens,
							route.capabilities?.maxOutputTokens ?? generation.maxOutputTokens,
						),
					},
					requestSignal,
				)) {
					if (event.type === 'message.delta') {
						text += event.text;
						if (Buffer.byteLength(text) > MAX_ASSISTANT_BYTES)
							throw new Error('CONTEXT_COMPACTION_TOO_LARGE');
					} else if (event.type === 'usage') usage = event.usage;
					else if (event.type === 'completed') finishReason = event.finishReason;
					else if (event.type === 'tool.delta') throw new Error('CONTEXT_COMPACTION_TOOL_UNEXPECTED');
				}
			} finally {
				release();
			}
			requestSignal.throwIfAborted();
			if (finishReason !== 'stop') throw new Error('CONTEXT_COMPACTION_INCOMPLETE');
			checkpoint = completeCheckpoint(generation, text);
		} catch (caught) {
			error = caught;
		}
		return {
			checkpoint,
			error,
			estimatedUsage: usage === undefined,
			usage: usage ?? {
				inputTokens: requested ? generation.estimatedInputTokens : 0,
				outputTokens: estimateTokens(text),
				cachedInputTokens: 0,
			},
		};
	}

	constructor(
		private readonly providers: ProviderService,
		private readonly context: ContextService,
		private readonly modelPort: LanguageModelPort,
		private readonly modelCalls: ModelCallLimiter,
		private readonly clock: ClockPort,
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
		options?: { rawHistoryFallback?: boolean },
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
		const contextBudget = resolveModelContextBudget(
			snapshot.budget.contextPolicy,
			model.contextWindow,
			reservedOutputTokens,
		);

		const currentProjection = inputProjections[snapshot.id] ?? { ordered: [], pending: [] };
		const currentInput = currentProjection.ordered.at(-1) ?? latestInput(snapshot);
		let projectInstructions: ProjectInstructionSnapshot[] | undefined;
		if (this.projectInstructionSource && runtimeId) {
			const targetDirectories = projectInstructionTargetDirectories(snapshot);
			try {
				const projection = await this.projectInstructionSource.load(
					scope,
					snapshot.id,
					runtimeId,
					targetDirectories,
					undefined,
					{
						...scope,
						runId: snapshot.id,
						threadId: snapshot.threadId,
						agentRuntimeId: runtimeId,
						actor: { kind: 'agent', ...scope, runId: snapshot.id, agentRuntimeId: runtimeId },
						connectionIds: snapshot.definition.connectionIds,
						stepId: 'project-context',
						signal: AbortSignal.timeout(10_000),
						deadlineAt: Math.floor(Date.now() / 1000) + 10,
						maxOutputBytes: 64 * 1024,
						inputRevision: snapshot.inputRevision,
					},
				);
				projectInstructions = projection?.instructions;
				if (projection?.omitted.length) {
					logger.debug(
						{
							runId: snapshot.id,
							runtimeId,
							targetDirectories: projection.targetDirectories,
							omitted: projection.omitted,
						},
						'Agent SSH project instructions were partially omitted by bounded projection',
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
			pendingInputSequences: currentProjection.pending.map((entry) => entry.sequence),
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
			runScopeContext: [
				runtimeProgressContext(snapshot, this.clock.nowUnixSeconds()),
				`Selected SSH connection IDs for this Run: ${
					snapshot.definition.connectionIds.length > 0 ? snapshot.definition.connectionIds.join(', ') : 'none'
				}.`,
				'Only the selected SSH connection IDs above are valid Machine execution targets for this Run.',
				'Historical Tool results from earlier Runs are evidence only; they do not grant or imply current target selection.',
			].join('\n'),
			collaborationContext,
			...(projectInstructions?.length ? { projectInstructions } : {}),
			modelContextWindow: model.contextWindow,
			maxContextTokens: contextBudget.effectiveInputTokens,
			softContextTokens: contextBudget.softPressureTokens,
			reservedOutputTokens,
			compactionMode: snapshot.budget.contextCompactionMode,
			maxRecallItems: snapshot.budget.maxRecallItems,
			maxRecallBytes: snapshot.budget.maxRecallBytes,
			tools,
			...(usageAnchor ? { usageAnchor } : {}),
			...(options?.rawHistoryFallback ? { rawHistoryFallback: true } : {}),
		});
		return { model, contextPlan };
	}

	async *runAttempt(
		snapshot: RunSnapshot,
		contextPlan: ContextPlan,
		attemptIdentity: AgentModelAttemptIdentityDto,
		signal: AbortSignal,
		toolMode: 'auto' | 'none' = 'auto',
		route?: { model: ModelRef; capabilities?: ModelCapabilitySnapshot },
	): AsyncGenerator<BackendSignal, ModelAttemptResult> {
		const remainingSeconds = Math.max(
			1,
			snapshot.budget.activeExecutionCeilingSeconds -
				activeExecutionSeconds(snapshot, this.clock.nowUnixSeconds()),
		);
		signal = AbortSignal.any([signal, AbortSignal.timeout(remainingSeconds * 1000)]);
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
						...(capabilitySnapshot === undefined ? {} : { capabilitySnapshot }),
						maxOutputTokens: contextPlan.reservedOutputTokens,
					},
					signal,
				)) {
					if (event.type === 'message.delta') {
						text += event.text;
						if (Buffer.byteLength(text, 'utf8') > MAX_ASSISTANT_BYTES)
							throw new Error('MODEL_RESPONSE_TOO_LARGE');
						yield {
							type: 'transient',
							runId: snapshot.id,
							eventType: 'message.delta',
							payload: { ...attemptIdentity, text: event.text },
						};
					} else if (event.type === 'tool.delta') {
						if (!toolCalls.has(event.index) && toolCalls.size >= MAX_TOOL_CALLS_PER_MODEL_STEP) {
							throw new Error('MODEL_TOOL_CALL_BATCH_TOO_LARGE');
						}
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
		return shouldRetryModel(error, currentAttemptIndex, signal);
	}

	shouldFailover(error: unknown, signal: AbortSignal): boolean {
		return this.shouldRetry(error, 0, signal);
	}

	waitBeforeRetry(error: unknown, nextAttemptIndex: number, signal: AbortSignal): Promise<void> {
		return waitBeforeModelRetry(error, nextAttemptIndex, signal);
	}
}
