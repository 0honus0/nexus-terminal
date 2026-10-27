import { contextBytes } from '../context-rules.js';
import type { ExecutionSettings, ExecutionUsage } from '../../execution/model/execution-types.js';
import { randomUUID } from 'node:crypto';
import type { CompactionModel } from '../model/compaction-model.js';
import type { CompactionCommand, CompactionResult, ContextSnapshot } from '../model/context-types.js';
import type { ContextService } from './context-service.js';
import type { RunModelStream } from '../../runs/model/run-model-stream.js';
import type { RunExecutionCommand, RunFrozenInput, RunModelMessage } from '../../runs/model/run-types.js';
import type { ProviderModel } from '../../providers/model/provider-model.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import {
	AgentFailure,
	ContextLimitExceeded,
	ProviderRequestFailure,
	isAgentDrainFailure,
} from '../../agent-failure.js';
import { compactionCeiling, compactionCut, estimateMessages } from '../compaction-rules.js';
import { SUMMARY_INSTRUCTIONS } from '../compaction-values.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';

/** One Run owns the background Promise and transport, including cancellation and late rejection. */
export class CompactionSession {
	private pending: Promise<CompactionResult | null> | null = null;
	private controller: AbortController | null = null;
	private candidate: CompactionResult | null = null;
	private failure: unknown = null;
	private failures = 0;
	private closing = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: CompactionModel,
		private readonly stream: RunModelStream,
		private readonly providers: ProviderModel,
		private readonly settings: ExecutionService,
		private readonly command: RunExecutionCommand,
		private readonly frozen: RunFrozenInput,
		private readonly signal: AbortSignal,
		private readonly logger?: Logger,
	) {}

	async prepare(
		context: ContextService,
		snapshot: ContextSnapshot,
		tokens: number,
		stepIndex: number,
		version: number,
	): Promise<void> {
		// Precomputation overlaps tools; it must release its model slot before the next foreground dispatch.
		if (this.pending) {
			await this.pending;
		}
		if (this.failure !== null) {
			throw this.failure;
		}
		const ceiling = compactionCeiling(this.frozen.capabilities.contextWindow);
		if (tokens < ceiling) {
			return;
		}
		if (
			this.candidate &&
			context.applyAutomatic(this.candidate.id, this.candidate.summary, this.candidate.source, this.candidate.cut)
		) {
			this.candidate = null;
			this.failures = 0;
			return;
		}
		this.candidate = null;
		const result = await this.summarize(snapshot, stepIndex, version, this.signal);
		if (result === null || !context.applyAutomatic(result.id, result.summary, result.source, result.cut)) {
			throw new ContextLimitExceeded();
		}
		this.failures = 0;
	}

	precompute(
		snapshot: ContextSnapshot,
		measuredInput: number | undefined,
		tokens: number,
		stepIndex: number,
		version: number,
	): void {
		const window = this.frozen.capabilities.contextWindow;
		if (
			this.closing ||
			this.signal.aborted ||
			window === undefined ||
			this.pending ||
			this.candidate ||
			this.failures >= 2 ||
			measuredInput === undefined ||
			measuredInput < 64000 ||
			tokens < compactionCeiling(window) * 0.85
		) {
			return;
		}
		const controller = new AbortController();
		this.controller = controller;
		const signal = AbortSignal.any([this.signal, controller.signal]);
		this.pending = Promise.resolve()
			.then(() => this.summarize(snapshot, stepIndex, version, signal))
			.then((result) => {
				if (!signal.aborted && !this.closing) {
					this.candidate = result;
					if (result === null) {
						this.failures++;
					}
				}
				return result;
			})
			.catch((error: unknown) => {
				if (isAgentDrainFailure(error) || hasCleanupFailure(error)) {
					this.failure = error;
				} else {
					this.failures++;
					logDiagnostic(
						this.logger,
						'warn',
						'AGENT_CONTEXT_PRECOMPUTE_FAILED',
						{ runId: this.command.runId },
						error,
					);
				}
				return null;
			})
			.finally(() => {
				this.pending = null;
				this.controller = null;
			});
	}

	assertHealthy(): void {
		if (this.failure !== null) {
			throw this.failure;
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closePromise = Promise.resolve().then(async () => {
			await this.pending;
			this.candidate = null;
			this.assertHealthy();
		});
		this.closing = true;
		this.controller?.abort();
		return this.closePromise;
	}

	private admitSummary(settings: ExecutionSettings, usage: ExecutionUsage, tokens: number): void {
		// Leave one model request for continuation; an optional precompute must not consume the final request.
		if (usage.modelRequests + 1 >= settings.limits.maxModelRequests) {
			throw new AgentFailure('limit_exceeded');
		}
		this.settings.admitReservation(settings, usage, tokens);
		this.settings.admitDispatch(settings, usage);
	}

	private async summarize(
		snapshot: ContextSnapshot,
		stepIndex: number,
		version: number,
		signal: AbortSignal,
	): Promise<CompactionResult | null> {
		const window = this.frozen.capabilities.contextWindow;
		if (signal.aborted || window === undefined || this.frozen.protocol === 'images') {
			return null;
		}
		const cut = compactionCut(snapshot.messages, window);
		if (cut === null) {
			return null;
		}
		const messages: RunModelMessage[] = [
			{ role: 'user', content: SUMMARY_INSTRUCTIONS + JSON.stringify(snapshot.messages.slice(0, cut)) },
		];
		contextBytes(messages);
		const output = Math.min(16384, this.frozen.capabilities.maxOutputTokens ?? 16384);
		const tokens = estimateMessages(messages) + output;
		const command: CompactionCommand = {
			id: randomUUID(),
			userId: this.command.userId,
			appId: this.command.appId,
			runId: this.command.runId,
			stepIndex,
			expectedRunVersion: version,
			creationHash: this.command.requestHash,
			requestHash: this.stream.requestHash(this.frozen, messages, [], output),
			now: Date.now(),
			snapshot,
			cut,
			estimatedTokens: tokens,
		};
		if (!(await this.model.reserve(command, (settings, usage) => this.admitSummary(settings, usage, tokens)))) {
			throw new AgentFailure('version_conflict');
		}
		let dispatched = false;
		let settled = false;
		let failure: unknown = null;
		try {
			const provider = await this.providers.get(command.userId, this.frozen.providerId);
			if (
				!provider ||
				!provider.enabled ||
				provider.version !== this.frozen.providerVersion ||
				provider.credentialRevision !== this.frozen.credentialRevision ||
				signal.aborted
			) {
				return null;
			}
			const credential = await this.providers.credential(provider);
			await this.providers.guardCurrent(provider);
			if (signal.aborted) {
				return null;
			}
			// A commit-unknown rejection must escape without a second settlement attempt.
			try {
				dispatched = await this.model.dispatch(command, (settings, usage) =>
					this.settings.admitDispatch(settings, usage),
				);
			} catch (error) {
				if (isAgentDrainFailure(error)) {
					settled = true;
				}
				throw error;
			}
			if (!dispatched) {
				throw new AgentFailure('version_conflict');
			}
			await this.providers.guardCurrent(provider);
			let summary = '';
			let complete = false;
			logDiagnostic(this.logger, 'info', 'AGENT_CONTEXT_SUMMARY_STARTED', {
				runId: command.runId,
				stepIndex,
				cut,
			});
			for await (const event of this.stream.stream(this.frozen, messages, [], credential, signal, output)) {
				await this.providers.guardCurrent(provider);
				if (signal.aborted) {
					break;
				}
				if (event.kind === 'text') {
					summary += event.content;
					if (Buffer.byteLength(summary, 'utf8') > 16384) {
						throw new ContextLimitExceeded();
					}
				} else if (event.kind === 'usage') {
					if (!(await this.model.recordUsage(command, event.inputTokens, event.outputTokens))) {
						return null;
					}
				} else {
					complete = event.finishReason === 'stop';
				}
			}
			if (
				!complete ||
				signal.aborted ||
				!summary.trim() ||
				estimateMessages([{ role: 'user', content: summary }]) >=
					estimateMessages(snapshot.messages.slice(0, cut))
			) {
				return null;
			}
			// Mark the write as attempted before awaiting, including an unknown completion commit.
			settled = true;
			if (!(await this.model.finish(command, 'completed', summary))) {
				await this.model.finish(command, 'unknown', null);
				return null;
			}
			logDiagnostic(this.logger, 'info', 'AGENT_CONTEXT_SUMMARY_COMPLETED', {
				runId: command.runId,
				stepIndex,
				cut,
			});
			return { id: command.id, summary, source: snapshot.messages, cut };
		} catch (error) {
			failure = error;
			if (isAgentDrainFailure(error)) {
				settled = true;
			}
			throw error;
		} finally {
			if (!settled) {
				try {
					await this.model.finish(command, dispatched ? 'unknown' : 'failed', null);
				} catch (cleanup) {
					throw failure === null
						? cleanup
						: new AggregateError([failure, cleanup], 'Context summary and settlement failed');
				}
			}
		}
	}
}

function hasCleanupFailure(error: unknown): boolean {
	return (
		(error instanceof ProviderRequestFailure && error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED') ||
		(error instanceof AggregateError && error.errors.some(hasCleanupFailure)) ||
		(error instanceof Error && error.cause !== undefined && hasCleanupFailure(error.cause))
	);
}
