import type { ClockPort, JsonValue } from '../../agent.types';
import type { RootExecutionCommitPort } from '../runs/state-commit.port';
import type { RunSnapshot, RunUsage, RunView } from '../runs/run.types';

export class RootRunLifecycleCoordinator {
	constructor(
		private readonly stateCommit: RootExecutionCommitPort,
		private readonly clock: ClockPort,
	) {}

	retryBudgetReason(run: RunView, usage: RunUsage): JsonValue | null {
		const activeExecutionSeconds =
			run.activeExecutionSeconds +
			(run.executingRuntimeCount > 0 && run.activeExecutionStartedAt !== null
				? Math.max(0, this.clock.nowUnixSeconds() - run.activeExecutionStartedAt)
				: 0);
		const reason =
			usage.modelRequests >= Math.min(run.budget.maxModelRequests, run.budget.modelRequestCeiling)
				? 'model_request_limit'
				: activeExecutionSeconds >=
					  Math.min(run.budget.maxActiveExecutionSeconds, run.budget.activeExecutionCeilingSeconds)
					? 'active_time_limit'
					: null;
		if (!reason) return null;
		return {
			reason,
			retry: true,
			currentModelRequests: usage.modelRequests,
			requestedModelRequests: usage.modelRequests + 1,
			activeExecutionSeconds,
			maxActiveExecutionSeconds: run.budget.maxActiveExecutionSeconds,
		};
	}

	async reserveModelBudget(
		snapshot: RunSnapshot,
	): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>> | null> {
		const activeSeconds =
			snapshot.activeExecutionSeconds +
			(snapshot.executingRuntimeCount > 0 && snapshot.activeExecutionStartedAt !== null
				? Math.max(0, this.clock.nowUnixSeconds() - snapshot.activeExecutionStartedAt)
				: 0);
		const reason =
			snapshot.usage.modelRequests >= snapshot.budget.maxModelRequests
				? 'model_request_limit'
				: activeSeconds >= snapshot.budget.maxActiveExecutionSeconds
					? 'active_time_limit'
					: null;
		if (!reason) return null;

		return this.stopAtSafeBoundary(snapshot, reason);
	}

	async stopAtSafeBoundary(run: RunView, _reason: string) {
		const result = await this.stateCommit.interruptUnexpectedRootExecution({
			scope: { userId: run.userId, appId: run.appId },
			runId: run.id,
			errorCode: 'RUN_EXECUTION_LIMIT',
			now: this.clock.nowUnixSeconds(),
		});
		if (!result) throw new Error('RUN_NOT_SETTLEABLE');
		return result;
	}

	async failAtSafeBoundary(
		snapshot: RunSnapshot | RunView,
		code: string,
	): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>>> {
		const now = this.clock.nowUnixSeconds();
		return this.stateCommit.commit({
			scope: { userId: snapshot.userId, appId: snapshot.appId },
			runId: snapshot.id,
			expectedRunVersion: snapshot.version,
			events: [
				{ type: 'run.error', payload: { code } },
				{ type: 'run.status_changed', payload: { from: snapshot.status, to: 'failed' } },
			],
			runPatch: {
				status: 'failed',
				goalStatus: 'not_satisfied',
				verificationStatus: 'failed',
				completedAt: now,
			},
			now,
		});
	}

	async cancelAtSafeBoundary(
		snapshot: RunSnapshot | RunView,
	): Promise<Awaited<ReturnType<RootExecutionCommitPort['commit']>>> {
		const now = this.clock.nowUnixSeconds();
		return this.stateCommit.commit({
			scope: { userId: snapshot.userId, appId: snapshot.appId },
			runId: snapshot.id,
			expectedRunVersion: snapshot.version,
			events: [
				{ type: 'run.cancelled', payload: { reason: 'abort_signal' } },
				{ type: 'run.status_changed', payload: { from: snapshot.status, to: 'cancelled' } },
			],
			runPatch: { status: 'cancelled', completedAt: now },
			now,
		});
	}
}
