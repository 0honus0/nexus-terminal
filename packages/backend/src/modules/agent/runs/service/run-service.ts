import type { ExecutionService } from '../../execution/service/execution-service.js';

import type { RunCollaborationService } from './run-collaboration-service.js';
import { AGENT_RUN_MAX_PROMPT_BYTES, AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';

import { AGENT_TOOL_LIST_MAX_LIMIT } from '@nexus-terminal/shared/agent/tools/values';
import type {
	OperationActivityCursor,
	OperationActivityPage,
	OperationActivity,
} from '../../operations/model/operation-activity-types.js';
import type { OperationActivityModel } from '../../operations/model/operation-activity-model.js';
import { createHash, randomUUID } from 'node:crypto';
import type { RunModel } from '../model/run-model.js';
import type { RunExecutionOwner } from './run-execution-owner.js';
import type { RunAppDrivers } from '../drivers/run-app-drivers.js';
import type {
	RunUsage,
	AgentRun,
	CreateRunResult,
	RunFrozenInput,
	CancelRunResult,
	RunEventPage,
	CreateRunRequest,
	CancelRunRequest,
} from '../model/run-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { validateAgentId, validateOperationKey, validateUserId } from '../../agent-validation.js';
import type { ResumeRunRequest, ResumeRunResult, RunSuspension } from '../model/run-resume-types.js';

function validateScope(userId: number, appId: string): void {
	validateUserId(userId);
	validateAgentId(appId);
}

function validatePrompt(prompt: string): void {
	if (typeof prompt !== 'string' || Buffer.byteLength(prompt, 'utf8') > AGENT_RUN_MAX_PROMPT_BYTES) {
		throw new AgentFailure('invalid_input');
	}
}

function validateCursor(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new AgentFailure('invalid_input');
	}
}

function hashCommand(name: 'create_run' | 'cancel_run' | 'resume_run', value: readonly (string | number)[]): string {
	// Every field has a fixed position and schema version, including expectedVersion.
	// JSON.stringify is unambiguous for these validated scalar inputs.
	return createHash('sha256')
		.update(JSON.stringify([1, name, ...value]), 'utf8')
		.digest('hex');
}

export class RunService {
	constructor(
		private readonly model: RunModel,
		private readonly execution: RunExecutionOwner,
		private readonly appDrivers: RunAppDrivers,
		private readonly activities: OperationActivityModel,
		private readonly collaboration: RunCollaborationService,
		private readonly settings: ExecutionService,
	) {}

