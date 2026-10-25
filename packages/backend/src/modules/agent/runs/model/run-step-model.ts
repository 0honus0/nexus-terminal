import { RunChanges } from './run-changes.js';
import { fromSettings, fromUsage } from '../../execution/model/execution-projection.js';
import type { ExecutionBudgetAdmission } from '../../execution/model/execution-types.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { toStoredContext } from '../../context/model/context-model.js';
import { projectCapturedResult } from '../../context/result-rules.js';
import type { ContextSnapshot } from '../../context/model/context-types.js';
import type {
	RunStepStorage,
	StoredRunStep,
	StoredRunStepEvent,
	StepFinish,
	StepWriteResult,
} from '../storage/run-step-storage.js';
import { fromStoredProvider } from '../../providers/model/provider-projection.js';
import { fromStoredFrozen } from './run-projection.js';
import { mayExecuteFrozenRun, mayFinishModelStep, interruptedRootState } from '../run-rules.js';
import type { StoredFrozenInput } from '../storage/run-storage.js';
import type { ProviderStoredRow } from '../../providers/storage/provider-storage.js';
import type {
	RunUsage,
	RunModelStep,
	RunModelStepResult,
	RunStepCommand,
	RunStepMutation,
	RunStepFinish,
	RunStepEvent,
	RunStepEventPage,
	RunUnstartedFailure,
} from './run-types.js';

/** Frozen Provider configuration is not an execution authorization. */
function authorizeExecution(frozen: StoredFrozenInput, provider: ProviderStoredRow | null): boolean {
	return mayExecuteFrozenRun(fromStoredFrozen(frozen), provider === null ? null : fromStoredProvider(provider));
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
		creationHash: command.creationHash,
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
		requestHash: row.requestHash,
		stepIndex: row.stepIndex,
		state: row.state,
		revision: row.revision,
		runVersion: row.expectedRunVersion,
		textBytes: row.textBytes,
		proposals: row.proposals.map((proposal) => ({
			providerCallId: proposal.providerCallId,
			toolName: proposal.toolName,
			argumentsJson: proposal.argumentsJson,
		})),
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
	constructor(
		private readonly storage: RunStepStorage,
		private readonly changes = new RunChanges(),
	) {}

	failUnstarted(command: RunUnstartedFailure): Promise<boolean> {
		return this.changes.after(command.userId, command.appId, () =>
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

	async endRoot(command: RunStepMutation, uncertain: boolean): Promise<RunModelStepResult> {
		return projectResult(
			await this.changes.after(command.userId, command.appId, () =>
				agentStorage(() =>
					this.storage.endRoot(toStorageMutation(command), (hasUnconfirmedEffects) =>
						interruptedRootState(uncertain, hasUnconfirmedEffects),
					),
				),
			),
		);
	}

	async reserve(
		command: RunStepCommand,
		context: ContextSnapshot,
		estimatedTokens: number,
		admitBudget: ExecutionBudgetAdmission,
	): Promise<RunModelStepResult> {
		return projectResult(
			await this.changes.after(command.userId, command.appId, () =>
				agentStorage(() =>
					this.storage.reserve(
						{
							userId: command.userId,
							appId: command.appId,
							runId: command.runId,
							stepIndex: command.stepIndex,
							expectedRunVersion: command.expectedRunVersion,
							requestHash: command.requestHash,
							creationHash: command.creationHash,
							now: command.now,
							context: toStoredContext(context.messages, context.sources),
							estimatedTokens,
						},
						authorizeExecution,
						(results) => {
							const facts = results.map((result) => ({
								id: result.id,
								providerCallId: result.providerCallId,
								content: result.content,
							}));
							const messages = context.messages.slice(context.messages.length - facts.length);
							return facts.every((result) =>
								messages.some(
									(message) =>
										message.role === 'tool' &&
										message.providerCallId === result.providerCallId &&
										message.content === projectCapturedResult(result.id, result.content),
								),
							);
						},
						(settings, usage) => admitBudget(fromSettings(settings), fromUsage(usage)),
					),
				),
			),
		);
	}

	async dispatch(command: RunStepMutation, admitBudget: ExecutionBudgetAdmission): Promise<RunModelStepResult> {
		return projectResult(
			await this.changes.after(command.userId, command.appId, () =>
				agentStorage(() =>
					this.storage.dispatch(toStorageMutation(command), authorizeExecution, (settings, usage) =>
						admitBudget(fromSettings(settings), fromUsage(usage)),
					),
				),
			),
		);
	}

	async appendText(command: RunStepMutation, text: string): Promise<RunModelStepResult> {
		return projectResult(
			await this.changes.after(
				command.userId,
				command.appId,
				() => agentStorage(() => this.storage.appendText(toStorageMutation(command), text)),
				'text',
			),
		);
	}

	async recordUsage(
		command: RunStepMutation,
		inputTokens: number,
		outputTokens: number,
	): Promise<RunModelStepResult> {
		return projectResult(
			await this.changes.after(command.userId, command.appId, () =>
				agentStorage(() => this.storage.recordUsage(toStorageMutation(command), inputTokens, outputTokens)),
			),
		);
	}

	async finish(command: RunStepMutation, result: RunStepFinish): Promise<RunModelStepResult> {
		let stored: StepFinish;
		if (result.state === 'failed') {
			stored = { state: 'failed', failureCode: result.failureCode };
		} else if (result.state === 'completed') {
			stored =
				result.finishReason === 'stop'
					? { state: 'completed', finishReason: 'stop', outputText: result.outputText }
					: {
							state: 'completed',
							finishReason: 'tool_calls',
							proposals: result.proposals.map((proposal) => ({
								providerCallId: proposal.providerCallId,
								toolName: proposal.toolName,
								argumentsJson: proposal.argumentsJson,
							})),
						};
		} else {
			stored = { state: 'unknown' };
		}
		return projectResult(
			await this.changes.after(command.userId, command.appId, () =>
				agentStorage(() =>
					this.storage.finish(toStorageMutation(command), stored, (hasUnsettledTools, hasUnsettledChildren) =>
						mayFinishModelStep(result, hasUnsettledTools, hasUnsettledChildren),
					),
				),
			),
		);
	}

	async usage(userId: number, appId: string, runId: string): Promise<RunUsage | null> {
		const value = await agentStorage(() => this.storage.usage(userId, appId, runId));
		if (value === null) {
			return null;
		}
		return {
			runId: value.runId,
			runVersion: value.runVersion,
			inputTokens: value.inputTokens,
			outputTokens: value.outputTokens,
			reportedModelRequests: value.reportedModelRequests,
			modelRequests: value.modelRequests,
			toolExecutions: value.toolExecutions,
		};
	}

	async get(userId: number, appId: string, runId: string, stepIndex: number): Promise<RunModelStep | null> {
		const stored = await agentStorage(() => this.storage.get(userId, appId, runId, stepIndex));
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
		const page = await agentStorage(() => this.storage.listEvents(userId, appId, runId, stepIndex, after, limit));
		return page === null ? null : { items: page.items.map(projectEvent), nextCursor: page.nextCursor };
	}

	/** Never resend after restart: undispatched is failed, dispatched is unknown. */
	reconcileUnsettled(now: number): Promise<number> {
		return agentStorage(() => this.storage.reconcileUnsettled(now));
	}
}
