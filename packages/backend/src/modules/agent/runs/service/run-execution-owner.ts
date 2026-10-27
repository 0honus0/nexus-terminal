import pRetry from 'p-retry';
import { ModelCapacityBusy, isAgentStorageStatementFailure } from '../../agent-failure.js';
import { TitleSession } from '../../scope/service/title-session.js';
import type { TitleModel } from '../../scope/model/title-model.js';
import { CompactionSession } from '../../context/service/compaction-session.js';
import type { CompactionModel } from '../../context/model/compaction-model.js';
import { runFailureCode } from '../run-failure-rules.js';
import type { ContextLimits } from '../../context/model/context-types.js';
import type { ToolDefinition } from '../../tools/model/tool-types.js';
import type { ProviderImageService } from '../../providers/service/provider-image-service.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic, withDiagnosticContext } from '../../../../platform/logging/diagnostic-log.js';
import type { OperationsEvents } from '../../../operations/public.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { CheckpointService } from '../../context/service/checkpoint-service.js';
import type { RunCollaborationService } from './run-collaboration-service.js';
import type { ContextService } from '../../context/service/context-service.js';
import type { ContextHistoryService } from '../../context/service/context-history-service.js';
import type { RunModel } from '../model/run-model.js';
import type { RunStepModel } from '../model/run-step-model.js';
import type { RunModelStream } from '../model/run-model-stream.js';
import type {
	RunStepMutation,
	RunModelStep,
	RunExecutionCommand,
	RunRevocationRequest,
	RunFrozenInput,
	RunModelDelta,
} from '../model/run-types.js';
import type { ToolService } from '../../tools/service/tool-service.js';
import { AGENT_RUN_STEP_MAX_COUNT } from '@nexus-terminal/shared/agent/runs/values';
import type { ProviderModel } from '../../providers/model/provider-model.js';
import type { ProviderRecord } from '../../providers/model/provider-types.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	ProviderRequestFailure,
	isAgentDrainFailure,
	aggregateToolFailures,
} from '../../agent-failure.js';

const MAX_RUN_ATTEMPTS = 8;
const MAX_PENDING_RUN_WRITES = 64;

interface ModelStepOutcome {
	definitions: ToolDefinition[];
	step: RunModelStep;
	text: string;
	terminal: Extract<RunModelDelta, { kind: 'finished' }>;
}

