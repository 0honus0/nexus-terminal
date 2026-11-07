import { runFailureCode } from '../run-failure-rules.js';
import type { RunUnstartedFailure, RunUsage } from './run-types.js';
import type { RunAppMutation, RunAppResult, RunAppTerminal } from './run-app-types.js';
import { AgentFailure } from '../../agent-failure.js';
import type { RunFailure } from './run-types.js';
import type { RunExecutionState } from './run-execution-journal-types.js';
import { RunChanges } from './run-changes.js';
import { toPolicyOverrides } from '../../governance/model/governance-model.js';
import type { PolicyOverrides } from '../../governance/model/governance-types.js';
import type { ExecutionSettings } from '../../execution/model/execution-types.js';
import { fromSettings, toSettings } from '../../execution/model/execution-projection.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { RunAppAuthority } from './run-types.js';
import type { RunStorage } from '../storage/run-storage.js';
import { mayCreateRootRun, decideCancelRootRun } from '../run-rules.js';

import { fromStoredRun, fromStoredEvent, fromStoredFrozen } from './run-projection.js';
import type { RunFrozenInput } from './run-types.js';
import type { ResumeRunRequest, AdmittedRunResume, RunSuspension } from './run-resume-types.js';

import type {
	CreateRootRunCommand,
	CancelRootRunCommand,
	AgentRun,
	CreateRunResult,
	CancelRunResult,
	RunEventPage,
	RunPage,
} from './run-types.js';

export class RunModel {
	/** Advisory diagnostics only; eviction never rejects execution or changes durable status. */
	private readonly failures = new Map<string, { userId: number; appId: string; failure: RunFailure }>();

	rememberFailure(userId: number, appId: string, runId: string, failure: RunFailure): void {
		if (this.failures.has(runId)) {
			return;
		}
		if (this.failures.size >= 512) {
			const oldest = this.failures.keys().next();
			if (!oldest.done) {
				this.failures.delete(oldest.value);
			}
		}
		this.failures.set(runId, { userId, appId, failure: { code: failure.code, toolName: failure.toolName } });
	}

	constructor(
		private readonly storage: RunStorage,
		private readonly changes = new RunChanges(),
	) {}

	failUnstarted(command: RunUnstartedFailure): Promise<boolean> {
		return this.changes.after(command, () =>
			agentStorage(() =>
				this.storage.failUnstarted({
					userId: command.userId,
					appId: command.appId,
					runId: command.runId,
					expectedVersion: command.expectedVersion,
					creationHash: command.creationHash,
					now: command.now,
				}),
			),
		);
	}

	recover(now: number): Promise<number> {
		return agentStorage(() => this.storage.recover(now));
	}

	async resume(
		command: ResumeRunRequest,
		requestHash: string,
		admit: (settings: ExecutionSettings | null, activeRuns: number) => void,
	): Promise<AdmittedRunResume> {
		const result = await this.changes.after(command, () =>
			agentStorage(() =>
				this.storage.resume(
					{
						userId: command.userId,
						appId: command.appId,
						runId: command.runId,
						expectedVersion: command.expectedVersion,
						operationKey: command.operationKey,
						requestHash,
						inputJson: command.inputJson,
					},
					(settings, activeRuns) => admit(settings === null ? null : fromSettings(settings), activeRuns),
				),
			),
		);
		if (result.status === 'resumed') {
			return {
				status: 'resumed',
				run: fromStoredRun(result.run),
				parentId: result.parentId,
				command: {
					userId: command.userId,
					appId: command.appId,
					runId: command.runId,
					version: result.run.version,
					requestHash: result.requestHash,
					inputJson: result.inputJson,
					deadlineAt: result.deadlineAt,
					prompt: result.prompt,
				},
			};
		}
		return result.status === 'replayed'
			? { status: 'replayed', originalStatus: 'resumed', run: fromStoredRun(result.run) }
			: { status: result.status };
	}

