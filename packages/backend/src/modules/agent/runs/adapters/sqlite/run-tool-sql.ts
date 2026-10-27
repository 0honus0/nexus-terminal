import { frozenExecution, executionUsage } from '../../../execution/adapters/sqlite/execution-budget-sql.js';
import type { StoredExecutionSettings, StoredExecutionUsage } from '../../../execution/storage/execution-storage.js';
import { currentParticipant } from './run-participant-sql.js';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_RUN_STATUSES } from '@nexus-terminal/shared/agent/runs/values';
import { recordToolEvent, fenceRunTools } from './run-tool-events.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	RunToolStorage,
	StoredPermissionInspection,
	StoredToolInspection,
	StoredToolOperation,
	StoredToolIdentity,
	StoredToolSettlement,
	StoredToolListCursor,
	StoredToolListPage,
} from '../../storage/run-tool-storage.js';
import { readToolOperation, toolOperation } from './run-tool-row.js';
import { readStepProposals } from './run-step-proposals.js';

async function assertToolApprovalRevision(tx: SqlExecutor, toolId: string): Promise<void> {
	const exhausted = await tx.one(
		"SELECT id FROM agent_governance_approvals WHERE tool_call_id=? AND status='requested' AND version>=? LIMIT 1",
		[toolId, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted !== null) {
		throw new Error('Agent approval revision exhausted');
	}
}

async function recordOperation(tx: SqlExecutor, input: StoredToolIdentity): Promise<StoredToolOperation> {
	const value = await toolOperation(tx, input.userId, input.appId, input.runId, input.id);
	if (value === null) {
		throw new Error('Tool operation disappeared during write');
	}
	await recordToolEvent(tx, value);
	return value;
}

function sameContent(current: StoredToolOperation, input: StoredToolInspection): boolean {
	return (
		current.toolName === input.toolName &&
		current.toolVersion === input.toolVersion &&
		current.capability === input.capability &&
		current.targetId === input.targetId &&
		current.targetVersion === input.targetVersion &&
		current.risk === input.risk &&
		current.mutation === input.mutation &&
		current.summary === input.summary &&
		current.argumentsJson === input.argumentsJson
	);
}

export class SqliteRunToolStorage implements RunToolStorage {
	constructor(private readonly db: SqliteRuntime) {}

	inspect(
		input: StoredToolInspection,
		clock: () => number,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'> {
		return this.db.transaction(async (tx) => {
			const run = await tx.one('SELECT status FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				input.runId,
				input.userId,
				input.appId,
			]);
			if (run === null) {
				return 'not_found';
			}
			if (
				!(await currentParticipant(
					tx,
					{ userId: input.userId, appId: input.appId, runId: input.runId },
					clock,
					input.toolName,
					input.modelStepIndex,
				))
			) {
				return 'version_conflict';
			}
			if (run.status !== 'pending' && run.status !== 'running') {
				return 'version_conflict';
			}
			if (input.targetId !== null) {
				const target = await tx.one('SELECT version FROM connections WHERE id=?', [input.targetId]);
				if (target === null) {
					return 'not_found';
				}
				if (target.version !== input.targetVersion) {
					return 'version_conflict';
				}
			}
			const step = await tx.one(
				'SELECT state,finish_reason,proposals_json FROM agent_run_model_steps WHERE run_id=? AND step_index=?',
				[input.runId, input.modelStepIndex],
			);
			if (step === null || step.state !== 'completed' || step.finish_reason !== 'tool_calls') {
				return 'version_conflict';
			}
			const proposal = readStepProposals(step.proposals_json).find(
				(value) => value.providerCallId === input.providerCallId,
			);
			if (!proposal || proposal.toolName !== input.toolName || proposal.argumentsJson !== input.argumentsJson) {
				return 'version_conflict';
			}
			const row = await tx.one(
				'SELECT * FROM agent_run_tools WHERE run_id=? AND model_step_index=? AND provider_call_id=?',
				[input.runId, input.modelStepIndex, input.providerCallId],
			);
			const existing = row === null ? null : readToolOperation(row);
			if (existing !== null) {
				if (existing.userId !== input.userId || existing.appId !== input.appId) {
					throw new Error('Tool scope mismatch');
				}
				if (existing.operationHash === input.operationHash) {
					return sameContent(existing, input) ? existing : 'version_conflict';
				}
				if (existing.state !== 'inspected' || input.expectedOperationRevision !== existing.operationRevision) {
					return 'version_conflict';
				}
			} else if (input.expectedOperationRevision !== null) {
				return 'version_conflict';
			}
			const now = clock();
			const fields = [
				input.toolName,
				input.toolVersion,
				input.capability,
				input.targetId,
				input.targetVersion,
				input.risk,
				Number(input.mutation),
				input.summary,
				input.argumentsJson,
				input.operationHash,
			];
			if (existing === null) {
				admitBudget(
					await frozenExecution(tx, input.runId),
					await executionUsage(tx, input.runId, input.userId),
				);
				await tx.run(
					`INSERT INTO agent_run_tools(id,user_id,app_id,run_id,model_step_index,provider_call_id,tool_name,tool_version,capability,target_id,target_version,risk,mutation,summary,arguments_json,operation_hash,operation_revision,revision,state,created_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,'inspected',?,?)`,
					[
						input.id,
						input.userId,
						input.appId,
						input.runId,
						input.modelStepIndex,
						input.providerCallId,
						...fields,
						now,
						now,
					],
				);
				return recordOperation(tx, {
					userId: input.userId,
					appId: input.appId,
					runId: input.runId,
					id: input.id,
				});
			}
			if (
				existing.revision > Number.MAX_SAFE_INTEGER - 3 ||
				existing.operationRevision === Number.MAX_SAFE_INTEGER
			) {
				return 'version_conflict';
			}
			await assertToolApprovalRevision(tx, existing.id);
			const changed = await tx.run(
				`UPDATE agent_run_tools SET tool_name=?,tool_version=?,capability=?,target_id=?,target_version=?,risk=?,mutation=?,summary=?,arguments_json=?,operation_hash=?,operation_revision=operation_revision+1,revision=revision+1,updated_at=?
 WHERE id=? AND operation_revision=? AND state='inspected'`,
				[...fields, now, existing.id, existing.operationRevision],
			);
			if (changed.changes !== 1) {
				throw new Error('Lost tool content CAS');
			}
			await tx.run(
				"UPDATE agent_governance_approvals SET status='superseded',version=version+1 WHERE tool_call_id=? AND status='requested'",
				[existing.id],
			);
			return recordOperation(tx, {
				userId: input.userId,
				appId: input.appId,
				runId: input.runId,
				id: existing.id,
			});
		});
	}

	inspectPermission(
		input: StoredPermissionInspection,
		clock: () => number,
		accept: (parent: StoredToolOperation, status: AgentRunStatus) => boolean,
		admitBudget: (settings: StoredExecutionSettings, usage: StoredExecutionUsage) => void,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'> {
		return this.db.transaction(async (tx) => {
			const parent = await toolOperation(
				tx,
				input.parent.userId,
				input.parent.appId,
				input.parent.runId,
				input.parent.id,
			);
			if (!parent) {
				return 'not_found';
			}
			const run = await tx.one('SELECT status FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				parent.runId,
				parent.userId,
				parent.appId,
			]);
			const status = AGENT_RUN_STATUSES.find((value) => value === run?.status);
			const operation = input.inspection;
			if (
				!status ||
				!accept(parent, status) ||
				!(await currentParticipant(
					tx,
					{ userId: parent.userId, appId: parent.appId, runId: parent.runId },
					clock,
					parent.toolName,
					parent.modelStepIndex,
				)) ||
				operation.userId !== parent.userId ||
				operation.appId !== parent.appId ||
				operation.runId !== parent.runId ||
				operation.modelStepIndex !== parent.modelStepIndex ||
				operation.targetId !== parent.targetId ||
				operation.targetVersion !== parent.targetVersion ||
				operation.expectedOperationRevision !== null
			) {
				return 'version_conflict';
			}
			const existing = await tx.one(
				'SELECT tool_id FROM agent_acp_permissions WHERE parent_id=? AND request_key=?',
				[parent.id, operation.providerCallId],
			);
			if (existing) {
				return 'version_conflict';
			}
			const count = await tx.one('SELECT count(*) AS total FROM agent_acp_permissions WHERE parent_id=?', [
				parent.id,
			]);
			if (!count || typeof count.total !== 'number' || count.total >= input.maxPermissions) {
				return 'version_conflict';
			}
			const now = clock();
			admitBudget(
				await frozenExecution(tx, operation.runId),
				await executionUsage(tx, operation.runId, operation.userId),
			);
			await tx.run(
				`INSERT INTO agent_run_tools(id,user_id,app_id,run_id,model_step_index,provider_call_id,tool_name,tool_version,capability,target_id,target_version,risk,mutation,summary,arguments_json,operation_hash,operation_revision,revision,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,'inspected',?,?)`,
				[
					operation.id,
					operation.userId,
					operation.appId,
					operation.runId,
					operation.modelStepIndex,
					operation.providerCallId,
					operation.toolName,
					operation.toolVersion,
					operation.capability,
					operation.targetId,
					operation.targetVersion,
					operation.risk,
					Number(operation.mutation),
					operation.summary,
					operation.argumentsJson,
					operation.operationHash,
					now,
					now,
				],
			);
			await tx.run(
				'INSERT INTO agent_acp_permissions(tool_id,parent_id,parent_hash,request_key) VALUES(?,?,?,?)',
				[operation.id, parent.id, parent.operationHash, operation.providerCallId],
			);
			return recordOperation(tx, {
				id: operation.id,
				userId: operation.userId,
				appId: operation.appId,
				runId: operation.runId,
			});
		});
	}

	get(input: StoredToolIdentity): Promise<StoredToolOperation | null> {
		return this.db.transaction((tx) => toolOperation(tx, input.userId, input.appId, input.runId, input.id));
	}

	listThread(
		input: { userId: number; appId: string; threadId: string },
		before: StoredToolListCursor | null,
		limit: number,
	): Promise<StoredToolListPage | null> {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
			throw new Error('Invalid tool list pagination');
		}
		return this.db.transaction(async (tx) => {
			const thread = await tx.one('SELECT id FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
				input.userId,
				input.appId,
				input.threadId,
			]);
			if (thread === null) {
				return null;
			}
			const params = [input.userId, input.appId, input.threadId];
			let boundary = '';
			if (before !== null) {
				boundary = ' AND (t.created_at<? OR (t.created_at=? AND t.id<?))';
				params.push(before.createdAt, before.createdAt, before.id);
			}
			const rows = await tx.all(
				`SELECT t.* FROM agent_run_tools t
				 JOIN agent_runs r ON r.id=t.run_id AND r.user_id=t.user_id AND r.app_id=t.app_id
				 WHERE t.user_id=? AND t.app_id=? AND r.thread_id=? ${boundary}
				 ORDER BY t.created_at DESC,t.id DESC LIMIT ?`,
				[...params, limit + 1],
			);
			const descending = rows.map(readToolOperation);
			const items = descending.slice(0, limit).reverse();
			const nextCursor =
				descending.length > limit && items.length > 0
					? { createdAt: items[0].createdAt, id: items[0].id }
					: null;
			return { items, nextCursor };
		});
	}

	finish(
		command: StoredToolSettlement,
		clock: () => number,
		decide: (current: StoredToolOperation) => boolean,
	): Promise<StoredToolOperation | 'not_found' | 'version_conflict'> {
		const { identity: input, expectedRevision: revision, state, resultText } = command;
		return this.db.transaction(async (tx) => {
			const current = await toolOperation(tx, input.userId, input.appId, input.runId, input.id);
			if (current === null) {
				return 'not_found';
			}
			if (
				current.revision !== revision ||
				current.revision === Number.MAX_SAFE_INTEGER ||
				(current.state !== 'inspected' && current.state !== 'dispatched')
			) {
				return 'version_conflict';
			}
			const run = await tx.one('SELECT status FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
				input.runId,
				input.userId,
				input.appId,
			]);
			if (run === null || (run.status !== 'pending' && run.status !== 'running') || !decide(current)) {
				return 'version_conflict';
			}
			await assertToolApprovalRevision(tx, input.id);
			const now = clock();
			const result = await tx.run(
				'UPDATE agent_run_tools SET state=?,result_text=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
				[state, resultText, now, input.id, revision],
			);
			if (result.changes !== 1) {
				throw new Error('Lost tool settlement CAS');
			}
			await tx.run(
				"UPDATE agent_governance_approvals SET status='superseded',version=version+1 WHERE tool_call_id=? AND status='requested'",
				[input.id],
			);
			return recordOperation(tx, input);
		});
	}

	reconcile(now: number): Promise<number> {
		return this.db.transaction((tx) => fenceRunTools(tx, null, now));
	}
}
