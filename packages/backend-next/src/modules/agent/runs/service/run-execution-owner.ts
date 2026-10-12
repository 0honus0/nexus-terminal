import type { RunModel } from '../model/run-model.js';
import type { RunStepModel } from '../model/run-step-model.js';
import type { RunModelStream } from '../model/run-model-stream.js';
import type { RunStepMutation, RunModelStep, RunExecutionCommand } from '../model/run-types.js';
import type { ProviderModel } from '../../providers/model/provider-model.js';
import type { ProviderRecord } from '../../providers/model/provider-types.js';
import { AgentFailure, ProviderRequestFailure } from '../../agent-failure.js';

/** Technical upper bound for one attempt, not permission to execute it. */
const RUN_ATTEMPT_DEADLINE_MS = 5 * 60 * 1000;
const MAX_RUN_ATTEMPTS = 8;
const MAX_PENDING_RUN_WRITES = 64;

function hasCleanupFailure(error: unknown): boolean {
	return (
		(error instanceof ProviderRequestFailure && error.errorCode === 'PROVIDER_STREAM_CLEANUP_FAILED') ||
		(error instanceof AggregateError && error.errors.some(hasCleanupFailure))
	);
}

interface RunningTask {
	userId: number;
	appId: string;
	providerId: string;
	controller: AbortController;
	settled: Promise<void>;
	cleanupFailed: boolean;
}

/**
 * The single in-process owner of a newly created Root Run's model attempt.
 * Only fresh creates enter; persisted unknown/dispatched attempts are NEVER
 * scheduled on restart or replay. The B6/B7 frozen policy currently denies
 * every attempt before reservation, so no model traffic is enabled by this.
 */
export class RunExecutionOwner {
	private readonly tasks = new Map<string, RunningTask>();
	private readonly admittedWrites = new Set<Promise<unknown>>();
	private pendingCreates = 0;
	private readonly failures: unknown[] = [];
	private excessFailures = 0;
	private closing = false;
	private closePromise: Promise<void> | null = null;

	constructor(
		private readonly runs: RunModel,
		private readonly steps: RunStepModel,
		private readonly stream: RunModelStream,
		private readonly providers: ProviderModel,
	) {}

