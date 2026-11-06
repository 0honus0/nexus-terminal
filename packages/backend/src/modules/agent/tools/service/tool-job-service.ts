import { FailureSummary } from '../../../../platform/lifecycle/failure-summary.js';
import { RESULT_PAGE_MAX_BYTES } from '../../context/result-rules.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic, withDiagnosticContext } from '../../../../platform/logging/diagnostic-log.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { ToolJobModel } from '../model/tool-job-model.js';
import { TOOL_RESULT_MAX_BYTES } from '../../runs/run-tool-limits.js';
import type {
	ToolJob,
	ToolJobScope,
	ToolJobPreparation,
	ToolJobResult,
	ToolOutputWriter,
} from '../model/tool-job-types.js';
import type { ToolJobControlInput, ToolTarget } from '../model/tool-types.js';
import {
	AgentFailure,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	ToolOperationRefusal,
	isAgentDrainFailure,
	aggregateToolFailures,
} from '../../agent-failure.js';

interface OwnedJob {
	background: boolean;
	active: boolean;
	job: ToolJob;
	controller: AbortController;
	waitingForSpace: boolean;
	work: (
		signal: AbortSignal,
		timeoutMs: number,
		onOutput: (index: number, stream: 'stdout' | 'stderr', text: string, signal: AbortSignal) => Promise<void>,
	) => Promise<Exclude<ToolJobResult, { status: 'not_started' }>>;
	deadline: number;
	timer: ReturnType<typeof setTimeout> | null;
	validate: (signal: AbortSignal) => Promise<void>;
	pending: Promise<void> | null;
	failure: unknown;
	refusal: ToolOperationRefusal | null;
	cleanupFailed: boolean;
	onFailure(error: unknown): void;
	unsubscribe(): void;
}

function hasCleanupFailure(error: unknown): boolean {
	return (
		error instanceof ToolCleanupFailure || (error instanceof AggregateError && error.errors.some(hasCleanupFailure))
	);
}

function sameScope(job: ToolJob, scope: ToolJobScope): boolean {
	return job.userId === scope.userId && job.appId === scope.appId && job.runId === scope.runId;
}

function resultView(result: ToolJobResult | null) {
	return result === null
		? null
		: result.status === 'not_started'
			? { status: result.status }
			: {
					status: result.status,
					commands: result.commands.map((item) =>
						item.status === 'not_started'
							? { index: item.index, status: item.status }
							: {
									index: item.index,
									status: item.status,
									exitCode: item.exitCode,
									signal: item.signal,
									stdout: item.stdout,
									stderr: item.stderr,
									truncated: item.truncated,
								},
					),
				};
}

function snapshot(job: ToolJob, waitingForSpace: boolean): string {
	return JSON.stringify({
		jobId: job.id,
		waitingForSpace,
		state: job.state,
		revision: job.revision,
		result: resultView(job.result),
		createdAt: job.createdAt,
		updatedAt: job.updatedAt,
	});
}

/** Run-owned Shell execution. Every remote Promise remains owned through durable settlement and cleanup. */
export class ToolJobService {
	private readonly jobs = new Map<string, OwnedJob>();
	private collecting: Promise<void> | null = null;
	private collectionTimer: ReturnType<typeof setTimeout> | null = null;
	private stopping = false;

	waitingOutputCount(scope: ToolJobScope): number {
		return [...this.jobs.values()].filter(
			(item) => sameScope(item.job, scope) && item.active && item.waitingForSpace,
		).length;
	}

	async initialize(): Promise<void> {
		await this.collectOutput();
		this.scheduleCollection();
	}

	private scheduleCollection(): void {
		if (this.stopping || this.collectionTimer !== null) {
			return;
		}
		this.collectionTimer = setTimeout(() => {
			this.collectionTimer = null;
			void this.collectOutput()
				.catch((error: unknown) => {
					logDiagnostic(this.logger, 'error', 'AGENT_JOB_OUTPUT_CLEANUP_FAILED', {}, error);
				})
				.finally(() => this.scheduleCollection());
		}, 60_000);
		this.collectionTimer.unref();
	}

	collectOutput(): Promise<void> {
		this.collecting ??= Promise.resolve()
			.then(async () => {
				const failures = new FailureSummary();
				try {
					for await (const id of this.model.outputKeys()) {
						try {
							if (!(await this.model.outputOwnerExists(id))) {
								await this.model.removeOutput(id);
							}
						} catch (error) {
							failures.record(error);
						}
					}
				} catch (error) {
					failures.record(error);
				}
				const errors = failures.errors();
				if (errors.length) {
					throw new ToolCleanupFailure({ cause: new AggregateError(errors, 'Output cleanup failed') });
				}
			})
			.finally(() => {
				this.collecting = null;
			});
		return this.collecting;
	}