	async suspension(userId: number, appId: string, runId: string): Promise<RunSuspension | null> {
		const result = await agentStorage(() => this.storage.suspension(userId, appId, runId));
		return result === null
			? null
			: {
					runId: result.runId,
					runVersion: result.runVersion,
					checkpointVersion: result.checkpointVersion,
					inputRequest: {
						id: result.inputRequest.id,
						sha256: result.inputRequest.sha256,
						sizeBytes: result.inputRequest.sizeBytes,
						mediaType: result.inputRequest.mediaType,
					},
					suspendedAt: result.suspendedAt,
				};
	}

	async usage(userId: number, appId: string, runId: string): Promise<RunUsage | null> {
		const value = await agentStorage(() => this.storage.usage(userId, appId, runId));
		return value === null
			? null
			: {
					runId: value.runId,
					runVersion: value.runVersion,
					inputTokens: value.inputTokens,
					outputTokens: value.outputTokens,
					reportedModelRequests: value.reportedModelRequests,
					modelRequests: value.modelRequests,
					toolExecutions: value.toolExecutions,
				};
	}

	ownExecutionTask(work: () => Promise<void>): Promise<void> {
		try {
			return this.storage.ownExecution(work);
		} catch (error) {
			return agentStorage(async () => {
				throw error;
			});
		}
	}

	async getExecutionState(userId: number, appId: string, runId: string): Promise<RunExecutionState | null> {
		const value = await agentStorage(() => this.storage.get(userId, appId, runId));
		return value === null ? null : { id: value.id, status: value.status, version: value.version };
	}

	async list(userId: number, appId: string, threadId: string, after: number, limit: number): Promise<RunPage | null> {
		const value = await agentStorage(() => this.storage.list(userId, appId, threadId, after, limit));
		return value === null ? null : { items: value.items.map(fromStoredRun), nextCursor: value.nextCursor };
	}

	async create(
		command: CreateRootRunCommand,
		authorizeApp: (current: RunAppAuthority) => void,
		authorizeOrigin: (current: AgentRun | null) => void,
		freezeExecution: (
			current: ExecutionSettings | null,
			activeRuns: number,
			overrides: PolicyOverrides,
		) => ExecutionSettings,
	): Promise<CreateRunResult> {
		const result = await this.changes.after(
			{ userId: command.userId, appId: command.appId, runId: command.id, threadId: command.threadId },
			() =>
				agentStorage(() =>
					this.storage.create(
						{
							origin:
								command.origin === null
									? null
									: { runId: command.origin.runId, expectedVersion: command.origin.expectedVersion },
							inputJson: command.inputJson,
							id: command.id,
							userId: command.userId,
							appId: command.appId,
							threadId: command.threadId,
							inputText: command.prompt,
							approvalMode: command.approvalMode,
							connectionIds: command.connectionIds.map((id) => id),
							operationKey: command.operationKey,
							requestHash: command.requestHash,
						},
						(active) =>
							mayCreateRootRun(
								active === null ? null : { status: active.status, version: active.version },
							),

						(current) => authorizeApp({ enabled: current.enabled, declared: current.declared }),
						(current) => authorizeOrigin(current === null ? null : fromStoredRun(current)),

						(current, activeRuns, overrides) =>
							toSettings(
								freezeExecution(
									current === null ? null : fromSettings(current),
									activeRuns,
									toPolicyOverrides(overrides),
								),
							),
					),
				),
		);
		if (result.status === 'replayed') {
			return { status: 'replayed', originalStatus: result.originalStatus, run: fromStoredRun(result.run) };
		}
		if (result.status === 'created') {
			return { status: 'created', run: fromStoredRun(result.run) };
		}
		return { status: result.status };
	}