	list(
		userId: number,
		appId: string,
		threadId: string,
		after: number,
		limit: number,
	): Promise<import('../model/run-types.js').RunPage | null> {
		validateScope(userId, appId);
		validateAgentId(threadId);
		validateCursor(after);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_RUN_EVENT_MAX_LIMIT) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.list(userId, appId, threadId, after, limit);
	}

	async cancelChild(request: CancelRunRequest, childId: string): Promise<CancelRunResult> {
		validateScope(request.userId, request.appId);
		validateAgentId(request.runId);
		validateAgentId(childId);
		if (
			!(await this.collaboration.child(
				{ userId: request.userId, appId: request.appId, runId: request.runId },
				childId,
			))
		) {
			return { status: 'not_found' };
		}
		return this.cancel({
			userId: request.userId,
			appId: request.appId,
			runId: childId,
			expectedVersion: request.expectedVersion,
			operationKey: request.operationKey,
		});
	}

	create(request: CreateRunRequest): Promise<CreateRunResult> {
		return this.createRoot(request, null);
	}

	suspension(userId: number, appId: string, runId: string): Promise<RunSuspension | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.model.suspension(userId, appId, runId);
	}

	async resume(request: ResumeRunRequest): Promise<ResumeRunResult> {
		validateScope(request.userId, request.appId);
		validateAgentId(request.runId);
		validateOperationKey(request.operationKey);
		if (
			!Number.isSafeInteger(request.expectedVersion) ||
			request.expectedVersion < 1 ||
			request.expectedVersion >= Number.MAX_SAFE_INTEGER
		) {
			throw new AgentFailure('invalid_input');
		}
		let inputJson: string;
		try {
			inputJson = JSON.stringify(JSON.parse(request.inputJson));
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}
		const requestHash = hashCommand('resume_run', [
			request.appId,
			request.runId,
			request.expectedVersion,
			inputJson,
		]);
		await this.execution.waitForSuspension(request.userId, request.appId, request.runId);
		const settings = await this.settings.get(request.userId);
		return this.execution.admitCreate(async (admit) => {
			const result = await this.model.resume(
				{
					userId: request.userId,
					appId: request.appId,
					runId: request.runId,
					expectedVersion: request.expectedVersion,
					operationKey: request.operationKey.toLowerCase(),
					inputJson,
				},
				requestHash,
				(current, activeRuns) => {
					admit();
					if (!current?.enabled) {
						throw new AgentFailure('execution_disabled');
					}
					if (Math.max(activeRuns, this.execution.occupiedSlots() - 1) >= current.limits.maxConcurrentRuns) {
						throw new AgentFailure('limit_exceeded');
					}
				},
			);
			if (result.status === 'resumed') {
				if (!this.appDrivers.start(this.execution, result.command, result.parentId)) {
					await this.execution.failUnstarted(result.command);
				}
				return { status: 'resumed', run: result.run };
			}
			return result;
		}, settings.limits.maxConcurrentRuns);
	}

	appendInput(request: CreateRunRequest, sourceRunId: string, expectedVersion: number): Promise<CreateRunResult> {
		validateAgentId(sourceRunId);
		if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
			throw new AgentFailure('invalid_input');
		}
		return this.createRoot(request, { runId: sourceRunId, expectedVersion });
	}

	private async createRoot(
		request: CreateRunRequest,
		origin: { runId: string; expectedVersion: number } | null,
	): Promise<CreateRunResult> {
		validateScope(request.userId, request.appId);
		validateAgentId(request.threadId);
		validateOperationKey(request.operationKey);
		validatePrompt(request.prompt);
		if (request.approvalMode !== 'ask' && request.approvalMode !== 'full_access') {
			throw new AgentFailure('invalid_input');
		}
		let inputJson: string;
		try {
			inputJson = JSON.stringify(JSON.parse(request.inputJson));
		} catch (cause) {
			throw new AgentFailure('invalid_input', { cause });
		}

		if (
			!Array.isArray(request.connectionIds) ||
			new Set(request.connectionIds).size !== request.connectionIds.length ||
			request.connectionIds.some((id) => !Number.isSafeInteger(id) || id < 1)
		) {
			throw new AgentFailure('invalid_input');
		}
		const connectionIds = request.connectionIds.slice().sort((a, b) => a - b);
		const requestHash = hashCommand('create_run', [
			request.appId,
			request.threadId,
			request.prompt,
			inputJson,
			request.approvalMode,
			JSON.stringify(connectionIds),
			JSON.stringify(origin),
		]);
		const settings = await this.settings.get(request.userId);
		return this.execution.admitCreate(async (admit) => {
			let activeSeconds = settings.limits.maxActiveSeconds;
			const created = await this.model.create(
				{
					origin,
					inputJson,
					approvalMode: request.approvalMode,
					connectionIds,
					userId: request.userId,
					appId: request.appId,
					threadId: request.threadId,
					id: randomUUID(),
					prompt: request.prompt,
					operationKey: request.operationKey.toLowerCase(),
					requestHash,
				},
				(authority) => {
					if (!authority.enabled || !authority.declared) {
						throw new AgentFailure('app_disabled');
					}
				},
				(current) => {
					if (current === null || origin === null) {
						throw new AgentFailure('not_found');
					}
					if (current.version !== origin.expectedVersion) {
						throw new AgentFailure('version_conflict');
					}
					if (
						current.status !== 'completed' &&
						current.status !== 'failed' &&
						current.status !== 'cancelled'
					) {
						throw new AgentFailure('active_run_conflict');
					}
				},
				(current, activeRuns, overrides) => {
					admit();
					const frozen = this.settings.freeze(current, overrides);
					activeSeconds = frozen.limits.maxActiveSeconds;
					if (Math.max(activeRuns, this.execution.occupiedSlots() - 1) >= frozen.limits.maxConcurrentRuns) {
						throw new AgentFailure('limit_exceeded');
					}
					return frozen;
				},
			);
			if (created.status === 'created') {
				// A replay, stale Provider or unknown DB commit must never start a
				// second paid request. The execution owner checks frozen authorization.
				const command: import('../model/run-types.js').RunExecutionCommand = {
					deadlineAt: created.run.createdAt + activeSeconds * 1000,
					userId: request.userId,
					appId: request.appId,
					runId: created.run.id,
					inputJson,
					version: created.run.version,
					prompt: request.prompt,
					requestHash,
				};
				if (!this.appDrivers.start(this.execution, command)) {
					try {
						await this.execution.failUnstarted(command);
					} catch (error) {
						throw new AgentFailure('operation_unknown', { cause: error });
					}
				}
			}
			return created;
		}, settings.limits.maxConcurrentRuns);
	}

	async cancel(request: CancelRunRequest): Promise<CancelRunResult> {
		// Run cancellation preserves its immutable model snapshot for subsequent audit.
		validateScope(request.userId, request.appId);
		validateAgentId(request.runId);
		validateOperationKey(request.operationKey);
		if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1) {
			throw new AgentFailure('invalid_input');
		}
		return this.cancelOwned(request);
	}

	cancelResource(userId: number, appId: string, runId: string, sessionId: string): Promise<CancelRunResult> {
		validateScope(userId, appId);
		validateAgentId(runId);
		validateOperationKey(sessionId);
		return this.cancelOwned({ userId, appId, runId, operationKey: sessionId, expectedVersion: 'current' });
	}

	private async cancelOwned(request: {
		userId: number;
		appId: string;
		runId: string;
		operationKey: string;
		expectedVersion: number | 'current';
	}): Promise<CancelRunResult> {
		const requestHash = hashCommand('cancel_run', [request.appId, request.runId, request.expectedVersion]);
		return this.execution.admitWrite(async () => {
			let result: CancelRunResult;
			try {
				result = await this.model.cancel({
					userId: request.userId,
					appId: request.appId,
					runId: request.runId,
					expectedVersion: request.expectedVersion,
					operationKey: request.operationKey.toLowerCase(),
					requestHash,
				});
			} catch (error) {
				// A failed/unknown cancel commit does not prove its DB fence was
				// absent. Abort the local attempt rather than pay for more tokens;
				// its own CAS then conservatively settles unknown if still running.
				this.execution.abort(request.userId, request.appId, request.runId);
				throw error;
			}
			// Fence the step and parent in SQLite FIRST. Abort only after the
			// authoritative cancellation has committed or replayed as cancelled.
			if ('run' in result && result.run.status === 'cancelled') {
				this.execution.abort(request.userId, request.appId, request.runId);
			}
			return result;
		});
	}

	get(userId: number, appId: string, runId: string): Promise<AgentRun | null> {
		// Public status does not expose frozen Provider credentials or endpoint.
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.model.get(userId, appId, runId);
	}

	getToolCall(userId: number, appId: string, runId: string, toolId: string): Promise<OperationActivity | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		validateAgentId(toolId);
		return this.activities.get(userId, appId, runId, toolId);
	}

	listThreadTools(
		userId: number,
		appId: string,
		threadId: string,
		before: OperationActivityCursor | null,
		limit: number,
	): Promise<OperationActivityPage | null> {
		validateScope(userId, appId);
		validateAgentId(threadId);
		if (
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > AGENT_TOOL_LIST_MAX_LIMIT ||
			(before !== null && (!Number.isSafeInteger(before.createdAt) || before.createdAt < 0))
		) {
			throw new AgentFailure('invalid_input');
		}
		if (before !== null) {
			validateAgentId(before.id);
		}
		return this.activities.list(userId, appId, threadId, before, limit);
	}

	frozen(userId: number, appId: string, runId: string): Promise<RunFrozenInput | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.model.frozen(userId, appId, runId);
	}

	listEvents(
		userId: number,
		appId: string,
		runId: string,
		after: number,
		limit: number,
	): Promise<RunEventPage | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		validateCursor(after);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_RUN_EVENT_MAX_LIMIT) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.listEvents(userId, appId, runId, after, limit);
	}

	getUsage(userId: number, appId: string, runId: string): Promise<RunUsage | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		return this.model.usage(userId, appId, runId);
	}
}
