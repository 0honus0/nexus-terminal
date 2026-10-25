import { RunChanges } from './run-changes.js';
import type { ExecutionBudgetAdmission } from '../../execution/model/execution-types.js';
import { fromSettings, fromUsage } from '../../execution/model/execution-projection.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import { createHash } from 'node:crypto';
import { TOOL_RESULT_MAX_BYTES, TOOL_ARGUMENT_MAX_BYTES } from '../run-tool-limits.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import type { RunToolStorage, StoredToolOperation, StoredToolInspection } from '../storage/run-tool-storage.js';
import type {
	ToolOperation,
	ToolPermissionInspection,
	ToolIdentity,
	ToolInspectionCommand,
	ToolSettlement,
	ToolEventPage,
} from './run-tool-types.js';
import { maySettleTool } from '../run-tool-rules.js';

export function fromStoredTool(row: StoredToolOperation): ToolOperation {
	return {
		id: row.id,
		userId: row.userId,
		appId: row.appId,
		runId: row.runId,
		modelStepIndex: row.modelStepIndex,
		providerCallId: row.providerCallId,
		toolName: row.toolName,
		toolVersion: row.toolVersion,
		capability: row.capability,
		targetId: row.targetId,
		targetVersion: row.targetVersion,
		risk: row.risk,
		mutation: row.mutation,
		summary: row.summary,
		argumentsJson: row.argumentsJson,
		operationHash: row.operationHash,
		operationRevision: row.operationRevision,
		revision: row.revision,
		state: row.state,
		resultText: row.resultText,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function toStoredIdentity(input: ToolIdentity) {
	return { id: input.id, userId: input.userId, appId: input.appId, runId: input.runId };
}

function hashInspection(input: ToolInspectionCommand): string {
	// Fixed positions bind the complete inspection to its scope and provider call.
	// The server-generated row id and state revision are not operation content.
	return createHash('sha256')
		.update(
			JSON.stringify([
				1,
				input.userId,
				input.appId,
				input.runId,
				input.modelStepIndex,
				input.providerCallId,
				input.toolName,
				input.toolVersion,
				input.capability,
				input.targetId,
				input.targetVersion,
				input.risk,
				input.mutation,
				input.summary,
				input.argumentsJson,
			]),
			'utf8',
		)
		.digest('hex');
}

function toStoredInspection(input: ToolInspectionCommand): StoredToolInspection {
	return {
		id: input.id,
		userId: input.userId,
		appId: input.appId,
		runId: input.runId,
		modelStepIndex: input.modelStepIndex,
		providerCallId: input.providerCallId,
		toolName: input.toolName,
		toolVersion: input.toolVersion,
		capability: input.capability,
		targetId: input.targetId,
		targetVersion: input.targetVersion,
		risk: input.risk,
		mutation: input.mutation,
		summary: input.summary,
		argumentsJson: input.argumentsJson,
		operationHash: hashInspection(input),
		expectedOperationRevision: input.expectedOperationRevision,
	};
}

function mutation(result: StoredToolOperation | 'not_found' | 'version_conflict'): ToolOperation {
	if (typeof result === 'string') {
		throw new AgentFailure(result);
	}
	return fromStoredTool(result);
}

export class RunToolModel {
	constructor(
		private readonly storage: RunToolStorage,
		private readonly admitBudget: ExecutionBudgetAdmission,
		private readonly changes = new RunChanges(),
	) {}

	async inspect(input: ToolInspectionCommand): Promise<ToolOperation> {
		if (Buffer.byteLength(input.argumentsJson, 'utf8') > TOOL_ARGUMENT_MAX_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		return mutation(
			await this.changes.after(input.userId, input.appId, () =>
				agentStorage(() =>
					this.storage.inspect(toStoredInspection(input), Date.now, (settings, usage) =>
						this.admitBudget(fromSettings(settings), fromUsage(usage)),
					),
				),
			),
		);
	}

	async inspectPermission(
		input: ToolPermissionInspection,
		accept: (parent: ToolOperation, status: AgentRunStatus) => boolean,
	): Promise<ToolOperation> {
		if (Buffer.byteLength(input.inspection.argumentsJson, 'utf8') > TOOL_ARGUMENT_MAX_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		return mutation(
			await this.changes.after(input.inspection.userId, input.inspection.appId, () =>
				agentStorage(() =>
					this.storage.inspectPermission(
						{
							parent: toStoredIdentity(input.parent),
							inspection: toStoredInspection(input.inspection),
							maxPermissions: input.maxPermissions,
						},
						Date.now,
						(parent, status) => accept(fromStoredTool(parent), status),
						(settings, usage) => this.admitBudget(fromSettings(settings), fromUsage(usage)),
					),
				),
			),
		);
	}

	async get(input: ToolIdentity): Promise<ToolOperation | null> {
		const row = await agentStorage(() => this.storage.get(toStoredIdentity(input)));
		return row === null ? null : fromStoredTool(row);
	}

	async listEvents(input: ToolIdentity, after: number, limit: number): Promise<ToolEventPage | null> {
		const page = await agentStorage(() => this.storage.listEvents(toStoredIdentity(input), after, limit));
		return page === null
			? null
			: {
					items: page.items.map((event) => ({
						toolCallId: event.toolCallId,
						runId: event.runId,
						revision: event.revision,
						operationRevision: event.operationRevision,
						state: event.state,
						operationHash: event.operationHash,
						createdAt: event.createdAt,
					})),
					nextCursor: page.nextCursor,
				};
	}

	async finish(input: ToolSettlement): Promise<ToolOperation> {
		if (input.state === 'completed' && input.resultText === null) {
			throw new AgentFailure('invalid_input');
		}
		if (input.resultText !== null && Buffer.byteLength(input.resultText, 'utf8') > TOOL_RESULT_MAX_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		return mutation(
			await this.changes.after(input.identity.userId, input.identity.appId, () =>
				agentStorage(() =>
					this.storage.finish(
						{
							identity: toStoredIdentity(input.identity),
							expectedRevision: input.expectedRevision,
							state: input.state,
							resultText: input.resultText,
						},
						Date.now,
						(current) => maySettleTool(fromStoredTool(current), input),
					),
				),
			),
		);
	}

	reconcileUnsettled(): Promise<number> {
		return agentStorage(() => this.storage.reconcile(Date.now()));
	}
}