function hasCleanupFailure(error: unknown): boolean {
	return (
		error instanceof ToolCleanupFailure ||
		(error instanceof ProviderRequestFailure && error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED') ||
		(error instanceof AggregateError && error.errors.some(hasCleanupFailure)) ||
		(error instanceof Error && error.cause !== undefined && hasCleanupFailure(error.cause))
	);
}

interface RunningTask {
	parentId: string | null;
	userId: number;
	appId: string;
	providerId: string;
	controller: AbortController;
	settled: Promise<void>;
	cleanupFailed: boolean;
}

/**
 * The single in-process owner of newly created Root and Child model attempts.
 * Only fresh committed creates enter; persisted unknown/dispatched attempts are NEVER
 * scheduled on restart or replay. Every attempt consumes governed frozen
 * configuration and rechecks live authority before dispatch.
 */
export class RunExecutionOwner {
	private readonly tasks = new Map<string, RunningTask>();
	private readonly admittedWrites = new Set<Promise<unknown>>();
	private pendingCreates = 0;
	private readonly failures: unknown[] = [];
	private excessFailures = 0;
	private closing = false;
	private closePromise: Promise<void> | null = null;

	getActiveRunCount(): number {
		return this.tasks.size;
	}

	getPendingWriteCount(): number {
		return this.admittedWrites.size;
	}

	constructor(
		private readonly runs: RunModel,
		private readonly steps: RunStepModel,
		private readonly stream: RunModelStream,
		private readonly providers: ProviderModel,
		private readonly tools: ToolService,
		private readonly collaboration: RunCollaborationService,
		private readonly contexts: ContextHistoryService,
		private readonly checkpoints: CheckpointService,
		private readonly settings: ExecutionService,
		private readonly events: OperationsEvents,
		private readonly images: ProviderImageService,
		private readonly compactions: CompactionModel,
		private readonly titles: TitleModel,
		private readonly logger?: Logger,
	) {}

	private recordFailure(error: unknown): void {
		logDiagnostic(this.logger, 'error', 'AGENT_BACKGROUND_FAILED', {}, error);
		if (this.failures.length < 32) {
			this.failures.push(error);
		} else {
			this.excessFailures++;
		}
	}

	/**
	 * Admit state-changing requests before their first await. Close must drain
	 * those SQLite operations as well as model tasks before shutting the DB.
	 */
	async admitWrite<T>(work: () => Promise<T>): Promise<T> {
		if (this.closing || this.admittedWrites.size >= MAX_PENDING_RUN_WRITES) {
			throw new AgentFailure('provider_unavailable');
		}
		const pending = Promise.resolve().then(work);
		this.admittedWrites.add(pending);
		try {
			return await pending;
		} catch (error) {
			if (isAgentDrainFailure(error)) {
				this.recordFailure(error);
			}
			throw error;
		} finally {
			this.admittedWrites.delete(pending);
		}
	}

	/** Own queued creates; check execution capacity only when storage admits a new Run, after replay lookup. */
	async admitCreate<T>(work: (admit: () => void) => Promise<T>, maxRuns: number): Promise<T> {
		this.pendingCreates++;
		try {
			return await this.admitWrite(() =>
				work(() => {
					if (this.tasks.size + this.pendingCreates - 1 >= Math.min(maxRuns, MAX_RUN_ATTEMPTS)) {
						throw new AgentFailure('provider_unavailable');
					}
				}),
			);
		} finally {
			this.pendingCreates--;
		}
	}

	occupiedChildIds(scope: { userId: number; appId: string; runId: string }): string[] {
		return [...this.tasks.entries()]
			.filter(
				([, task]) =>
					task.parentId === scope.runId && task.userId === scope.userId && task.appId === scope.appId,
			)
			.map(([id]) => id);
	}

	occupiedSlots(): number {
		return this.tasks.size + this.pendingCreates;
	}

	/** Call exactly once after a newly committed create, never for an idempotent replay. */
	start(command: RunExecutionCommand, parentId: string | null = null): boolean {
		if (this.closing || this.tasks.has(command.runId)) {
			return false;
		}
		const controller = new AbortController();
		const deadline = setTimeout(
			() => {
				this.runs.rememberFailure(command.userId, command.appId, command.runId, {
					code: 'execution_limit_exceeded',
					toolName: null,
				});
				controller.abort(new Error('Root Run attempt deadline exceeded'));
			},
			Math.max(1, command.deadlineAt - Date.now()),
		);
		const task: RunningTask = {
			parentId,
			userId: command.userId,
			appId: command.appId,
			providerId: command.providerId,
			controller,
			settled: Promise.resolve(),
			cleanupFailed: false,
		};
		this.tasks.set(command.runId, task);
		logDiagnostic(this.logger, 'info', 'AGENT_RUN_STARTED', {
			runId: command.runId,
			parentId,
			providerId: command.providerId,
		});
		// Own the rejection until shutdown; a failed/unknown durable commit is
		// never replayed by the in-memory task manager.
		task.settled = this.runs
			.ownExecutionTask(() =>
				withDiagnosticContext({ runId: command.runId }, () => this.executeOwned(command, controller.signal)),
			)
			.catch((error: unknown) => {
				logDiagnostic(this.logger, 'error', 'AGENT_RUN_TASK_FAILED', { runId: command.runId }, error);
				task.cleanupFailed = hasCleanupFailure(error);
				this.recordFailure(error);
				throw error;
			})
			.finally(() => {
				clearTimeout(deadline);
				logDiagnostic(this.logger, task.cleanupFailed ? 'error' : 'info', 'AGENT_RUN_TASK_SETTLED', {
					runId: command.runId,
					aborted: controller.signal.aborted,
					cleanupFailed: task.cleanupFailed,
				});
				if (!task.cleanupFailed && this.tasks.get(command.runId) === task) {
					this.tasks.delete(command.runId);
				}
			});
		// A cleanup failure retains its occupied slot; observing rejection is not release evidence.
		void task.settled.catch(() => undefined);
		return true;
	}

	async waitChildren(ids: string[]): Promise<void> {
		const results = await Promise.allSettled(
			ids.flatMap((id) => {
				const task = this.tasks.get(id);
				return task ? [task.settled] : [];
			}),
		);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw aggregateToolFailures(failures, 'Child task cleanup failed');
		}
	}

	async drainChildren(scope: { userId: number; appId: string; runId: string }): Promise<void> {
		const children = [...this.tasks.entries()].filter(
			([, task]) => task.parentId === scope.runId && task.userId === scope.userId && task.appId === scope.appId,
		);
		for (const [, task] of children) {
			task.controller.abort();
		}
		await this.waitChildren(children.map(([id]) => id));
	}

	/** Cancel after the authoritative DB fence; never wait before fencing. */
	abort(userId: number, appId: string, runId: string): void {
		const task = this.tasks.get(runId);
		if (task?.userId === userId && task.appId === appId) {
			task.controller.abort();
		}
		for (const child of this.tasks.values()) {
			if (child.parentId === runId && child.userId === userId && child.appId === appId) {
				child.controller.abort();
			}
		}
	}

	/** A policy mutation has already fenced storage. Recheck each exact task before aborting, so newly admitted tasks are not stopped by an older mutation's continuation. */
	async abortRevoked(request: RunRevocationRequest): Promise<void> {
		const tasks = [...this.tasks.entries()].filter(
			([, task]) =>
				(request.userId === null || task.userId === request.userId) &&
				(request.appId === null || task.appId === request.appId),
		);
		const results = await Promise.allSettled(
			tasks.map(async ([id, task]) => {
				try {
					const current = request.uncertain ? null : await this.runs.get(task.userId, task.appId, id);
					if (this.tasks.get(id) === task && (current === null || current.status === 'cancelled')) {
						task.controller.abort();
					}
				} catch (error) {
					if (this.tasks.get(id) === task) {
						task.controller.abort();
					}
					throw error;
				}
			}),
		);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			const failure = new AggregateError(failures, 'Run revocation confirmation failed');
			this.recordFailure(failure);
			throw new AgentFailure('operation_unknown', { cause: failure });
		}
	}

	/** Await the exact App tasks already fenced by a committed lifecycle change. */
	async drainRevokedApp(userId: number, appId: string): Promise<void> {
		const tasks = [...this.tasks.values()].filter((task) => task.userId === userId && task.appId === appId);
		const [revocation, ...results] = await Promise.allSettled([
			this.abortRevoked({ userId, appId, uncertain: false }),
			...tasks.map((task) => task.settled),
		]);
		const revocationFailures = revocation.status === 'rejected' ? [revocation.reason] : [];
		if (tasks.some((task) => task.cleanupFailed)) {
			throw new ToolCleanupFailure({
				cause: new AggregateError(
					[
						...revocationFailures,
						...results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
					],
					'App Run cleanup unconfirmed',
				),
			});
		}
		const failures = results.flatMap((result) =>
			result.status === 'rejected' && isAgentDrainFailure(result.reason) ? [result.reason] : [],
		);
		if (failures.length || revocationFailures.length) {
			throw new AgentFailure('operation_unknown', {
				cause: new AggregateError([...revocationFailures, ...failures], 'App Run drain unconfirmed'),
			});
		}
	}

	/** Only the owning Provider's committed configuration change revokes these attempts. */
	abortProvider(userId: number, providerId: string): void {
		for (const task of this.tasks.values()) {
			if (task.userId === userId && task.providerId === providerId) {
				task.controller.abort();
			}
		}
	}

	quiesce(): void {
		if (this.closing) {
			return;
		}
		this.closing = true;
		for (const task of this.tasks.values()) {
			task.controller.abort();
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			// Requests admitted before quiesce can still be writing their Run.
			// No new admission or model task can enter after closing=true.
			await Promise.allSettled([...this.admittedWrites]);
			await Promise.allSettled([...this.tasks.values()].map((task) => task.settled));
			if (this.failures.length || this.excessFailures) {
				throw new AggregateError(
					this.excessFailures
						? [...this.failures, new Error(`${this.excessFailures} additional Root Run failures`)]
						: this.failures,
					'Root Run shutdown failed',
				);
			}
		});
		this.quiesce();
		return this.closePromise;
	}

	private mutation(command: RunExecutionCommand, step: RunModelStep): RunStepMutation {
		return {
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			stepIndex: step.stepIndex,
			expectedRunVersion: step.runVersion,
			expectedRevision: step.revision,
			requestHash: step.requestHash,
			creationHash: command.requestHash,
			now: Date.now(),
		};
	}

	private async executeOwned(command: RunExecutionCommand, signal: AbortSignal): Promise<void> {
		let failure: unknown = null;
		try {
			await this.execute(command, signal);
		} catch (error) {
			failure = error;
			if (isAgentStorageStatementFailure(error)) {
				this.runs.rememberFailure(command.userId, command.appId, command.runId, {
					code: runFailureCode(error),
					toolName: null,
				});
				try {
					// This CAS can only fail a pending Run with no persisted model
					// attempt. It cannot overwrite an unknown or committed dispatch.
					await this.failUnstarted(command);
				} catch (settlement) {
					failure = new AggregateError(
						[error, settlement],
						'Initial storage failure and Run settlement failed',
					);
					throw failure;
				}
			}
			throw error;
		} finally {
			try {
				const scope = { userId: command.userId, appId: command.appId, runId: command.runId };
				const results = await Promise.allSettled([
					Promise.resolve().then(() => this.collaboration.drain(scope)),
					Promise.resolve().then(() => this.tools.drainRun(scope)),
				]);
				const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				if (failures.length) {
					throw new AggregateError(failures, 'Run resources failed to drain');
				}
				const state = await this.runs.get(command.userId, command.appId, command.runId);
				if (state && ['completed', 'failed', 'cancelled', 'unknown'].includes(state.status)) {
					await this.events.publish({
						key: 'run:' + state.id + ':' + state.version,
						event:
							state.status === 'completed'
								? 'AGENT_RUN_COMPLETED'
								: state.status === 'failed'
									? 'AGENT_RUN_FAILED'
									: state.status === 'unknown'
										? 'AGENT_ATTENTION_REQUIRED'
										: 'AGENT_RUN_INTERRUPTED',
						userId: command.userId,
						subjectId: state.id,
						sourceIp: null,
						route: null,
						statusCode: null,
					});
				}
			} catch (cleanup) {
				if (failure !== null) {
					throw new AggregateError([failure, cleanup], 'Root and Jobs failed');
				}
				throw cleanup;
			}
		}
	}

	failUnstarted(command: RunExecutionCommand): Promise<boolean> {
		return this.steps.failUnstarted({
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			expectedVersion: command.version,
			creationHash: command.requestHash,
			now: Date.now(),
		});
	}

	private async rejectAdmission(
		command: RunExecutionCommand,
		previous: RunModelStep | null,
		error: unknown,
		uncertain: boolean,
	): Promise<void> {
		this.runs.rememberFailure(command.userId, command.appId, command.runId, {
			code: runFailureCode(error),
			toolName: null,
		});
		logDiagnostic(
			this.logger,
			'warn',
			'AGENT_RUN_ADMISSION_REJECTED',
			{
				runId: command.runId,
				stepIndex: (previous?.stepIndex ?? 0) + 1,
				uncertain,
				failureCode: runFailureCode(error),
			},
			error,
		);
		if (hasCleanupFailure(error) || (isAgentDrainFailure(error) && !isAgentStorageStatementFailure(error))) {
			throw error;
		}
		try {
			if (previous) {
				await this.steps.endRoot(this.mutation(command, previous), uncertain);
			} else {
				await this.steps.failUnstarted({
					userId: command.userId,
					appId: command.appId,
					runId: command.runId,
					expectedVersion: command.version,
					creationHash: command.requestHash,
					now: Date.now(),
				});
			}
		} catch (settlement) {
			throw new AggregateError([error, settlement], 'Model admission rejection and Run settlement failed');
		}
		if (isAgentDrainFailure(error)) {
			throw error;
		}
	}

	private async execute(command: RunExecutionCommand, signal: AbortSignal): Promise<void> {
		const scope = { userId: command.userId, appId: command.appId, runId: command.runId };
		const participant = await this.collaboration.prepare(scope, signal);
		if (!participant || signal.aborted) {
			await this.collaboration.abandon(scope);
			await this.failUnstarted(command);
			return;
		}
		const frozen = await this.runs.frozen(command.userId, command.appId, command.runId);
		// This is an actual persisted-policy boundary, not a default-allow or
		// temporary approval flag. No task, budget, or Provider probe grants it.
		if (!frozen || frozen.executionPolicy !== 'governed' || signal.aborted) {
			await this.failUnstarted(command);
			return;
		}

		let context: ContextService | null;
		try {
			context = await this.contexts.open(
				{
					userId: command.userId,
					appId: command.appId,
					runId: command.runId,
					expectedVersion: command.version,
					includeThread: frozen.protocol !== 'images' && participant.parentId === null,
				},
				command.prompt,
			);
		} catch (error) {
			await this.rejectAdmission(command, null, error, signal.aborted);
			return;
		}
		if (context === null || signal.aborted) {
			await this.failUnstarted(command);
			return;
		}

		const compaction = new CompactionSession(
			this.compactions,
			this.stream,
			this.providers,
			this.settings,
			command,
			frozen,
			signal,
			this.logger,
		);
		const title = new TitleSession(
			this.titles,
			this.stream,
			this.providers,
			this.settings,
			command,
			frozen,
			signal,
			this.logger,
		);
		let executionFailure: unknown = null;
		try {
			if (participant.parentId === null) {
				await title.prepare();
			}
			await this.executeRounds(command, frozen, context, participant.maxRequests, compaction, title, signal);
		} catch (error) {
			executionFailure = error;
			throw error;
		} finally {
			try {
				const results = await Promise.allSettled([compaction.close(), title.close()]);
				const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				if (errors.length) {
					throw new AggregateError(errors, 'Run auxiliary cleanup failed');
				}
			} catch (cleanup) {
				if (executionFailure !== null && executionFailure !== cleanup) {
					throw new AggregateError([executionFailure, cleanup], 'Run and context compaction cleanup failed');
				}
				throw cleanup;
			}
		}
	}

	private async executeRounds(
		command: RunExecutionCommand,
		frozen: RunFrozenInput,
		context: ContextService,
		maxRequests: number,
		compaction: CompactionSession,
		title: TitleSession,
		signal: AbortSignal,
	): Promise<void> {
		let version = command.version;
		let previous: RunModelStep | null = null;
		for (let stepIndex = 1; stepIndex <= Math.min(AGENT_RUN_STEP_MAX_COUNT, maxRequests); stepIndex++) {
			let outcome: ModelStepOutcome | null;
			try {
				outcome = await this.executeStep(
					command,
					frozen,
					context,
					stepIndex,
					version,
					signal,
					compaction,
					title,
				);
			} catch (error) {
				// A definite local rejection between rounds must settle the Root.
				// Unknown storage commits remain untouched for durable recovery.
				await this.rejectAdmission(command, previous, error, signal.aborted);
				return;
			}
			if (!outcome) {
				if (previous) {
					await this.steps.endRoot(this.mutation(command, previous), signal.aborted);
				} else {
					await this.failUnstarted(command);
				}
				return;
			}
			if (outcome.terminal.finishReason === 'stop') {
				return;
			}
			const { step, terminal } = outcome;
			try {
				const results: { providerCallId: string; content: string }[] = [];
				for (const proposal of terminal.proposals) {
					compaction.assertHealthy();
					let content: string;
					try {
						content = await this.tools.execute(
							{
								userId: command.userId,
								appId: command.appId,
								runId: command.runId,
								modelStepIndex: step.stepIndex,
							},
							proposal,
							signal,
						);
					} catch (error) {
						this.runs.rememberFailure(command.userId, command.appId, command.runId, {
							code: runFailureCode(error, true),
							toolName: proposal.toolName,
						});
						logDiagnostic(
							this.logger,
							'warn',
							'AGENT_RUN_TOOL_FAILED',
							{
								runId: command.runId,
								stepIndex: step.stepIndex,
								toolName: proposal.toolName,
								failureCode: runFailureCode(error, true),
								aborted: signal.aborted,
							},
							error,
						);
						throw error;
					}
					results.push({ providerCallId: proposal.providerCallId, content });
				}
				if (
					signal.aborted ||
					Date.now() >= command.deadlineAt ||
					stepIndex === Math.min(AGENT_RUN_STEP_MAX_COUNT, maxRequests)
				) {
					throw new AgentFailure('limit_exceeded');
				}
				context.appendExchange({
					content: outcome.text,
					proposals: terminal.proposals,
					reasoning: terminal.reasoning,
					results,
				});
				context.recordUsage(
					step.inputTokens,
					step.outputTokens,
					outcome.definitions,
					terminal.proposals.length,
				);
				await this.checkpoints.apply(
					{ userId: command.userId, appId: command.appId, runId: command.runId },
					stepIndex,
					context,
				);
			} catch (error) {
				this.runs.rememberFailure(command.userId, command.appId, command.runId, {
					code: runFailureCode(error),
					toolName: null,
				});
				logDiagnostic(
					this.logger,
					'warn',
					'AGENT_RUN_EXCHANGE_FAILED',
					{
						runId: command.runId,
						stepIndex: step.stepIndex,
						aborted: signal.aborted,
						failureCode: runFailureCode(error),
					},
					error,
				);
				if (isAgentDrainFailure(error) && !(error instanceof ToolExecutionUnknown)) {
					throw error;
				}
				try {
					await this.steps.endRoot(this.mutation(command, step), signal.aborted);
				} catch (settlement) {
					throw new AggregateError([error, settlement], 'Tool failure and Root settlement failed');
				}
				if (error instanceof ToolExecutionUnknown) {
					throw error;
				}
				return;
			}
			version = step.runVersion;
			previous = step;
		}
	}

	private async *imageEvents(
		command: RunExecutionCommand,
		frozen: RunFrozenInput,
		step: RunModelStep,
		signal: AbortSignal,
	): AsyncIterable<RunModelDelta> {
		const validate = async () => {
			const current = await this.steps.get(command.userId, command.appId, command.runId, step.stepIndex);
			if (
				signal.aborted ||
				current?.state !== 'dispatched' ||
				current.revision !== step.revision ||
				current.requestHash !== step.requestHash
			) {
				throw new AgentFailure('version_conflict');
			}
		};

		const result = await this.images.generate(
			{
				kind: 'model',
				userId: command.userId,
				appId: command.appId,
				runId: command.runId,
				stepIndex: step.stepIndex,
				requestHash: step.requestHash,
			},
			{
				providerId: frozen.providerId,
				configurationVersion: frozen.providerVersion,
				modelId: frozen.modelId,
				prompt: command.prompt,
			},
			signal,
			validate,
		);
		yield {
			kind: 'text',
			content: '![Generated image](' + result.previewUrl + ')\n\n[Download image](' + result.downloadUrl + ')',
		};
		yield { kind: 'finished', finishReason: 'stop' };
	}

	private contextLimits(frozen: RunFrozenInput): ContextLimits {
		if (frozen.protocol === 'images') {
			return { reservedOutputTokens: 1 };
		}
		const contextWindow = frozen.capabilities.contextWindow;
		const maxOutputTokens = frozen.capabilities.maxOutputTokens;
		if (maxOutputTokens === undefined) {
			throw new AgentFailure('provider_unavailable');
		}
		return {
			contextWindow,
			reservedOutputTokens: maxOutputTokens,
		};
	}

	private async executeStep(
		command: RunExecutionCommand,
		frozen: RunFrozenInput,
		context: ContextService,
		stepIndex: number,
		version: number,
		signal: AbortSignal,
		compaction: CompactionSession,
		title: TitleSession,
	): Promise<ModelStepOutcome | null> {
		if (signal.aborted) {
			return null;
		}
		const participant = await this.collaboration.participant({
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
		});
		const isImage = frozen.protocol === 'images';
		if (isImage && Buffer.byteLength(command.prompt, 'utf8') > 16000) {
			throw new AgentFailure('invalid_input');
		}
		const definitions =
			!isImage && frozen.capabilities.supportsTools ? this.collaboration.definitions(participant) : [];
		const limits = this.contextLimits(frozen);
		let snapshot = context.snapshot(definitions, limits);
		if (!isImage) {
			await compaction.prepare(context, snapshot, context.estimatedTokens(definitions), stepIndex, version);
			snapshot = context.snapshot(definitions, limits);
		}
		const messages = snapshot.messages;
		const estimatedTokens = context.estimatedTokens(definitions) + limits.reservedOutputTokens;
		if (signal.aborted) {
			return null;
		}
		const reserved = await this.steps.reserve(
			{
				userId: command.userId,
				appId: command.appId,
				runId: command.runId,
				stepIndex,
				expectedRunVersion: version,
				requestHash: this.stream.requestHash(frozen, messages, definitions),
				creationHash: command.requestHash,
				now: Date.now(),
			},
			snapshot,
			estimatedTokens,
			(settings, usage) => this.settings.admitReservation(settings, usage, estimatedTokens),
		);
		if (reserved.status !== 'ok') {
			if (reserved.status === 'stale') {
				throw new AgentFailure('version_conflict');
			}
			return null;
		}

		const failUndispatched = async (): Promise<void> => {
			// Reservation committed but no remote dispatch did. Cancellation
			// may already have fenced this CAS; never change its result.
			await this.steps.finish(this.mutation(command, reserved.step), {
				state: 'failed',
				failureCode: 'DISPATCH_NOT_STARTED',
			});
		};

		if (signal.aborted) {
			await failUndispatched();
			return null;
		}
		let credential: string | null = null;
		let provider: ProviderRecord | null = null;
		try {
			const candidate = await this.providers.get(command.userId, frozen.providerId);
			if (
				candidate &&
				candidate.enabled &&
				candidate.version === frozen.providerVersion &&
				candidate.credentialRevision === frozen.credentialRevision
			) {
				credential = await this.providers.credential(candidate);
				await this.providers.guardCurrent(candidate);
				provider = candidate;
			}
		} catch (error) {
			this.runs.rememberFailure(command.userId, command.appId, command.runId, {
				code: runFailureCode(error),
				toolName: null,
			});
			logDiagnostic(
				this.logger,
				'warn',
				'AGENT_MODEL_DISPATCH_REJECTED',
				{ runId: command.runId, stepIndex, failureCode: runFailureCode(error), aborted: signal.aborted },
				error,
			);
			// Credential reads and Provider checks happen strictly before the
			// dispatch intent. The settlement is OUTSIDE the provider try block
			// on the normal rejection path, so a failed CAS cannot be retried by
			// inadvertently catching its own failure.
			try {
				await failUndispatched();
			} catch (settlementError) {
				throw new AggregateError([error, settlementError], 'Provider check and undispatched settlement failed');
			}
			if (!isAgentDrainFailure(error)) {
				return null;
			}
			throw error;
		}
		if (!provider || signal.aborted) {
			if (!provider && !signal.aborted) {
				this.runs.rememberFailure(command.userId, command.appId, command.runId, {
					code: 'configuration_changed',
					toolName: null,
				});
				logDiagnostic(this.logger, 'warn', 'AGENT_MODEL_DISPATCH_REJECTED', {
					runId: command.runId,
					stepIndex,
					failureCode: 'configuration_changed',
					aborted: false,
				});
			}
			await failUndispatched();
			return null;
		}
		// Do not pass the signal to pRetry: its post-attempt abort check could hide
		// an already committed dispatch. Cancellation is checked before each CAS;
		// a successful dispatch must reach the normal settlement path below.
		const dispatched = await pRetry(
			() => {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				return this.steps.dispatch(this.mutation(command, reserved.step), (settings, usage) =>
					this.settings.admitDispatch(settings, usage),
				);
			},
			{
				retries: Infinity,
				minTimeout: 100,
				maxTimeout: 250,
				factor: 1.5,

				shouldRetry: ({ error }) => error instanceof ModelCapacityBusy && !signal.aborted,
			},
		).catch(async (error: unknown) => {
			// Only definite non-dispatch failures may settle this reservation.
			// A failed/unknown storage commit must retain its original evidence.
			if (!isAgentDrainFailure(error) || isAgentStorageStatementFailure(error)) {
				try {
					await failUndispatched();
				} catch (settlement) {
					throw new AggregateError([error, settlement], 'Dispatch refusal and reservation settlement failed');
				}
			}
			throw error;
		});
		// A thrown DB commit or a non-ok CAS is NOT permission to re-dispatch.
		if (dispatched.status !== 'ok') {
			// The storage returned a definite non-dispatch. Another writer may
			// already have fenced the step; the original CAS then returns stale.
			// In contrast, a thrown commit_unknown above is never settled here.
			await failUndispatched();
			return null;
		}
		logDiagnostic(this.logger, 'info', 'AGENT_MODEL_DISPATCH_COMMITTED', { runId: command.runId, stepIndex });
		if (stepIndex === 1) {
			title.start();
		}
		let current = dispatched.step;
		let text = '';
		let resourceCleanupFailure: ProviderRequestFailure | null = null;
		let drainingResources = false;

		try {
			// Dispatch awaited SQLite; reread revocation before opening the network.
			await this.providers.guardCurrent(provider);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			logDiagnostic(this.logger, 'debug', 'AGENT_MODEL_STREAM_STARTED', { runId: command.runId, stepIndex });
			const events = isImage
				? this.imageEvents(command, frozen, current, signal)
				: this.stream.stream(frozen, messages, definitions, credential, signal);
			for await (const event of events) {
				// Also fence configuration changes made by a different server process.
				await this.providers.guardCurrent(provider);
				if (signal.aborted) {
					break; // Wait for iterator.return() and transport cleanup.
				}
				if (event.kind === 'finished') {
					const released = await this.steps.releaseCapacity(this.mutation(command, current));
					if (released.status !== 'ok') {
						return null;
					}
					drainingResources = true;
					await title.close();
					if (event.finishReason === 'stop') {
						await compaction.close();
						await this.collaboration.finishChildren({
							userId: command.userId,
							appId: command.appId,
							runId: command.runId,
						});
						await this.tools.drainRun({
							userId: command.userId,
							appId: command.appId,
							runId: command.runId,
						});
					}
					drainingResources = false;
					if (signal.aborted || Date.now() >= command.deadlineAt) {
						break;
					}
					const result = await this.steps.finish(
						this.mutation(command, current),
						event.finishReason === 'stop'
							? { state: 'completed', finishReason: 'stop', outputText: text }
							: { state: 'completed', finishReason: 'tool_calls', proposals: event.proposals },
					);
					if (result.status === 'step_conflict') {
						// The model finished, but a tool effect is still unconfirmed.
						// Close the stream before settling the aggregate as unknown.
						break;
					}
					if (result.status !== 'ok') {
						return null;
					}
					logDiagnostic(this.logger, 'info', 'AGENT_MODEL_STEP_COMPLETED', {
						runId: command.runId,
						stepIndex,
						finishReason: event.finishReason,
						textBytes: Buffer.byteLength(text),
					});
					if (event.finishReason === 'tool_calls') {
						compaction.precompute(
							snapshot,
							result.step.inputTokens,
							Math.max(result.step.inputTokens ?? 0, context.estimatedTokens(definitions)),
							stepIndex,
							result.step.runVersion,
						);
					}
					return { step: result.step, text, terminal: event, definitions };
				}
				const result =
					event.kind === 'text'
						? await this.steps.appendText(this.mutation(command, current), event.content)
						: await this.steps.recordUsage(
								this.mutation(command, current),
								event.inputTokens,
								event.outputTokens,
							);
				if (result.status !== 'ok') {
					return null;
				} // Cancel or concurrent terminal fenced this task.
				current = result.step;
				if (event.kind === 'text') {
					text += event.content;
				}
				// Abort may arrive while SQLite is settling the last delta. Do not
				// ask the provider for another chunk; for-await break awaits the
				// iterator's resource cleanup before the unknown-state CAS.
				if (signal.aborted) {
					break;
				}
			}
		} catch (error) {
			this.runs.rememberFailure(command.userId, command.appId, command.runId, {
				code: runFailureCode(error),
				toolName: null,
			});
			logDiagnostic(
				this.logger,
				'warn',
				'AGENT_MODEL_STEP_FAILED',
				{ runId: command.runId, stepIndex, aborted: signal.aborted, failureCode: runFailureCode(error) },
				error,
			);
			if (drainingResources || error instanceof ToolExecutionUnknown) {
				// The main response has not attempted its terminal write. An
				// independent auxiliary drain failure cannot skip that CAS, even
				// when the auxiliary's own storage result is unknown.
				await this.settleUnknownStep(command, current, title, error);
				return null;
			}
			if (isAgentDrainFailure(error)) {
				throw error;
			}
			if (error instanceof ProviderRequestFailure && error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED') {
				resourceCleanupFailure = error;
			}
		}
		// A durable dispatch can have remote effects after a timeout, Abort,
		// protocol failure or local stop. CAS fences concurrent cancellation.
		// Unknown DB writes above throw (not classified as Provider failures),
		// so they never trigger an unsafe second terminal write or retry.
		await this.settleUnknownStep(command, current, title, resourceCleanupFailure);
		return null;
	}

	/** Known main revision and no unresolved main terminal commit; auxiliary writes are independent. */
	private async settleUnknownStep(
		command: RunExecutionCommand,
		current: RunModelStep,
		title: TitleSession,
		failure: unknown,
	): Promise<void> {
		const failures: unknown[] = failure === null ? [] : [failure];
		try {
			await title.close();
		} catch (error) {
			if (!failures.includes(error)) {
				failures.push(error);
			}
		}
		try {
			await this.steps.finish(this.mutation(command, current), { state: 'unknown' });
		} catch (error) {
			failures.push(error);
		}
		// Preserve real resource failures for shutdown/capacity accounting after
		// independently attempting the durable unknown state and its WS update.
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Model resources and unknown settlement failed');
		}
	}
}