	quiesce(): void {
		this.stopping = true;
		if (this.collectionTimer !== null) {
			clearTimeout(this.collectionTimer);
			this.collectionTimer = null;
		}
	}

	async close(): Promise<void> {
		this.quiesce();
		if (this.collecting) {
			await this.collecting;
		}
	}

	constructor(
		private readonly model: ToolJobModel,
		private readonly logger?: Logger,
		private readonly changed: (scope: ToolJobScope) => void = () => {},
	) {}

	backgroundCount(scope: ToolJobScope): number {
		return [...this.jobs.values()].filter((item) => sameScope(item.job, scope) && item.active && item.background)
			.length;
	}

	async prepare(input: ToolJobPreparation): Promise<string> {
		const { operation, target, policyRevision, signal, work, validate } = input;
		const deadline = input.deadlineAt;
		signal.throwIfAborted();
		const job = await this.model.create(
			{
				id: operation.id,
				userId: operation.userId,
				appId: operation.appId,
				runId: operation.runId,
				connectionId: target.id,
				targetVersion: target.version,
				fingerprint: target.fingerprint,
				policyRevision,
			},
			input.maxHistory,
		);
		const controller = new AbortController();

		const abort = () => controller.abort();

		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
		}
		this.jobs.set(job.id, {
			background: input.background,
			waitingForSpace: false,
			active: true,
			job,
			controller,
			work,
			deadline,
			timer: null,
			validate,
			pending: null,
			failure: null,
			refusal: null,
			cleanupFailed: false,
			onFailure: input.onFailure,

			unsubscribe: () => signal.removeEventListener('abort', abort),
		});
		this.changed(job);
		logDiagnostic(this.logger, 'info', 'AGENT_JOB_ACCEPTED', {
			jobId: job.id,
			runId: job.runId,
			connectionId: job.connectionId,
		});
		return JSON.stringify({ jobId: job.id, accepted: true });
	}

	launch(id: string): void {
		const item = this.jobs.get(id);
		if (!item || item.pending !== null) {
			throw new AgentFailure('internal_failure');
		}
		item.timer = setTimeout(() => item.controller.abort(), Math.max(1, item.deadline - Date.now()));
		item.pending = Promise.resolve()
			.then(() => withDiagnosticContext({ jobId: item.job.id, runId: item.job.runId }, () => this.execute(item)))
			.then(
				() => {
					if (item.job.state === 'unknown') {
						item.onFailure(new ToolExecutionUnknown());
					}
				},
				(error: unknown) => {
					logDiagnostic(
						this.logger,
						'error',
						'AGENT_JOB_TASK_FAILED',
						{ jobId: item.job.id, runId: item.job.runId },
						error,
					);
					item.failure = error;
					item.cleanupFailed = hasCleanupFailure(error);
					// Notify only after execution and its monitor/cleanup have settled.
					// The Run callback stops admission; it never waits on this Promise.
					item.onFailure(error);
					throw error;
				},
			);
		void item.pending.catch(() => undefined);
	}

	private async execute(item: OwnedJob): Promise<void> {
		const monitor = new AbortController();
		let monitoring: Promise<void> | null = null;
		let authorityFailure: unknown = null;
		let confirmed = false;
		let writer: ToolOutputWriter | null = null;
		let executionFailure: unknown = null;
		try {
			if (Date.now() >= item.deadline) {
				item.controller.abort();
			}
			item.controller.signal.throwIfAborted();
			await item.validate(item.controller.signal);
			writer = await this.model.openOutput(item.job.id);
			item.job = await this.model.change(item.job, 'dispatched', null);
			logDiagnostic(this.logger, 'info', 'AGENT_JOB_DISPATCHED');
			await item.validate(item.controller.signal);
			monitoring = Promise.resolve().then(async () => {
				while (!monitor.signal.aborted) {
					try {
						await delay(1000, undefined, { signal: monitor.signal });
					} catch (error) {
						if (monitor.signal.aborted) {
							return;
						}
						authorityFailure = error;
						item.controller.abort();
						return;
					}
					if (monitor.signal.aborted) {
						return;
					}
					try {
						await item.validate(item.controller.signal);
					} catch (error) {
						authorityFailure = error;
						item.controller.abort();
						return;
					}
				}
			});
			const remainingMs = item.deadline - Date.now();
			if (remainingMs <= 0) {
				item.controller.abort();
			}
			item.controller.signal.throwIfAborted();
			const output = writer;

			const blocked = (waiting: boolean) => {
				if (item.waitingForSpace === waiting) {
					return;
				}
				item.waitingForSpace = waiting;
				this.changed(item.job);
				logDiagnostic(
					this.logger,
					waiting ? 'warn' : 'info',
					waiting ? 'AGENT_JOB_OUTPUT_WAITING_FOR_SPACE' : 'AGENT_JOB_OUTPUT_RESUMED',
					{ jobId: item.job.id },
				);
			};

			const result = await item.work(
				item.controller.signal,
				remainingMs,
				async (commandIndex, stream, text, signal) => {
					await output.append({ commandIndex, stream, text }, signal, blocked);
				},
			);
			confirmed = true;
			await writer.flush(item.controller.signal, blocked);
			await writer.close();
			writer = null;
			await item.validate(item.controller.signal);
			monitor.abort();
			await monitoring;
			if (authorityFailure !== null) {
				throw authorityFailure;
			}
			item.job = await this.model.change(
				item.job,
				result.status === 'completed' ? 'completed' : 'failed',
				result,
			);
			logDiagnostic(this.logger, result.status === 'completed' ? 'info' : 'warn', 'AGENT_JOB_SETTLED', {
				state: item.job.state,
				commandCount: result.commands.length,
				executedCount: result.commands.filter((item) => item.status !== 'not_started').length,
				truncated: result.commands.some((item) => item.status !== 'not_started' && item.truncated),
			});
		} catch (error) {
			executionFailure = error;
			logDiagnostic(this.logger, 'warn', 'AGENT_JOB_EXECUTION_FAILED', {}, error);
			monitor.abort();
			if (monitoring) {
				await monitoring;
			}
			// Uncertain DB commits are never followed by another guessed state write.
			if (
				(isAgentDrainFailure(error) && !(error instanceof ToolExecutionUnknown)) ||
				(authorityFailure !== null && isAgentDrainFailure(authorityFailure))
			) {
				if (authorityFailure !== null && authorityFailure !== error) {
					executionFailure = new AggregateError(
						[error, authorityFailure],
						'Job execution and authority failed',
					);
					throw executionFailure;
				}
				throw error;
			}
			try {
				if (!confirmed && !(error instanceof ToolExecutionUnknown)) {
					item.job = await this.model.change(item.job, 'failed', { status: 'not_started' });
					if (error instanceof ToolOperationRefusal) {
						item.refusal = error;
					}
				} else {
					item.job = await this.model.change(item.job, 'unknown', null);
				}
				logDiagnostic(this.logger, 'warn', 'AGENT_JOB_SETTLED', { state: item.job.state });
			} catch (settlement) {
				logDiagnostic(this.logger, 'error', 'AGENT_JOB_SETTLEMENT_FAILED', {}, settlement);
				executionFailure = new AggregateError([error, settlement], 'Job execution and settlement failed');
				throw executionFailure;
			}
			if (error instanceof ToolCleanupFailure) {
				throw error;
			}
		} finally {
			if (item.timer !== null) {
				clearTimeout(item.timer);
				item.timer = null;
			}
			monitor.abort();
			if (monitoring) {
				await monitoring;
			}
			item.unsubscribe();
			try {
				if (writer !== null) {
					try {
						await writer.close();
					} catch (cleanup) {
						throw new ToolCleanupFailure({
							cause:
								executionFailure === null ? cleanup : new AggregateError([executionFailure, cleanup]),
						});
					}
				}
			} finally {
				item.active = false;
				item.waitingForSpace = false;
				this.changed(item.job);
			}
		}
	}

	private async owned(scope: ToolJobScope, target: ToolTarget, id: string): Promise<ToolJob> {
		const job = await this.model.get(scope, id);
		if (!job || job.connectionId !== target.id) {
			throw new AgentFailure('not_found');
		}
		if (job.targetVersion !== target.version || job.fingerprint !== target.fingerprint) {
			throw new AgentFailure('version_conflict');
		}
		return job;
	}

	private checkFailure(id: string): void {
		const item = this.jobs.get(id);
		if (item && item.failure !== null) {
			throw item.failure;
		}
		if (item?.refusal) {
			throw item.refusal;
		}
	}

	private async settled(job: ToolJob): Promise<void> {
		const item = this.jobs.get(job.id);
		if (item?.pending && job.state !== 'queued' && job.state !== 'dispatched') {
			// A durable terminal row may precede the owner's final cleanup/late failure.
			await item.pending;
		}
		this.checkFailure(job.id);
		if (job.state === 'unknown') {
			throw new ToolExecutionUnknown();
		}
	}

	private async waitFor(
		scope: ToolJobScope,
		target: ToolTarget,
		id: string,
		waitMs: number,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<ToolJob> {
		let job = await this.owned(scope, target, id);
		if (job.state === 'queued' || job.state === 'dispatched') {
			const pending = this.jobs.get(id)?.pending;
			if (!pending) {
				throw new AgentFailure('operation_unknown');
			}
			const waiting = new AbortController();
			const deadline = delay(waitMs, undefined, { signal: AbortSignal.any([signal, waiting.signal]) });
			try {
				await Promise.race([pending, deadline]);
			} catch (error) {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable', { cause: error });
				}
				throw error;
			} finally {
				waiting.abort();
				await Promise.allSettled([deadline]);
			}
			job = await this.owned(scope, target, id);
		}
		await validate();
		await this.settled(job);
		await validate();
		return job;
	}

	async foreground(
		scope: ToolJobScope,
		target: ToolTarget,
		id: string,
		waitMs: number,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		const job = await this.waitFor(scope, target, id, waitMs, signal, validate);
		if (job.result !== null && job.result.status !== 'not_started') {
			const result = resultView(job.result);
			if (result === null || result.status === 'not_started') {
				throw new AgentFailure('internal_failure');
			}
			return JSON.stringify({
				jobId: job.id,
				outputRead: { connectionId: job.connectionId, action: 'output', jobIds: [job.id], offset: 0 },
				status: result.status,
				commands: result.commands,
			});
		}
		const item = this.jobs.get(id);
		if (item?.active) {
			item.background = true;
			this.changed(item.job);
		}
		logDiagnostic(this.logger, 'debug', 'AGENT_SHELL_YIELDED', {
			jobId: job.id,
			runId: job.runId,
			state: job.state,
		});
		return snapshot(job, this.jobs.get(job.id)?.waitingForSpace ?? false);
	}

	async control(
		scope: ToolJobScope,
		target: ToolTarget,
		input: ToolJobControlInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
		waitBudgetMs: number,
	): Promise<string> {
		await validate();
		if (input.action === 'list') {
			const records = await this.model.list(scope, target.id, 64, input.offset);
			const jobs = records
				.slice(0, 64)
				.filter((job) => job.targetVersion === target.version && job.fingerprint === target.fingerprint);
			for (const job of jobs) {
				await this.settled(job);
			}
			await validate();
			return JSON.stringify({
				nextOffset: records.length > 64 ? input.offset + 64 : null,
				jobs: jobs.map((job) => ({
					jobId: job.id,
					state: job.state,
					revision: job.revision,
					waitingForSpace: this.jobs.get(job.id)?.waitingForSpace ?? false,
					createdAt: job.createdAt,
					updatedAt: job.updatedAt,
				})),
			});
		}
		if (!input.jobIds.length) {
			throw new AgentFailure('invalid_input');
		}
		const jobs = await Promise.all(input.jobIds.map((id) => this.owned(scope, target, id)));
		if (input.action === 'output') {
			const pages = [];
			let size = 128;
			for (const job of jobs) {
				// Reading evidence does not wait for execution settlement or clear an unknown fence.
				const captured = await this.model.output(job.id, input.offset, RESULT_PAGE_MAX_BYTES);
				const events = captured?.output ?? [];
				const totalBytes = captured?.capturedBytes ?? 0;

				const output: Array<{ commandIndex: number; stream: string; text: string }> = [];
				let nextOffset = input.offset,
					full = false;
				let outputBytes = 2;
				for (const event of events) {
					const last = output[output.length - 1];
					const item =
						last?.commandIndex === event.commandIndex && last.stream === event.stream
							? last
							: { commandIndex: event.commandIndex, stream: event.stream, text: '' };
					if (item !== last) {
						const overhead = Buffer.byteLength(JSON.stringify(item)) + (output.length ? 1 : 0);
						if (outputBytes + overhead + 6 > RESULT_PAGE_MAX_BYTES) {
							full = true;
							break;
						}
						outputBytes += overhead;
						output.push(item);
					}
					for (const point of event.text) {
						const cost = Buffer.byteLength(JSON.stringify(point)) - 2;
						if (outputBytes + cost > RESULT_PAGE_MAX_BYTES) {
							full = true;
							break;
						}
						item.text += point;
						outputBytes += cost;
						nextOffset += Buffer.byteLength(point);
					}
					if (full) {
						break;
					}
				}
				const page = {
					jobId: job.id,
					state: job.state,
					offset: input.offset,
					nextOffset,
					capturedBytes: totalBytes,
					available: captured !== null,
					waitingForSpace: this.jobs.get(job.id)?.waitingForSpace ?? false,
					output,
					complete: job.state !== 'queued' && job.state !== 'dispatched',
				};
				const bytes = Buffer.byteLength(JSON.stringify(page)) + 1;
				if (size + bytes > TOOL_RESULT_MAX_BYTES) {
					break;
				}
				pages.push(page);
				size += bytes;
			}
			await validate();
			return JSON.stringify({ jobs: pages, nextIndex: pages.length < jobs.length ? pages.length : null });
		}

		if (input.action === 'cancel') {
			await validate();
			for (const job of jobs) {
				const item = this.jobs.get(job.id);
				if (item) {
					item.controller.abort();
				} else if (job.state === 'queued' || job.state === 'dispatched') {
					throw new AgentFailure('operation_unknown');
				}
			}
			const outcomes = await Promise.allSettled(
				jobs.map(async (job) => {
					const pending = this.jobs.get(job.id)?.pending;
					if (pending) {
						await pending;
					}
				}),
			);
			const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
			if (failures.length) {
				throw aggregateToolFailures(failures, 'Job group cancellation failed');
			}
		} else if (input.action === 'wait') {
			const active = jobs.filter((job) => job.state === 'queued' || job.state === 'dispatched');
			if (input.waitMode === 'all' || active.length === jobs.length) {
				const stop = new AbortController();
				const combined = AbortSignal.any([signal, stop.signal]);
				const waits = active.map((job) =>
					this.waitFor(
						scope,
						target,
						job.id,
						Math.min(input.waitSeconds * 1000, waitBudgetMs),
						combined,
						validate,
					),
				);
				try {
					if (input.waitMode === 'any') {
						await Promise.race(waits);
					} else {
						await Promise.all(waits);
					}
				} finally {
					stop.abort();
					await Promise.allSettled(waits);
				}
			}
		}
		const current = await Promise.all(input.jobIds.map((id) => this.owned(scope, target, id)));
		for (const job of current) {
			await this.settled(job);
		}
		await validate();
		return JSON.stringify({
			jobs: current.map((job) => ({
				jobId: job.id,
				state: job.state,
				revision: job.revision,
				waitingForSpace: this.jobs.get(job.id)?.waitingForSpace ?? false,
				result: resultView(job.result),
				createdAt: job.createdAt,
				updatedAt: job.updatedAt,
			})),
		});
	}

	async drain(scope: ToolJobScope): Promise<void> {
		const items = [...this.jobs.values()].filter((item) => sameScope(item.job, scope));
		for (const item of items) {
			item.controller.abort();
		}
		const outcomes = await Promise.allSettled(
			items.map(async (item) => {
				if (item.failure !== null) {
					throw item.failure;
				}
				if (item.pending) {
					await item.pending;
				} else {
					try {
						item.job = await this.model.change(item.job, 'failed', { status: 'not_started' });
					} catch (error) {
						item.failure = error;
						throw error;
					} finally {
						item.unsubscribe();
					}
				}
			}),
		);
		const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
		for (const item of items) {
			if (item.job.state === 'unknown') {
				failures.push(new ToolExecutionUnknown());
			}
			if (
				!item.cleanupFailed &&
				item.failure === null &&
				item.job.state !== 'queued' &&
				item.job.state !== 'dispatched'
			) {
				this.jobs.delete(item.job.id);
			}
		}
		logDiagnostic(this.logger, failures.length ? 'error' : 'debug', 'AGENT_JOBS_DRAINED', {
			runId: scope.runId,
			jobCount: items.length,
			failures: failures.length,
		});
		if (failures.length) {
			if (items.some((item) => item.cleanupFailed)) {
				throw new ToolCleanupFailure({ cause: new AggregateError(failures, 'Job cleanup failed') });
			}
			if (
				failures.some((failure) => isAgentDrainFailure(failure) && !(failure instanceof ToolExecutionUnknown))
			) {
				throw new AggregateError(failures, 'Job state settlement failed');
			}
			throw new ToolExecutionUnknown({ cause: new AggregateError(failures, 'Job effects remain unknown') });
		}
	}
}