	private recordFailure(error: unknown): void {
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
		} finally {
			this.admittedWrites.delete(pending);
		}
	}

	/** Reserve local attempt capacity before creating a durable Run, including in-flight creates. */
	async admitCreate<T>(work: () => Promise<T>): Promise<T> {
		if (this.tasks.size + this.pendingCreates >= MAX_RUN_ATTEMPTS) {
			throw new AgentFailure('provider_unavailable');
		}
		this.pendingCreates++;
		try {
			return await this.admitWrite(work);
		} finally {
			this.pendingCreates--;
		}
	}

	/** Call exactly once after a newly committed create, never for an idempotent replay. */
	start(command: RunExecutionCommand): void {
		if (this.closing || this.tasks.has(command.runId)) {
			return;
		}
		const controller = new AbortController();
		const deadline = setTimeout(
			() => controller.abort(new Error('Root Run attempt deadline exceeded')),
			RUN_ATTEMPT_DEADLINE_MS,
		);
		const task: RunningTask = {
			userId: command.userId,
			appId: command.appId,
			providerId: command.providerId,
			controller,
			settled: Promise.resolve(),
			cleanupFailed: false,
		};
		this.tasks.set(command.runId, task);
		// Own the rejection until shutdown; a failed/unknown durable commit is
		// never replayed by the in-memory task manager.
		task.settled = this.execute(command, controller.signal)
			.catch((error: unknown) => {
				task.cleanupFailed = hasCleanupFailure(error);
				this.recordFailure(error);
				throw error;
			})
			.finally(() => {
				clearTimeout(deadline);
				if (!task.cleanupFailed && this.tasks.get(command.runId) === task) {
					this.tasks.delete(command.runId);
				}
			});
		// A cleanup failure retains its occupied slot; observing rejection is not release evidence.
		void task.settled.catch(() => undefined);
	}

	/** Cancel after the authoritative DB fence; never wait before fencing. */
	abort(userId: number, appId: string, runId: string): void {
		const task = this.tasks.get(runId);
		if (task?.userId === userId && task.appId === appId) {
			task.controller.abort();
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
			const writes = await Promise.allSettled([...this.admittedWrites]);
			for (const result of writes) {
				if (result.status === 'rejected' && !(result.reason instanceof AgentFailure)) {
					// An admitted write may have reached COMMIT even when its caller
					// receives an unexpected error. Preserve that uncertainty without
					// coupling this Service to the technical SQLite error taxonomy or
					// treating normal application rejections as shutdown failures.
					this.recordFailure(result.reason);
				}
			}
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
			requestHash: command.requestHash,
			now: Date.now(),
		};
	}

	private async execute(command: RunExecutionCommand, signal: AbortSignal): Promise<void> {
		const frozen = await this.runs.frozen(command.userId, command.appId, command.runId);
		// This is an actual persisted-policy boundary, not a default-allow or
		// temporary approval flag. No task, budget, or Provider probe grants it.
		if (!frozen || frozen.executionPolicy === 'awaiting_b6_b7' || signal.aborted) {
			return;
		}

		const reserved = await this.steps.reserve({
			userId: command.userId,
			appId: command.appId,
			runId: command.runId,
			stepIndex: 1,
			expectedRunVersion: command.version,
			requestHash: command.requestHash,
			now: Date.now(),
		});
		if (reserved.status !== 'ok') {
			return;
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
			return;
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
			// Credential reads and Provider checks happen strictly before the
			// dispatch intent. The settlement is OUTSIDE the provider try block
			// on the normal rejection path, so a failed CAS cannot be retried by
			// inadvertently catching its own failure.
			try {
				await failUndispatched();
			} catch (settlementError) {
				throw new AggregateError([error, settlementError], 'Provider check and undispatched settlement failed');
			}
			if (error instanceof AgentFailure) {
				return;
			}
			throw error;
		}
		if (!provider || signal.aborted) {
			await failUndispatched();
			return;
		}
		const dispatched = await this.steps.dispatch(this.mutation(command, reserved.step));
		// A thrown DB commit or a non-ok CAS is NOT permission to re-dispatch.
		if (dispatched.status !== 'ok') {
			// The storage returned a definite non-dispatch. Another writer may
			// already have fenced the step; the original CAS then returns stale.
			// In contrast, a thrown commit_unknown above is never settled here.
			await failUndispatched();
			return;
		}
		let current = dispatched.step;
		let resourceCleanupFailure: ProviderRequestFailure | null = null;

		try {
			// Dispatch awaited SQLite; reread revocation before opening the network.
			await this.providers.guardCurrent(provider);
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			for await (const event of this.stream.stream(frozen, command.prompt, credential, signal)) {
				// Also fence configuration changes made by a different server process.
				await this.providers.guardCurrent(provider);
				if (signal.aborted) {
					break; // Wait for iterator.return() and transport cleanup.
				}
				if (event.kind === 'finished') {
					const result = await this.steps.finish(this.mutation(command, current), { state: 'completed' });
					if (result.status !== 'ok') {
						return;
					}
					return;
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
					return;
				} // Cancel or concurrent terminal fenced this task.
				current = result.step;
				// Abort may arrive while SQLite is settling the last delta. Do not
				// ask the provider for another chunk; for-await break awaits the
				// iterator's resource cleanup before the unknown-state CAS.
				if (signal.aborted) {
					break;
				}
			}
		} catch (error) {
			if (!(error instanceof AgentFailure)) {
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
		try {
			await this.steps.finish(this.mutation(command, current), { state: 'unknown' });
		} catch (error) {
			if (resourceCleanupFailure) {
				throw new AggregateError(
					[resourceCleanupFailure, error],
					'Stream cleanup and unknown settlement failed',
				);
			}
			throw error;
		}
		// Cleanup failed despite the durable unknown terminal. Keep the cause
		// observable to the owning module's shutdown, not just the model decoder.
		if (resourceCleanupFailure) {
			throw resourceCleanupFailure;
		}
	}
}
