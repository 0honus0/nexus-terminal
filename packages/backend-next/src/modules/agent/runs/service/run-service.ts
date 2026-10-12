import { AGENT_RUN_MAX_PROMPT_BYTES, AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_PROVIDER_MAX_MODEL_ID_BYTES } from '@nexus-terminal/shared/agent/providers/values';
import { createHash, randomUUID } from 'node:crypto';
import type { RunModel } from '../model/run-model.js';
import type { RunStepModel } from '../model/run-step-model.js';
import type { RunExecutionOwner } from './run-execution-owner.js';
import type {
	AgentRun,
	CreateRunResult,
	RunFrozenInput,
	CancelRunResult,
	RunEventPage,
	CreateRunRequest,
	CancelRunRequest,
	RunModelStep,
	RunStepEventPage,
} from '../model/run-types.js';
import { AgentFailure } from '../../agent-failure.js';
import { validateAgentId, validateOperationKey, validateUserId } from '../../agent-validation.js';

function validateScope(userId: number, appId: string): void {
	validateUserId(userId);
	validateAgentId(appId);
}

function validatePrompt(prompt: string): void {
	if (
		typeof prompt !== 'string' ||
		!prompt.trim() ||
		Buffer.byteLength(prompt, 'utf8') > AGENT_RUN_MAX_PROMPT_BYTES
	) {
		throw new AgentFailure('invalid_input');
	}
}

function validateCursor(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new AgentFailure('invalid_input');
	}
}

function hashCommand(name: 'create_run' | 'cancel_run', value: readonly (string | number)[]): string {
	// Every field has a fixed position and schema version, including expectedVersion.
	// JSON.stringify is unambiguous for these validated scalar inputs.
	return createHash('sha256')
		.update(JSON.stringify([1, name, ...value]), 'utf8')
		.digest('hex');
}

export class RunService {
	constructor(
		private readonly model: RunModel,
		private readonly steps: RunStepModel,
		private readonly execution: RunExecutionOwner,
	) {}

	async create(request: CreateRunRequest): Promise<CreateRunResult> {
		validateScope(request.userId, request.appId);
		validateAgentId(request.threadId);
		validateOperationKey(request.operationKey);
		validatePrompt(request.prompt);
		if (!request.model) {
			throw new AgentFailure('invalid_input');
		}
		validateAgentId(request.model.providerId);
		if (
			typeof request.model.modelId !== 'string' ||
			!request.model.modelId.trim() ||
			Buffer.byteLength(request.model.modelId, 'utf8') > AGENT_PROVIDER_MAX_MODEL_ID_BYTES ||
			!Number.isSafeInteger(request.model.configurationVersion) ||
			request.model.configurationVersion < 1
		) {
			throw new AgentFailure('invalid_input');
		}
		const model = {
			providerId: request.model.providerId,
			modelId: request.model.modelId,
			configurationVersion: request.model.configurationVersion,
		};
		const requestHash = hashCommand('create_run', [
			request.appId,
			request.threadId,
			request.prompt,
			model.providerId,
			model.modelId,
			model.configurationVersion,
		]);
		return this.execution.admitCreate(async () => {
			const created = await this.model.create({
				model,
				userId: request.userId,
				appId: request.appId,
				threadId: request.threadId,
				id: randomUUID(),
				prompt: request.prompt,
				operationKey: request.operationKey.toLowerCase(),
				requestHash,
				createdAt: Date.now(),
			});
			if (created.status === 'created') {
				// A replay, stale Provider or unknown DB commit must never start a
				// second paid request. The execution owner checks frozen authorization.
				this.execution.start({
					userId: request.userId,
					appId: request.appId,
					runId: created.run.id,
					providerId: model.providerId,
					version: created.run.version,
					prompt: request.prompt,
					requestHash,
				});
			}
			return created;
		});
	}

	async cancel(request: CancelRunRequest): Promise<CancelRunResult> {
		// Run cancellation preserves its immutable model snapshot for subsequent audit.
		validateScope(request.userId, request.appId);
		validateAgentId(request.runId);
		validateOperationKey(request.operationKey);
		if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 1) {
			throw new AgentFailure('invalid_input');
		}
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
					requestedAt: Date.now(),
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

	/** Read-only audit: unavailable execution steps are 404, not synthetic pending work. */
	getStep(userId: number, appId: string, runId: string, stepIndex: number): Promise<RunModelStep | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		if (stepIndex !== 1) {
			throw new AgentFailure('invalid_input');
		}
		return this.steps.get(userId, appId, runId, stepIndex);
	}

	listStepEvents(
		userId: number,
		appId: string,
		runId: string,
		stepIndex: number,
		after: number,
		limit: number,
	): Promise<RunStepEventPage | null> {
		validateScope(userId, appId);
		validateAgentId(runId);
		if (stepIndex !== 1) {
			throw new AgentFailure('invalid_input');
		}
		validateCursor(after);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_RUN_EVENT_MAX_LIMIT) {
			throw new AgentFailure('invalid_input');
		}
		return this.steps.listEvents(userId, appId, runId, stepIndex, after, limit);
	}
}