	async cancel(command: CancelRootRunCommand): Promise<CancelRunResult> {
		// Frozen definition remains immutable even when Run cancellation succeeds.
		const result = await this.changes.after(command, () =>
			agentStorage(() =>
				this.storage.cancel(
					{
						userId: command.userId,
						appId: command.appId,
						runId: command.runId,
						operationKey: command.operationKey,
						requestHash: command.requestHash,
					},
					(run) =>
						decideCancelRootRun(
							{ status: run.status, version: run.version },
							command.expectedVersion === 'current' ? run.version : command.expectedVersion,
						),
				),
			),
		);
		if (result.status === 'replayed') {
			return { status: 'replayed', originalStatus: result.originalStatus, run: fromStoredRun(result.run) };
		}
		if (result.status === 'cancelled' || result.status === 'already_cancelled') {
			return { status: result.status, run: fromStoredRun(result.run) };
		}
		return { status: result.status };
	}

	async get(userId: number, appId: string, runId: string): Promise<AgentRun | null> {
		const value = await agentStorage(() => this.storage.get(userId, appId, runId));
		if (value === null) {
			return null;
		}
		const run = fromStoredRun(value);
		if (run.status === 'failed' || run.status === 'unknown') {
			const diagnostic = await agentStorage(() => this.storage.failure(userId, appId, runId));
			const failure: RunFailure | null =
				diagnostic === null
					? null
					: diagnostic.kind === 'job_unknown'
						? { code: 'tool_result_unconfirmed', toolName: diagnostic.toolName }
						: {
								code: runFailureCode(new AgentFailure(diagnostic.code), true),
								toolName: diagnostic.toolName,
							};
			const remembered = this.failures.get(runId);
			if (failure !== null && failure.code !== 'tool_failed') {
				run.failure = { code: failure.code, toolName: failure.toolName };
			} else if (remembered?.userId === userId && remembered.appId === appId) {
				run.failure = { code: remembered.failure.code, toolName: remembered.failure.toolName };
			} else {
				run.failure = failure === null ? null : { code: failure.code, toolName: failure.toolName };
			}
		}
		return run;
	}

	startApp(command: RunAppMutation): Promise<RunAppResult> {
		return this.changes.after(command, async () => {
			const result = await agentStorage(() =>
				this.storage.startApp({
					userId: command.userId,
					appId: command.appId,
					runId: command.runId,
					creationHash: command.creationHash,
					executionGeneration: command.executionGeneration,
					expectedVersion: command.expectedVersion,
					now: Date.now(),
				}),
			);
			return result.status === 'ok' ? { status: 'ok', version: result.version } : { status: result.status };
		});
	}

	finishApp(command: RunAppMutation, terminal: RunAppTerminal): Promise<RunAppResult> {
		return this.changes.after(command, async () => {
			const result = await agentStorage(() =>
				this.storage.finishApp(
					{
						userId: command.userId,
						appId: command.appId,
						runId: command.runId,
						creationHash: command.creationHash,
						executionGeneration: command.executionGeneration,
						expectedVersion: command.expectedVersion,
						now: Date.now(),
					},
					terminal.state === 'completed'
						? { state: 'completed', outputJson: terminal.outputJson }
						: terminal.state === 'suspended'
							? {
									state: 'suspended',
									checkpointVersion: terminal.checkpointVersion,
									inputRequest: {
										id: terminal.inputRequest.id,
										sha256: terminal.inputRequest.sha256,
										sizeBytes: terminal.inputRequest.sizeBytes,
										mediaType: terminal.inputRequest.mediaType,
									},
								}
							: { state: terminal.state },
				),
			);
			return result.status === 'ok' ? { status: 'ok', version: result.version } : { status: result.status };
		});
	}

	async frozen(userId: number, appId: string, runId: string): Promise<RunFrozenInput | null> {
		const stored = await agentStorage(() => this.storage.frozen(userId, appId, runId));
		return stored === null ? null : fromStoredFrozen(stored);
	}

	async listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPage | null> {
		const result = await agentStorage(() => this.storage.listEvents(userId, appId, runId, after, limit));
		if (result === null) {
			return null;
		}
		return { items: result.items.map(fromStoredEvent), nextCursor: result.nextCursor };
	}
}
