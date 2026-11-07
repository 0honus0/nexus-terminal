import { isAgentStorageStatementFailure } from '../../agent-failure.js';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic, withDiagnosticContext } from '../../../../platform/logging/diagnostic-log.js';
import type { OperationsEvents } from '../../../operations/public.js';
import type { RunExecutionJournal, RunExecutionSettlement } from '../model/run-execution-journal-types.js';
import type { RunRevocationRequest, RunFailure } from '../model/run-types.js';
import type { RunExecutionScope, RunDriver, RunExecutionHandle } from '../model/run-driver-types.js';
import { AgentFailure, ToolCleanupFailure, isAgentDrainFailure, aggregateToolFailures } from '../../agent-failure.js';

function hasCleanupFailure(error: unknown): boolean {
	return (
		error instanceof ToolCleanupFailure ||
		(error instanceof AggregateError && error.errors.some(hasCleanupFailure)) ||
		(error instanceof Error && error.cause !== undefined && hasCleanupFailure(error.cause))
	);
}

interface RunningTask {
	parentId: string | null;
	userId: number;
	appId: string;
	controller: AbortController;
	settled: Promise<void>;
	cleanupFailed: boolean;
}

/**
 * The single in-process owner of newly created Root and Child attempts.
 * Only fresh committed creates enter; persisted unknown/dispatched attempts are NEVER
 * scheduled on restart or replay. Bound drivers own their governed execution
 * inputs and dispatch checks; this owner retains the complete task lifetime.
 */
export class RunExecutionOwner {
	private readonly tasks = new Map<string, RunningTask>();
	private readonly admittedWrites = new Set<Promise<unknown>>();
	private pendingCreates = 0;
	private readonly failures: unknown[] = [];
	private excessFailures = 0;
	private closing = false;
	private closePromise: Promise<void> | null = null;

	activeRoots(userId: number, appId: string): string[] {
		return [...this.tasks]
			.filter(([, task]) => task.userId === userId && task.appId === appId && task.parentId === null)
			.map(([id]) => id);
	}

	getActiveRunCount(): number {
		return this.tasks.size;
	}

	getPendingWriteCount(): number {
		return this.admittedWrites.size;
	}

	constructor(
		private readonly runs: RunExecutionJournal,
		private readonly settlement: RunExecutionSettlement,
		private readonly events: OperationsEvents,
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
		if (this.closing) {
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
					if (this.tasks.size + this.pendingCreates - 1 >= maxRuns) {
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
	start(input: RunExecutionScope, driver: RunDriver, parentId: string | null = null): RunExecutionHandle | null {
		if (this.closing || this.tasks.has(input.runId)) {
			return null;
		}
		const command: RunExecutionScope = Object.freeze({
			userId: input.userId,
			appId: input.appId,
			runId: input.runId,
			version: input.version,
			requestHash: input.requestHash,
			deadlineAt: input.deadlineAt,
		});
		const boundDriver: RunDriver = Object.freeze({ execute: driver.execute.bind(driver) });
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
			controller,
			settled: Promise.resolve(),
			cleanupFailed: false,
		};
		this.tasks.set(command.runId, task);
		logDiagnostic(this.logger, 'info', 'AGENT_RUN_STARTED', {
			runId: command.runId,
			parentId,
		});
		// Own the rejection until shutdown; a failed/unknown durable commit is
		// never replayed by the in-memory task manager.
		task.settled = this.runs
			.ownExecutionTask(() =>
				withDiagnosticContext({ runId: command.runId }, () =>
					this.executeOwned(command, boundDriver, controller.signal),
				),
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
		return Object.freeze({
			cancel: (reason?: unknown) => controller.abort(reason),

			settled: task.settled,
		});
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

	/** A committed suspension may precede its local owner's last notification/finally. */
	async waitForSuspension(userId: number, appId: string, runId: string): Promise<void> {
		const task = this.tasks.get(runId);
		if (!task || task.userId !== userId || task.appId !== appId) {
			return;
		}
		const state = await this.runs.getExecutionState(userId, appId, runId);
		if (state?.status === 'suspended') {
			await task.settled;
		}
	}

	private failBackgroundTask(
		command: RunExecutionScope,
		signal: AbortSignal,
		failure: RunFailure,
		error: unknown,
	): void {
		let runId = command.runId;
		let task = this.tasks.get(runId);
		if (!task || task.controller.signal !== signal || signal.aborted) {
			return;
		}
		// A Child's unconfirmed effect also fences its Root and siblings. Resolve
		// only this exact live family; an old Job cannot interrupt a later Run.
		while (task && task.userId === command.userId && task.appId === command.appId) {
			this.runs.rememberFailure(command.userId, command.appId, runId, {
				code: failure.code,
				toolName: failure.toolName,
			});
			task.controller.abort(error);
			this.abort(command.userId, command.appId, runId);
			if (task.parentId === null) {
				break;
			}
			runId = task.parentId;
			task = this.tasks.get(runId);
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
					const current = request.uncertain
						? null
						: await this.runs.getExecutionState(task.userId, task.appId, id);
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

	private async executeOwned(command: RunExecutionScope, driver: RunDriver, signal: AbortSignal): Promise<void> {
		let failure: unknown = null;
		try {
			await driver.execute({
				scope: command,
				signal,

				onBackgroundFailure: (failure, error) => this.failBackgroundTask(command, signal, failure, error),
			});
		} catch (error) {
			failure = error;
			if (isAgentStorageStatementFailure(error)) {
				this.runs.rememberFailure(command.userId, command.appId, command.runId, {
					code: 'execution_storage_failed',
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
				const failures: unknown[] = [];
				try {
					const state = await this.runs.getExecutionState(command.userId, command.appId, command.runId);
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
				} catch (error) {
					failures.push(error);
				}
				if (failures.length) {
					throw aggregateToolFailures(failures, 'Run resource drain or terminal notification failed');
				}
			} catch (cleanup) {
				if (failure !== null) {
					throw new AggregateError([failure, cleanup], 'Root and Jobs failed');
				}
				throw cleanup;
			}
		}
	}

	failUnstarted(command: RunExecutionScope): Promise<boolean> {
		return this.settlement.failUnstarted({
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			expectedVersion: command.version,
			creationHash: command.requestHash,
			now: Date.now(),
		});
	}
}
