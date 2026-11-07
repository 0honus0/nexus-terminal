import { randomUUID } from 'node:crypto';
import { agentStorage } from '../../agent-storage-failure.js';
import type {
	OperationStorage,
	StoredOperation,
	StoredOperationScope,
	StoredOperationTerminal,
} from '../storage/operation-storage.js';
import type {
	OperationAdmission,
	OperationIntent,
	OperationMutation,
	OperationPreparation,
	OperationReceipt,
	OperationScope,
	OperationTerminal,
} from './operation-types.js';
import type { OperationDispatchAuthority } from './operation-types.js';
import type { OperationBudgetAdmission } from './operation-types.js';
import { fromSettings, fromUsage } from '../../execution/model/execution-projection.js';
import { AgentFailure, isAgentDrainFailure } from '../../agent-failure.js';
import { OperationDispatchRefusal } from './operation-failure.js';
import type { RunChanges } from '../../runs/model/run-changes.js';

function scope(value: OperationScope): StoredOperationScope {
	return {
		userId: value.userId,
		appId: value.appId,
		runId: value.runId,
		executionGeneration: value.executionGeneration,
	};
}

function receipt(value: StoredOperation): OperationReceipt {
	return {
		id: value.id,
		sequence: value.sequence,
		scope: {
			userId: value.scope.userId,
			appId: value.scope.appId,
			runId: value.scope.runId,
			executionGeneration: value.scope.executionGeneration,
		},
		parentId: value.parentId,
		callerId: value.callerId,
		operationKey: value.operationKey,
		requestHash: value.requestHash,
		kind: value.kind,
		label: value.label,
		bindingJson: value.bindingJson,
		argumentsJson: value.argumentsJson,
		state: value.state,
		revision: value.revision,
		resultJson: value.resultJson,
		failureCode: value.failureCode,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export class OperationModel {
	constructor(
		private readonly storage: OperationStorage,
		private readonly admitBudget: OperationBudgetAdmission,
		private readonly changes: RunChanges,
	) {}

	open(value: OperationScope, expectedRunVersion: number, creationHash: string): Promise<boolean> {
		return agentStorage(() => this.storage.open(scope(value), expectedRunVersion, creationHash, Date.now()));
	}

	closeAdmission(value: OperationScope): Promise<boolean> {
		return this.changes.after(value, () =>
			agentStorage(() => this.storage.closeAdmission(scope(value), Date.now())),
		);
	}

	closed(value: OperationScope): Promise<boolean> {
		return agentStorage(() => this.storage.closed(scope(value), Date.now()));
	}

	async admit(intent: OperationIntent, prepare: () => OperationPreparation): Promise<OperationAdmission> {
		const value = await this.changes.after(intent.scope, () =>
			agentStorage(() =>
				this.storage.admit(
					{
						id: randomUUID(),
						scope: scope(intent.scope),
						parentId: intent.parentId,
						callerId: intent.callerId,
						operationKey: intent.operationKey,
						requestHash: intent.requestHash,
						now: Date.now(),
					},
					() => {
						const prepared = prepare();
						return {
							record: prepared.record,
							kind: prepared.kind,
							label: prepared.label,
							bindingJson: prepared.bindingJson,
							argumentsJson: prepared.argumentsJson,
						};
					},
				),
			),
		);
		return value.status === 'accepted' || value.status === 'replayed'
			? { status: value.status, operation: receipt(value.operation) }
			: { status: value.status };
	}

	async get(value: OperationScope, callerId: string, operationKey: string): Promise<OperationReceipt | null> {
		const result = await agentStorage(() => this.storage.get(scope(value), callerId, operationKey));
		return result === null ? null : receipt(result);
	}

	async dispatch(value: OperationReceipt, authority: OperationDispatchAuthority): Promise<OperationMutation> {
		const result = await this.changes.after(value.scope, () =>
			agentStorage(() =>
				this.storage.dispatch(
					scope(value.scope),
					value.id,
					value.revision,
					{
						policyRevision: authority.policyRevision,
						policyExecutionVersion: authority.policyExecutionVersion,
						denylistRevision: authority.denylistRevision,
						settingsVersion: authority.settingsVersion,
						instance: {
							id: authority.instance.id,
							packageId: authority.instance.packageId,
							generation: authority.instance.generation,
							configurationRevision: authority.instance.configurationRevision,
							packageRevision: authority.instance.packageRevision,
						},
						ancestors: authority.ancestors.map((item) => ({
							id: item.id,
							packageId: item.packageId,
							generation: item.generation,
							configurationRevision: item.configurationRevision,
							packageRevision: item.packageRevision,
						})),
						provider:
							authority.provider === null
								? null
								: {
										id: authority.provider.id,
										version: authority.provider.version,
										credentialRevision: authority.provider.credentialRevision,
									},
						target:
							authority.target === null
								? null
								: { id: authority.target.id, version: authority.target.version },
						modelReservation:
							authority.modelReservation === null ? null : { tokens: authority.modelReservation.tokens },
						approval:
							authority.approval === null
								? null
								: { id: authority.approval.id, version: authority.approval.version },
					},
					Date.now(),
					(settings, usage, kind, tokens) => {
						try {
							this.admitBudget(fromSettings(settings), fromUsage(usage), kind, tokens);
						} catch (error) {
							if (error instanceof AgentFailure && !isAgentDrainFailure(error)) {
								throw new OperationDispatchRefusal(error);
							}
							throw error;
						}
					},
				),
			),
		);
		return result.status === 'ok'
			? { status: 'ok', operation: receipt(result.operation) }
			: { status: result.status };
	}

	async finish(value: OperationReceipt, terminal: OperationTerminal): Promise<OperationMutation> {
		const finish: StoredOperationTerminal =
			terminal.state === 'completed'
				? { state: 'completed', resultJson: terminal.resultJson }
				: terminal.state === 'failed'
					? { state: 'failed', failureCode: terminal.failureCode }
					: { state: terminal.state };
		const result = await this.changes.after(value.scope, () =>
			agentStorage(() => this.storage.finish(scope(value.scope), value.id, value.revision, finish, Date.now())),
		);
		return result.status === 'ok'
			? { status: 'ok', operation: receipt(result.operation) }
			: { status: result.status };
	}

	interrupt(): Promise<void> {
		return agentStorage(() => this.storage.interrupt(Date.now()));
	}

	verifyEffect(value: OperationReceipt, allowCompleted: boolean): Promise<boolean> {
		return agentStorage(() =>
			this.storage.verifyEffect(scope(value.scope), value.id, value.requestHash, value.label, allowCompleted),
		);
	}

	async evidence(value: OperationScope, id: string): Promise<import('./operation-types.js').OperationEvidence[]> {
		return (await agentStorage(() => this.storage.evidence(scope(value), id))).map((entry) => {
			const authority = entry.authority;
			return {
				operation: receipt(entry.operation),
				capabilities: entry.capabilities.map((value) => value),
				authority:
					authority === null
						? null
						: {
								policyRevision: authority.policyRevision,
								policyExecutionVersion: authority.policyExecutionVersion,
								denylistRevision: authority.denylistRevision,
								settingsVersion: authority.settingsVersion,
								instance: {
									id: authority.instance.id,
									packageId: authority.instance.packageId,
									generation: authority.instance.generation,
									configurationRevision: authority.instance.configurationRevision,
									packageRevision: authority.instance.packageRevision,
								},
								ancestors: authority.ancestors.map((item) => ({
									id: item.id,
									packageId: item.packageId,
									generation: item.generation,
									configurationRevision: item.configurationRevision,
									packageRevision: item.packageRevision,
								})),
								provider:
									authority.provider === null
										? null
										: {
												id: authority.provider.id,
												version: authority.provider.version,
												credentialRevision: authority.provider.credentialRevision,
											},
								target:
									authority.target === null
										? null
										: { id: authority.target.id, version: authority.target.version },
								modelReservation:
									authority.modelReservation === null
										? null
										: { tokens: authority.modelReservation.tokens },
								approval:
									authority.approval === null
										? null
										: { id: authority.approval.id, version: authority.approval.version },
							},
			};
		});
	}

	confirmArtifacts(value: OperationReceipt, ids: readonly string[]): Promise<void> {
		return this.changes.after(value.scope, () =>
			agentStorage(() =>
				this.storage.confirmArtifacts(
					scope(value.scope),
					value.id,
					value.requestHash,
					ids.map((id) => id),
				),
			),
		);
	}
}
