import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic, withDiagnosticContext } from '../../../../platform/logging/diagnostic-log.js';
import { setTimeout as delay } from 'node:timers/promises';
import type { ToolJobModel } from '../model/tool-job-model.js';
import type { ToolJob, ToolJobScope, ToolJobPreparation, ToolJobResult } from '../model/tool-job-types.js';
import type { ToolJobControlInput, ToolTarget } from '../model/tool-types.js';
import { AgentFailure, ToolExecutionUnknown, ToolCleanupFailure, isAgentDrainFailure } from '../../agent-failure.js';

interface OwnedJob {
	job: ToolJob;
	controller: AbortController;
	work: (signal: AbortSignal, timeoutMs: number) => Promise<Exclude<ToolJobResult, { status: 'not_started' }>>;
	deadline: number;
	timer: ReturnType<typeof setTimeout> | null;
	validate: (signal: AbortSignal) => Promise<void>;
	pending: Promise<void> | null;
	failure: unknown;
	cleanupFailed: boolean;
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

/** Run-owned background execution. Every remote Promise remains owned through durable settlement and cleanup. */
export class ToolJobService {
	private readonly jobs = new Map<string, OwnedJob>();
	private reservations = 0;

	constructor(
		private readonly model: ToolJobModel,
		private readonly logger?: Logger,
	) {}

	async prepare(input: ToolJobPreparation): Promise<string> {
		const { operation, target, policyRevision, signal, work, validate } = input;
		const occupied = [...this.jobs.values()].filter(
			(item) =>
				item.job.state === 'queued' ||
				item.job.state === 'dispatched' ||
				item.failure !== null ||
				item.cleanupFailed,
		).length;
		if (this.reservations + occupied >= 8) {
			throw new AgentFailure('limit_exceeded');
		}
		this.reservations++;
		const deadline = Date.now() + input.timeoutMs;
		try {
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
				64,
			);
			const controller = new AbortController();

			const abort = () => controller.abort();

			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) {
				abort();
			}
			this.jobs.set(job.id, {
				job,
				controller,
				work,
				deadline,
				timer: null,
				validate,
				pending: null,
				failure: null,
				cleanupFailed: false,

				unsubscribe: () => signal.removeEventListener('abort', abort),
			});
			logDiagnostic(this.logger, 'info', 'AGENT_JOB_ACCEPTED', {
				jobId: job.id,
				runId: job.runId,
				connectionId: job.connectionId,
			});
			return JSON.stringify({ jobId: job.id, accepted: true });
		} finally {
			this.reservations--;
		}
	}

	launch(id: string): void {
		const item = this.jobs.get(id);
		if (!item || item.pending !== null) {
			throw new AgentFailure('internal_failure');
		}
		item.timer = setTimeout(() => item.controller.abort(), Math.max(1, item.deadline - Date.now()));
		item.pending = Promise.resolve().then(() =>
			withDiagnosticContext({ jobId: item.job.id, runId: item.job.runId }, () => this.execute(item)),
		);
		void item.pending.catch((error: unknown) => {
			logDiagnostic(
				this.logger,
				'error',
				'AGENT_JOB_TASK_FAILED',
				{ jobId: item.job.id, runId: item.job.runId },
				error,
			);
			item.failure = error;
			item.cleanupFailed = hasCleanupFailure(error);
		});
	}

	private async execute(item: OwnedJob): Promise<void> {
		const monitor = new AbortController();
		let monitoring: Promise<void> | null = null;
		let authorityFailure: unknown = null;
		let confirmed = false;
		try {
			if (Date.now() >= item.deadline) {
				item.controller.abort();
			}
			item.controller.signal.throwIfAborted();
			await item.validate(item.controller.signal);
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
			const result = await item.work(item.controller.signal, remainingMs);
			confirmed = true;
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
				exitCode: result.exitCode,
				stdoutBytes: Buffer.byteLength(result.stdout),
				stderrBytes: Buffer.byteLength(result.stderr),
				truncated: result.truncated,
			});
		} catch (error) {
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
					throw new AggregateError([error, authorityFailure], 'Job execution and authority failed');
				}
				throw error;
			}
			try {
				if (!confirmed && !(error instanceof ToolExecutionUnknown)) {
					item.job = await this.model.change(item.job, 'failed', { status: 'not_started' });
				} else {
					item.job = await this.model.change(item.job, 'unknown', null);
				}
				logDiagnostic(this.logger, 'warn', 'AGENT_JOB_SETTLED', { state: item.job.state });
			} catch (settlement) {
				logDiagnostic(this.logger, 'error', 'AGENT_JOB_SETTLEMENT_FAILED', {}, settlement);
				throw new AggregateError([error, settlement], 'Job execution and settlement failed');
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

	async control(
		scope: ToolJobScope,
		target: ToolTarget,
		input: ToolJobControlInput,
		signal: AbortSignal,
		validate: () => Promise<void>,
	): Promise<string> {
		await validate();
		if (input.action === 'list') {
			const records = await this.model.list(scope, target.id, 64);
			if (records.length > 64) {
				throw new AgentFailure('limit_exceeded');
			}
			const jobs = records.filter(
				(job) => job.targetVersion === target.version && job.fingerprint === target.fingerprint,
			);
			await validate();
			return JSON.stringify({
				jobs: jobs.map((job) => ({
					jobId: job.id,
					state: job.state,
					revision: job.revision,
					createdAt: job.createdAt,
					updatedAt: job.updatedAt,
				})),
			});
		}
		if (input.jobId === null) {
			throw new AgentFailure('invalid_input');
		}
		let job = await this.owned(scope, target, input.jobId);
		const active = this.jobs.get(job.id);
		if (input.action === 'cancel') {
			if (active) {
				await validate();
				logDiagnostic(this.logger, 'info', 'AGENT_JOB_CANCEL_REQUESTED', { jobId: job.id, runId: job.runId });
				active.controller.abort();
				if (active.pending) {
					await active.pending;
				}
			} else if (job.state === 'queued' || job.state === 'dispatched') {
				throw new AgentFailure('operation_unknown');
			}
		} else if (input.action === 'wait') {
			const deadline = Date.now() + input.waitSeconds * 1000;
			while ((job.state === 'queued' || job.state === 'dispatched') && Date.now() < deadline) {
				try {
					await delay(Math.max(1, Math.min(250, deadline - Date.now())), undefined, { signal });
				} catch (error) {
					if (signal.aborted) {
						throw new AgentFailure('provider_unavailable', { cause: error });
					}
					throw error;
				}
				await validate();
				job = await this.owned(scope, target, job.id);
			}
		}
		job = await this.owned(scope, target, job.id);
		await validate();
		const result = job.result;
		return JSON.stringify({
			jobId: job.id,
			state: job.state,
			revision: job.revision,
			result:
				result === null
					? null
					: result.status === 'not_started'
						? { status: result.status }
						: {
								status: result.status,
								exitCode: result.exitCode,
								signal: result.signal,
								stdout: result.stdout,
								stderr: result.stderr,
								truncated: result.truncated,
							},
			createdAt: job.createdAt,
			updatedAt: job.updatedAt,
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
