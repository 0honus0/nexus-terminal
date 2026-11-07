import { createHash, randomUUID } from 'node:crypto';
import { AGENT_APPROVAL_TTL_SECONDS } from '@nexus-terminal/shared/agent/governance/values';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { AgentFailure } from '../../agent-failure.js';
import { agentStorage } from '../../agent-storage-failure.js';
import type { OperationApprovalStorage, StoredOperationApproval } from '../storage/operation-approval-storage.js';
import { OperationApprovalRefusal } from '../storage/operation-approval-storage.js';
import type {
	OperationApproval,
	OperationApprovalActor,
	OperationApprovalRequest,
	OperationApprovalDecision,
} from './operation-approval-types.js';

function fromApproval(value: StoredOperationApproval): OperationApproval {
	return {
		id: value.id,
		sequence: value.sequence,
		appId: value.appId,
		runId: value.runId,
		operationId: value.operationId,
		parentOperationId: value.parentOperationId,
		operationName: value.operationName,
		operationHash: value.operationHash,
		policyRevision: value.policyRevision,
		status: value.status,
		version: value.version,
		capability: value.capability,
		risk: value.risk,
		summary: value.summary,
		targetId: value.targetId,
		requestedAt: value.requestedAt,
		expiresAt: value.expiresAt,
		decidedAt: value.decidedAt,
		decidedBy: value.decidedBy,
		consumedAt: value.consumedAt,
	};
}

export class OperationApprovalModel {
	constructor(
		private readonly storage: OperationApprovalStorage,
		private readonly tokens: SessionTokens,
	) {}

	private work<T>(action: () => Promise<T>): Promise<T> {
		return agentStorage(async () => {
			try {
				return await action();
			} catch (error) {
				if (error instanceof OperationApprovalRefusal) {
					throw new AgentFailure(error.code, { cause: error });
				}
				throw error;
			}
		});
	}

	async request(input: OperationApprovalRequest): Promise<OperationApproval> {
		const operation = input.operation;
		return fromApproval(
			await this.work(() =>
				this.storage.request({
					id: randomUUID(),
					operationId: operation.id,
					operationHash: operation.requestHash,
					operationRevision: operation.revision,
					userId: operation.scope.userId,
					appId: operation.scope.appId,
					runId: operation.scope.runId,
					executionGeneration: operation.scope.executionGeneration,
					policyRevision: input.policyRevision,
					capability: input.capability,
					risk: input.risk,
					summary: input.summary,
					targetId: input.targetId,
					now: Date.now(),
					ttlMs: AGENT_APPROVAL_TTL_SECONDS * 1000,
				}),
			),
		);
	}

	async get(userId: number, appId: string, operationId: string): Promise<OperationApproval | null> {
		const result = await this.work(() => this.storage.get(userId, appId, operationId, Date.now()));
		return result === null ? null : fromApproval(result);
	}

	async list(
		userId: number,
		appId: string,
		runId: string,
		before: string | null,
		limit: number,
	): Promise<OperationApproval[]> {
		return (await this.work(() => this.storage.list(userId, appId, runId, before, limit, Date.now()))).map(
			fromApproval,
		);
	}

	async getApproval(userId: number, appId: string, approvalId: string): Promise<OperationApproval | null> {
		const result = await this.work(() => this.storage.getApproval(userId, appId, approvalId, Date.now()));
		return result === null ? null : fromApproval(result);
	}

	async resolve(actor: OperationApprovalActor, command: OperationApprovalDecision): Promise<OperationApproval> {
		const feedback = command.feedback ?? null;
		const hash = createHash('sha256')
			.update(
				JSON.stringify([
					command.appId,
					command.approvalId,
					command.operationHash,
					command.expectedVersion,
					command.decision,
					feedback,
				]),
			)
			.digest('hex');
		return fromApproval(
			await this.work(() =>
				this.storage.resolve(
					actor.userId,
					this.tokens.digest(actor.token),
					{
						appId: command.appId,
						approvalId: command.approvalId,
						operationKey: command.operationKey,
						operationHash: command.operationHash,
						expectedVersion: command.expectedVersion,
						decision: command.decision,
						feedback,
						requestHash: hash,
					},
					Date.now(),
				),
			),
		);
	}
}
