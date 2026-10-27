import type { TitleStorage, StoredTitleCommand, StoredTitleScope } from '../storage/title-storage.js';
import type { TitleScope, TitleClaim, TitleCommand } from './title-types.js';
import type { ExecutionBudgetAdmission } from '../../execution/model/execution-types.js';
import { fromSettings, fromUsage } from '../../execution/model/execution-projection.js';
import { fromStoredFrozen } from '../../runs/model/run-projection.js';
import { fromStoredProvider } from '../../providers/model/provider-projection.js';
import { mayExecuteFrozenRun } from '../../runs/run-rules.js';
import type { RunStepPolicyCheck } from '../../runs/storage/run-step-storage.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { RunChanges } from '../../runs/model/run-changes.js';

const authorize: RunStepPolicyCheck = (frozen, provider) =>
	mayExecuteFrozenRun(fromStoredFrozen(frozen), provider === null ? null : fromStoredProvider(provider));

function toScope(value: TitleScope): StoredTitleScope {
	return { userId: value.userId, appId: value.appId, runId: value.runId, creationHash: value.creationHash };
}

function toCommand(value: TitleCommand): StoredTitleCommand {
	return {
		userId: value.userId,
		appId: value.appId,
		runId: value.runId,
		creationHash: value.creationHash,
		claim: { threadId: value.claim.threadId, version: value.claim.version },
		requestHash: value.requestHash,
		estimatedTokens: value.estimatedTokens,
	};
}

export class TitleModel {
	constructor(
		private readonly storage: TitleStorage,
		private readonly changes: RunChanges,
	) {}

	async claim(scope: TitleScope, fallback: string): Promise<TitleClaim | null> {
		const value = await this.changes.after(scope.userId, scope.appId, () =>
			agentStorage(() => this.storage.claim(toScope(scope), fallback, authorize)),
		);
		return value === null ? null : { threadId: value.threadId, version: value.version };
	}

	reserve(command: TitleCommand, admit: ExecutionBudgetAdmission): Promise<boolean> {
		return agentStorage(() =>
			this.storage.reserve(toCommand(command), authorize, (settings, usage) =>
				admit(fromSettings(settings), fromUsage(usage)),
			),
		);
	}

	dispatch(command: TitleCommand, admit: ExecutionBudgetAdmission): Promise<boolean> {
		return agentStorage(() =>
			this.storage.dispatch(toCommand(command), authorize, (settings, usage) =>
				admit(fromSettings(settings), fromUsage(usage)),
			),
		);
	}

	recordUsage(command: TitleCommand, input: number, output: number): Promise<boolean> {
		return agentStorage(() => this.storage.recordUsage(toCommand(command), input, output));
	}

	finish(command: TitleCommand, state: 'completed' | 'failed' | 'unknown', title: string | null): Promise<boolean> {
		return this.changes.after(command.userId, command.appId, () =>
			agentStorage(() => this.storage.finish(toCommand(command), state, title, authorize)),
		);
	}
}
