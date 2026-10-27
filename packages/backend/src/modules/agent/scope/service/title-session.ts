import type { TitleModel } from '../model/title-model.js';
import type { TitleClaim, TitleCommand } from '../model/title-types.js';
import type { RunExecutionCommand, RunFrozenInput, RunModelMessage } from '../../runs/model/run-types.js';
import type { RunModelStream } from '../../runs/model/run-model-stream.js';
import type { ProviderModel } from '../../providers/model/provider-model.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import { AgentFailure, ProviderRequestFailure, isAgentDrainFailure } from '../../agent-failure.js';
import { estimateMessages } from '../../context/compaction-rules.js';
import { TITLE_INSTRUCTIONS, generatedThreadTitle, normalizeThreadTitle } from '../title-rules.js';
import { AGENT_REASONING_EFFORTS } from '@nexus-terminal/shared/agent/providers/values';

/** The original Run owns this optional call, its cancellation, settlement and late rejection. */
export class TitleSession {
	private claim: TitleClaim | null = null;
	private pending: Promise<void> | null = null;
	private controller: AbortController | null = null;
	private fatal: unknown = null;
	private started = false;
	private closing = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly model: TitleModel,
		private readonly stream: RunModelStream,
		private readonly providers: ProviderModel,
		private readonly settings: ExecutionService,
		private readonly command: RunExecutionCommand,
		private readonly frozen: RunFrozenInput,
		private readonly signal: AbortSignal,
		private readonly logger?: Logger,
	) {}

	async prepare(): Promise<void> {
		if (this.signal.aborted) {
			return;
		}
		try {
			const fallback = normalizeThreadTitle(this.command.prompt);
			if (fallback) {
				this.claim = await this.model.claim(
					{
						userId: this.command.userId,
						appId: this.command.appId,
						runId: this.command.runId,
						creationHash: this.command.requestHash,
					},
					fallback,
				);
				if (this.claim) {
					logDiagnostic(this.logger, 'info', 'AGENT_THREAD_TITLE_FALLBACK', { runId: this.command.runId });
				}
			}
		} catch (error) {
			this.failed(error);
		}
		this.assertHealthy();
	}

	/** Foreground dispatch takes its slot first. An unavailable auxiliary slot leaves the fallback. */
	start(): void {
		if (this.closing || this.started || !this.claim || this.signal.aborted || this.frozen.protocol === 'images') {
			return;
		}
		this.started = true;
		const controller = new AbortController();
		this.controller = controller;
		const timer = setTimeout(
			() => controller.abort(),
			Math.max(1, Math.min(10000, this.command.deadlineAt - Date.now() - 1000)),
		);
		const signal = AbortSignal.any([controller.signal, this.signal]);
		this.pending = Promise.resolve()
			.then(() => this.generate(signal))
			.catch((error: unknown) => this.failed(error))
			.finally(() => {
				clearTimeout(timer);
				this.controller = null;
			});
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.closing = true;
		this.closePromise = Promise.resolve().then(async () => {
			await this.pending;
			this.assertHealthy();
		});
		// The foreground result does not wait for optional remote work beyond its cancellation drain.
		this.controller?.abort();
		return this.closePromise;
	}

	private assertHealthy(): void {
		if (this.fatal !== null) {
			throw this.fatal;
		}
	}

	private failed(error: unknown): void {
		logDiagnostic(this.logger, 'warn', 'AGENT_THREAD_TITLE_FAILED', { runId: this.command.runId }, error);
		if (
			isAgentDrainFailure(error) ||
			(error instanceof ProviderRequestFailure && error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED')
		) {
			this.fatal = error;
		}
	}

	private async generate(signal: AbortSignal): Promise<void> {
		const claim = this.claim;
		if (!claim || signal.aborted) {
			return;
		}
		const original = this.frozen;
		const capabilities = original.capabilities;
		const effort = AGENT_REASONING_EFFORTS.find((value) => capabilities.reasoningEfforts?.includes(value));
		const frozen: RunFrozenInput = {
			providerId: original.providerId,
			providerVersion: original.providerVersion,
			credentialRevision: original.credentialRevision,
			modelId: original.modelId,
			baseUrl: original.baseUrl,
			protocol: original.protocol,
			executionPolicy: original.executionPolicy,
			capabilities: {
				id: capabilities.id,
				protocol: capabilities.protocol,
				contextWindow: capabilities.contextWindow,
				maxOutputTokens: capabilities.maxOutputTokens,
				supportsTools: false,
				supportsImageInput: false,
				supportsImageGeneration: false,
				supportsFileInput: false,
				supportsPromptCacheKey: capabilities.supportsPromptCacheKey,
				reasoningEfforts: capabilities.reasoningEfforts?.map((value) => value),
				defaultReasoningEffort: effort,
				reasoningMandatory: capabilities.reasoningMandatory,
			},
		};
		const messages: RunModelMessage[] = [
			{
				role: 'user',
				content: TITLE_INSTRUCTIONS + JSON.stringify(Array.from(this.command.prompt).slice(0, 2000).join('')),
			},
		];
		const output = Math.min(2048, capabilities.maxOutputTokens ?? 2048);
		const tokens = estimateMessages(messages) + output;
		if (capabilities.contextWindow !== undefined && tokens > capabilities.contextWindow) {
			return;
		}
		const command: TitleCommand = {
			userId: this.command.userId,
			appId: this.command.appId,
			runId: this.command.runId,
			creationHash: this.command.requestHash,
			claim: { threadId: claim.threadId, version: claim.version },
			requestHash: this.stream.requestHash(frozen, messages, [], output),
			estimatedTokens: tokens,
		};
		if (
			!(await this.model.reserve(command, (settings, usage) => {
				// Leave room for the next foreground round even when this call overlaps tools.
				if (usage.modelRequests + 1 >= settings.limits.maxModelRequests) {
					throw new AgentFailure('limit_exceeded');
				}
				this.settings.admitReservation(settings, usage, tokens);
				this.settings.admitDispatch(settings, usage);
			}))
		) {
			return;
		}
		let dispatched = false;
		let settled = false;
		let failure: unknown = null;
		try {
			const provider = await this.providers.get(command.userId, frozen.providerId);
			if (
				!provider ||
				!provider.enabled ||
				provider.version !== frozen.providerVersion ||
				provider.credentialRevision !== frozen.credentialRevision ||
				signal.aborted
			) {
				return;
			}
			const credential = await this.providers.credential(provider);
			await this.providers.guardCurrent(provider);
			if (signal.aborted) {
				return;
			}
			dispatched = await this.model.dispatch(command, (settings, usage) =>
				this.settings.admitDispatch(settings, usage),
			);
			if (!dispatched) {
				return;
			}
			await this.providers.guardCurrent(provider);
			if (signal.aborted) {
				return;
			}
			logDiagnostic(this.logger, 'info', 'AGENT_THREAD_TITLE_STARTED', { runId: command.runId });
			let text = '';
			let completed = false;
			for await (const event of this.stream.stream(frozen, messages, [], credential, signal, output)) {
				await this.providers.guardCurrent(provider);
				if (signal.aborted) {
					break;
				}
				if (event.kind === 'text') {
					text += event.content;
					if (Buffer.byteLength(text, 'utf8') > 4096) {
						throw new AgentFailure('limit_exceeded');
					}
				} else if (event.kind === 'usage') {
					if (!(await this.model.recordUsage(command, event.inputTokens, event.outputTokens))) {
						return;
					}
				} else {
					completed = event.finishReason === 'stop';
				}
			}
			const title = generatedThreadTitle(text);
			if (!completed || signal.aborted || !title) {
				return;
			}
			settled = true;
			const confirmed = await this.model.finish(command, 'completed', title);
			logDiagnostic(this.logger, 'info', 'AGENT_THREAD_TITLE_SETTLED', { runId: command.runId, confirmed });
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
						: new AggregateError([failure, cleanup], 'Title request and settlement failed');
				}
			}
		}
	}
}
