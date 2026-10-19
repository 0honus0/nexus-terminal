import { currentParticipant } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { currentAcpParent } from '../../../runs/adapters/sqlite/acp-parent-sql.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { ProviderStorage } from '../../../providers/storage/provider-storage.js';
import { frozenFromRun } from '../../../runs/adapters/sqlite/run-sql.js';
import { readRunSelection } from '../../../runs/adapters/sqlite/run-selection.js';
import { toolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';
import { recordToolEvent } from '../../../runs/adapters/sqlite/run-tool-events.js';
import { readApproval, assertRevisionAvailable } from './governance-row.js';
import { readRunStatus } from './governance-row.js';
import type {
	StoredPolicy,
	StoredToolAuthorityIdentity,
	StoredToolAuthorityTask,
	StoredToolAuthorityDecision,
	StoredToolPermitDecision,
	StoredToolAuthority,
} from '../../storage/governance-storage.js';

/** Reads and commits one tool authority check, read-only intent or delivery, under the original authority transaction. */
export async function toolAuthority(
	tx: SqlExecutor,
	input: StoredToolAuthorityIdentity,
	task: StoredToolAuthorityTask,
	clock: () => number,
	policySnapshot: (tx: SqlExecutor, userId: number, appId: string) => Promise<StoredPolicy | null>,
	providers: ProviderStorage,
	decide: StoredToolAuthorityDecision,
	permit: StoredToolPermitDecision,
): Promise<StoredToolAuthority | null> {
	const operation = await toolOperation(tx, input.userId, input.appId, input.runId, input.id);
	if (
		!operation ||
		operation.revision !== input.expectedRevision ||
		operation.operationHash !== input.operationHash ||
		((task.kind === 'dispatch' || task.kind === 'inspect') && operation.state !== 'inspected') ||
		(task.kind === 'complete' && operation.state !== 'dispatched') ||
		(task.kind === 'verify' && operation.state !== 'dispatched' && operation.state !== 'completed')
	) {
		return null;
	}
	const run = await tx.one(
		'SELECT status,selected_connections_json FROM agent_runs WHERE id=? AND user_id=? AND app_id=?',
		[input.runId, input.userId, input.appId],
	);
	const policy = await policySnapshot(tx, input.userId, input.appId);
	const frozen = await frozenFromRun(tx, input.userId, input.appId, input.runId);
	if (!run || !policy || !frozen || (task.kind !== 'dispatch' && task.policyRevision !== policy.revision)) {
		return null;
	}
	const provider = await providers.snapshot(tx, input.userId, frozen.providerId);
	const connectionIds = readRunSelection(run.selected_connections_json);
	if (!decide(operation, policy, readRunStatus(run.status), frozen, provider, connectionIds)) {
		return null;
	}
	if (
		!(await currentParticipant(
			tx,
			{ userId: operation.userId, appId: operation.appId, runId: operation.runId },
			clock,
			operation.toolName,
			operation.modelStepIndex,
		))
	) {
		return null;
	}
	if (!(await currentAcpParent(tx, operation))) {
		return null;
	}
	if (operation.targetId !== null) {
		const target = await tx.one('SELECT type,version FROM connections WHERE id=?', [operation.targetId]);
		if (!target || target.type !== 'SSH' || target.version !== operation.targetVersion) {
			return null;
		}
	}
	if ((operation.mutation || operation.risk !== 'read') && task.kind !== 'inspect') {
		if (task.kind === 'dispatch') {
			return null;
		}
		const approval = await tx.one(
			"SELECT * FROM agent_governance_approvals WHERE user_id=? AND app_id=? AND run_id=? AND tool_call_id=? AND operation_hash=? AND input_revision=? AND policy_revision=? AND status='approved' AND kind=? AND consumed_at IS NOT NULL",
			[
				input.userId,
				input.appId,
				input.runId,
				operation.id,
				operation.operationHash,
				operation.operationRevision,
				policy.revision,
				operation.toolName === 'acp_inner_permission' ? 'acp_permission' : 'tool',
			],
		);
		if (!approval || !permit(readApproval(approval), operation, policy, Math.floor(clock() / 1000))) {
			return null;
		}
	}
	if (task.kind === 'verify' || task.kind === 'inspect') {
		return { operation, policy, connectionIds };
	}
	if (task.kind === 'complete') {
		if (
			operation.targetId !== null &&
			!task.targets.some(
				(target) => target.id === operation.targetId && target.version === operation.targetVersion,
			)
		) {
			throw new Error('Tool result is missing its bound target');
		}
		if (
			task.targets.length > connectionIds.length ||
			new Set(task.targets.map((target) => target.id)).size !== task.targets.length
		) {
			throw new Error('Invalid tool result selection');
		}
		for (const target of task.targets) {
			const row = await tx.one('SELECT version FROM connections WHERE id=?', [target.id]);
			if (!connectionIds.includes(target.id) || !row || row.version !== target.version) {
				return null;
			}
		}
	}
	assertRevisionAvailable(operation.revision, 1, task.kind === 'dispatch' ? 2 : 1);
	const now = clock();
	const result = await tx.run(
		'UPDATE agent_run_tools SET state=?,result_text=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?',
		[
			task.kind === 'dispatch' ? 'dispatched' : 'completed',
			task.kind === 'complete' ? task.resultText : null,
			now,
			operation.id,
			operation.revision,
		],
	);
	if (result.changes !== 1) {
		throw new Error('Lost tool authority CAS');
	}
	const updated = await toolOperation(tx, input.userId, input.appId, input.runId, input.id);
	if (!updated) {
		throw new Error('Tool disappeared during dispatch');
	}
	await recordToolEvent(tx, updated);
	return { operation: updated, policy, connectionIds };
}
