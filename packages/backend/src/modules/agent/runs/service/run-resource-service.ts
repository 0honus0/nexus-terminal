import { randomUUID } from 'node:crypto';
import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import type { ToolService } from '../../tools/service/tool-service.js';
import { AgentFailure, aggregateToolFailures } from '../../agent-failure.js';
import type { RunService } from './run-service.js';
import type { RunExecutionOwner } from './run-execution-owner.js';
import type { RunCollaborationService } from './run-collaboration-service.js';
import type { RunChanges } from '../model/run-changes.js';
import type {
	RunResourceScope,
	RunResourceSnapshot,
	CloseRunResources,
	CloseRunResourcesResult,
} from '../model/run-resource-types.js';

// User-selected inactivity period. In-flight tools and Jobs retain their resources.
const RESOURCE_IDLE_MS = 10 * 60 * 1000;

export class RunResourceService {
	private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly tasks = new Set<Promise<void>>();
	private closing = false;

	constructor(
		private readonly runs: RunService,
		private readonly execution: RunExecutionOwner,
		private readonly tools: ToolService,
		private readonly collaboration: RunCollaborationService,
		private readonly changes: RunChanges,
		private readonly logger?: Logger,
	) {}

	changed(scope: RunResourceScope): void {
		clearTimeout(this.timers.get(scope.runId));
		this.timers.delete(scope.runId);
		if (this.closing) {
			return;
		}
		const resource = this.tools.resource(scope);
		if (!resource || resource.phase !== 'idle' || this.tools.backgroundCount(scope) > 0) {
			return;
		}
		const timer = setTimeout(
			() => {
				if (this.timers.get(scope.runId) !== timer) {
					return;
				}
				this.timers.delete(scope.runId);
				const current = this.tools.resource(scope);
				if (
					!current ||
					current.id !== resource.id ||
					current.phase !== 'idle' ||
					this.tools.backgroundCount(scope) > 0
				) {
					return;
				}
				if (Date.now() < current.lastUsedAt + RESOURCE_IDLE_MS) {
					this.changed(scope);
					return;
				}
				// closeResource synchronously closes admission before yielding. The Run may continue thinking.
				const task = this.tools.closeResource(scope, resource.id);
				this.tasks.add(task);
				void task.then(
					() => this.tasks.delete(task),
					(error: unknown) => {
						logDiagnostic(
							this.logger,
							'error',
							'AGENT_RESOURCE_IDLE_CLEANUP_FAILED',
							{ runId: scope.runId },
							error,
						);
					},
				);
			},
			Math.max(0, resource.lastUsedAt + RESOURCE_IDLE_MS - Date.now()),
		);
		timer.unref();
		this.timers.set(scope.runId, timer);
	}

	read(scope: RunResourceScope, childIds: string[]): RunResourceSnapshot[] {
		return [scope.runId, ...childIds].flatMap((runId) => {
			const childScope = { userId: scope.userId, appId: scope.appId, runId };
			const resource = this.tools.resource(childScope);
			const backgroundJobs = this.tools.backgroundCount(childScope);
			return resource
				? [
						{
							resource,
							backgroundJobs,
							expiresAt:
								resource.phase === 'idle' && backgroundJobs === 0
									? resource.lastUsedAt + RESOURCE_IDLE_MS
									: null,
						},
					]
				: [];
		});
	}

	async closeResources(userId: number, appId: string, request: CloseRunResources): Promise<CloseRunResourcesResult> {
		if (this.closing) {
			throw new AgentFailure('provider_unavailable');
		}
		const target = request.target;
		const closed: CloseRunResourcesResult = {
			status: 'closed',
			activeRuns: 0,
			activeOperations: 0,
			backgroundJobs: 0,
		};

		const matches = () =>
			target.kind === 'app' ||
			this.tools.resource({ userId, appId, runId: target.runId })?.id === target.sessionId;

		if (!matches()) {
			return closed;
		}
		const ids =
			target.kind === 'app'
				? [
						...new Set([
							...this.execution.activeRoots(userId, appId),
							...this.tools.scopes(userId, appId).map((scope) => scope.runId),
						]),
					]
				: [target.runId];
		const roots = await Promise.all(
			ids.map(async (runId) => ({
				runId,
				children: await this.collaboration.listChildren({ userId, appId, runId }),
			})),
		);
		if (!matches()) {
			return closed;
		}
		const allIds = [
			...new Set(roots.flatMap(({ runId, children }) => [runId, ...(children?.map((child) => child.id) ?? [])])),
		];
		const runs = await Promise.all(allIds.map((runId) => this.runs.get(userId, appId, runId)));
		if (!matches()) {
			return closed;
		}
		const snapshots = this.read({ userId, appId, runId: '' }, allIds);
		const active = runs
			.filter((run) => run !== null)
			.filter((run) => run.status === 'pending' || run.status === 'running');
		const counts = {
			activeRuns: active.length,
			activeOperations: snapshots.reduce((n, value) => n + value.resource.operations, 0),
			backgroundJobs: snapshots.reduce((n, value) => n + value.backgroundJobs, 0),
		};
		if (!request.confirmed && (counts.activeRuns > 0 || counts.activeOperations > 0 || counts.backgroundJobs > 0)) {
			return { status: 'confirmation_required', ...counts };
		}
		// Bind the exact owners before cancellation/waits. Never close a replacement session.
		const owners = snapshots.map(({ resource }) => ({ runId: resource.runId, sessionId: resource.id }));
		const stopped = await Promise.allSettled(
			active.map((run) =>
				this.runs.cancelResource(
					userId,
					appId,
					run.id,
					owners.find((owner) => owner.runId === run.id)?.sessionId ?? randomUUID(),
				),
			),
		);
		const failures = stopped.flatMap((result) => {
			if (result.status === 'rejected') {
				return [result.reason];
			}
			// Completion racing a close needs no cancellation; all other refusals remain visible.
			return 'run' in result.value || result.value.status === 'active_run_conflict'
				? []
				: [new AgentFailure('version_conflict')];
		});
		const drained = await Promise.allSettled(
			allIds.map(async (runId) => {
				await this.execution.waitChildren([runId]);
				const owner = owners.find((value) => value.runId === runId);
				if (owner) {
					await this.tools.closeResource({ userId, appId, runId }, owner.sessionId);
				}
			}),
		);
		failures.push(...drained.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])));
		this.changes.notify(userId, appId);
		if (failures.length) {
			throw aggregateToolFailures(failures, 'Requested resource shutdown failed');
		}
		return { status: 'closed', ...counts };
	}

	quiesce(): void {
		this.closing = true;
		for (const timer of this.timers.values()) {
			clearTimeout(timer);
		}
		this.timers.clear();
	}

	async close(): Promise<void> {
		this.quiesce();
		const results = await Promise.allSettled(this.tasks);
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length) {
			throw aggregateToolFailures(failures, 'Resource idle cleanup failed');
		}
	}
}
