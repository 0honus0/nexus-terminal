import type {
	RunStepStorage,
	StoredRunStep,
	StoredRunStepEvent,
	StepFinish,
	StepWriteResult,
} from '../storage/run-step-storage.js';
import { fromStoredProvider } from '../../providers/model/provider-projection.js';
import { fromStoredFrozen } from './run-projection.js';
import { mayExecuteFrozenRun } from '../run-rules.js';
import type { StoredFrozenInput } from '../storage/run-storage.js';
import type { ProviderStoredRow } from '../../providers/storage/provider-storage.js';
import type {
	RunModelStep,
	RunModelStepResult,
	RunStepCommand,
	RunStepMutation,
	RunStepFinish,
	RunStepEvent,
	RunStepEventPage,
} from './run-types.js';

/** Frozen Provider configuration is not an execution authorization. */
function authorizeExecution(frozen: StoredFrozenInput, provider: ProviderStoredRow | null): boolean {
	return mayExecuteFrozenRun(fromStoredFrozen(frozen), provider === null ? null : fromStoredProvider(provider));
}

function toStorageCommand(command: RunStepCommand) {
	return {
		userId: command.userId,
		appId: command.appId,
		runId: command.runId,
		stepIndex: command.stepIndex,
		expectedRunVersion: command.expectedRunVersion,
		requestHash: command.requestHash,
		now: command.now,
	};
}

function toStorageMutation(command: RunStepMutation) {
	return {
		userId: command.userId,
		appId: command.appId,
		runId: command.runId,
		stepIndex: command.stepIndex,
		expectedRunVersion: command.expectedRunVersion,
		expectedRevision: command.expectedRevision,
		requestHash: command.requestHash,
		now: command.now,
	};
}

function projectEvent(row: StoredRunStepEvent): RunStepEvent {
	return {
		stepIndex: row.stepIndex,
		sequence: row.sequence,
		kind: row.kind,
		...(row.textDelta === undefined ? {} : { textDelta: row.textDelta }),
		...(row.inputTokens === undefined ? {} : { inputTokens: row.inputTokens }),
		...(row.outputTokens === undefined ? {} : { outputTokens: row.outputTokens }),
		createdAt: row.createdAt,
	};
}

function projectStep(row: StoredRunStep): RunModelStep {
	return {
		runId: row.runId,
		stepIndex: row.stepIndex,
		state: row.state,
		revision: row.revision,
		runVersion: row.expectedRunVersion,
		textBytes: row.textBytes,
		...(row.finishReason === undefined ? {} : { finishReason: row.finishReason }),
		...(row.inputTokens === undefined ? {} : { inputTokens: row.inputTokens }),
		...(row.outputTokens === undefined ? {} : { outputTokens: row.outputTokens }),
		...(row.failureCode === undefined ? {} : { failureCode: row.failureCode }),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function projectResult(value: StepWriteResult): RunModelStepResult {
	if (value.status === 'ok') {
		return { status: 'ok', step: projectStep(value.step) };
	}
	return { status: value.status };
}

/** Not an executor. Only the existing Run aggregate may own model-step journal writes. */
export class RunStepModel {
	constructor(private readonly storage: RunStepStorage) {}

	async reserve(command: RunStepCommand): Promise<RunModelStepResult> {
		return projectResult(await this.storage.reserve(toStorageCommand(command), authorizeExecution));
	}

	async dispatch(command: RunStepMutation): Promise<RunModelStepResult> {
		return projectResult(await this.storage.dispatch(toStorageMutation(command), authorizeExecution));
	}

	async appendText(command: RunStepMutation, text: string): Promise<RunModelStepResult> {
		return projectResult(await this.storage.appendText(toStorageMutation(command), text));
	}

	async recordUsage(
		command: RunStepMutation,
		inputTokens: number,
		outputTokens: number,
	): Promise<RunModelStepResult> {
		return projectResult(await this.storage.recordUsage(toStorageMutation(command), inputTokens, outputTokens));
	}

	async finish(command: RunStepMutation, result: RunStepFinish): Promise<RunModelStepResult> {
		let stored: StepFinish;
		if (result.state === 'failed') {
			stored = { state: 'failed', failureCode: result.failureCode };
		} else if (result.state === 'completed') {
			stored = { state: 'completed' };
		} else {
			stored = { state: 'unknown' };
		}
		return projectResult(await this.storage.finish(toStorageMutation(command), stored));
	}

	async get(userId: number, appId: string, runId: string, stepIndex: number): Promise<RunModelStep | null> {
		const stored = await this.storage.get(userId, appId, runId, stepIndex);
		return stored === null ? null : projectStep(stored);
	}

	async listEvents(
		userId: number,
		appId: string,
		runId: string,
		stepIndex: number,
		after: number,
		limit: number,
	): Promise<RunStepEventPage | null> {
		const page = await this.storage.listEvents(userId, appId, runId, stepIndex, after, limit);
		return page === null ? null : { items: page.items.map(projectEvent), nextCursor: page.nextCursor };
	}

	/** Never resend after restart: undispatched is failed, dispatched is unknown. */
	reconcileUnsettled(now: number): Promise<number> {
		return this.storage.reconcileUnsettled(now);
	}
}
