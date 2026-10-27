import type { CompactionCommand } from './context-types.js';
import type { CompactionStorage, StoredCompactionCommand } from '../storage/compaction-storage.js';
import type { ExecutionBudgetAdmission } from '../../execution/model/execution-types.js';
import { fromSettings, fromUsage } from '../../execution/model/execution-projection.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { toStoredContext } from './context-model.js';
import { fromStoredFrozen } from '../../runs/model/run-projection.js';
import { fromStoredProvider } from '../../providers/model/provider-projection.js';
import { mayExecuteFrozenRun } from '../../runs/run-rules.js';
import type { RunStepPolicyCheck } from '../../runs/storage/run-step-storage.js';
import { projectCapturedResult } from '../result-rules.js';

const authorize: RunStepPolicyCheck = (frozen, provider) =>
	mayExecuteFrozenRun(fromStoredFrozen(frozen), provider === null ? null : fromStoredProvider(provider));

function toStored(command: CompactionCommand): StoredCompactionCommand {
	return {
		id: command.id,
		userId: command.userId,
		appId: command.appId,
		runId: command.runId,
		stepIndex: command.stepIndex,
		expectedRunVersion: command.expectedRunVersion,
		creationHash: command.creationHash,
		requestHash: command.requestHash,
		now: command.now,
		snapshot: toStoredContext(command.snapshot.messages, command.snapshot.sources),
		cut: command.cut,
		estimatedTokens: command.estimatedTokens,
	};
}

export class CompactionModel {
	constructor(private readonly storage: CompactionStorage) {}

	reserve(command: CompactionCommand, admit: ExecutionBudgetAdmission): Promise<boolean> {
		return agentStorage(() =>
			this.storage.reserve(
				toStored(command),
				authorize,
				(results, previewBytes) =>
					results.every((result) =>
						command.snapshot.messages.some(
							(message) =>
								message.role === 'tool' &&
								message.providerCallId === result.providerCallId &&
								message.content === projectCapturedResult(result.id, result.content, previewBytes),
						),
					),
				(settings, usage) => admit(fromSettings(settings), fromUsage(usage)),
			),
		);
	}

	dispatch(command: CompactionCommand, admit: ExecutionBudgetAdmission): Promise<boolean> {
		return agentStorage(() =>
			this.storage.dispatch(toStored(command), authorize, (settings, usage) =>
				admit(fromSettings(settings), fromUsage(usage)),
			),
		);
	}

	recordUsage(command: CompactionCommand, input: number, output: number): Promise<boolean> {
		return agentStorage(() => this.storage.recordUsage(toStored(command), input, output));
	}

	finish(
		command: CompactionCommand,
		state: 'completed' | 'failed' | 'unknown',
		summary: string | null,
	): Promise<boolean> {
		return agentStorage(() => this.storage.finish(toStored(command), state, summary));
	}
}
