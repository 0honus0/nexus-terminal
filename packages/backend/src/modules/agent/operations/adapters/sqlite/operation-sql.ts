import type { AgentRunFailureCode } from '@nexus-terminal/shared/agent/runs/values';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	OperationStorage,
	StoredOperation,
	StoredOperationScope,
	StoredOperationIntent,
	StoredOperationPreparation,
	StoredOperationAdmission,
	StoredOperationMutation,
	StoredOperationTerminal,
} from '../../storage/operation-storage.js';
import { operationRow } from './operation-row.js';
import { operationCapabilities } from './operation-activity-row.js';
import type { StoredOperationDispatchAuthority } from '../../storage/operation-storage.js';
import { currentDispatchAuthority } from './operation-dispatch-authority.js';
import { currentOperation } from './current-operation-sql.js';
import { operationAuthority } from './operation-authority-row.js';
import { executionUsage, frozenExecution } from '../../../execution/adapters/sqlite/execution-budget-sql.js';

function storedInteger(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Invalid operation evidence integer');
	}
	return value;
}

function storedText(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Invalid operation evidence text');
	}
	return value;
}

async function isOpen(tx: SqlReader, scope: StoredOperationScope): Promise<boolean> {
	const row = await tx.one(
		`SELECT e.run_id FROM agent_run_executions e JOIN agent_runs r ON r.id=e.run_id
	 JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id
	 WHERE e.run_id=? AND e.generation=? AND e.state='open' AND r.user_id=? AND r.app_id=?
	 AND r.status IN ('pending','running') AND r.deadline_at>? AND a.enabled=1`,
		[scope.runId, scope.executionGeneration, scope.userId, scope.appId, Date.now()],
	);
	return row !== null;
}

async function getById(tx: SqlReader, scope: StoredOperationScope, id: string): Promise<StoredOperation | null> {
	const row = await tx.one(
		'SELECT * FROM agent_operations WHERE id=? AND user_id=? AND app_id=? AND run_id=? AND execution_generation=?',
		[id, scope.userId, scope.appId, scope.runId, scope.executionGeneration],
	);
	return row === null ? null : operationRow(row);
}

export class SqliteOperationStorage implements OperationStorage {
	constructor(private readonly db: SqliteRuntime) {}

	open(scope: StoredOperationScope, expectedRunVersion: number, creationHash: string, now: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const inserted = await tx.run(
				`INSERT INTO agent_run_executions(run_id,generation,state,created_at,updated_at)
			 SELECT r.id,?,'open',?,? FROM agent_runs r JOIN agent_apps a ON a.id=r.app_id AND a.user_id=r.user_id
			 WHERE r.id=? AND r.user_id=? AND r.app_id=? AND r.version=? AND r.status IN ('pending','running')
			 AND r.deadline_at>? AND a.enabled=1 AND (
			 EXISTS(SELECT 1 FROM agent_command_idempotency i WHERE i.run_id=r.id AND i.command_name='create_run' AND i.request_hash=?)
			 OR EXISTS(SELECT 1 FROM agent_run_children c WHERE c.run_id=r.id AND c.request_hash=?))
			 AND NOT EXISTS(SELECT 1 FROM agent_run_executions e WHERE e.run_id=r.id AND e.state<>'closed')
			 AND NOT EXISTS(SELECT 1 FROM agent_operations o WHERE o.run_id=r.id AND o.state IN ('accepted','dispatched','unknown'))`,
				[
					scope.executionGeneration,
					now,
					now,
					scope.runId,
					scope.userId,
					scope.appId,
					expectedRunVersion,
					now,
					creationHash,
					creationHash,
				],
			);
			return inserted.changes === 1;
		});
	}

	closeAdmission(scope: StoredOperationScope, now: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const changed = await tx.run(
				`UPDATE agent_run_executions SET state='draining',updated_at=? WHERE run_id=? AND generation=? AND state='open'
			 AND EXISTS(SELECT 1 FROM agent_runs r WHERE r.id=run_id AND r.user_id=? AND r.app_id=?)`,
				[now, scope.runId, scope.executionGeneration, scope.userId, scope.appId],
			);
			return changed.changes === 1;
		});
	}

	closed(scope: StoredOperationScope, now: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const result = await tx.run(
				`UPDATE agent_run_executions SET state='closed',updated_at=? WHERE run_id=? AND generation=? AND state='draining'
			 AND EXISTS(SELECT 1 FROM agent_runs r WHERE r.id=run_id AND r.user_id=? AND r.app_id=?)
			 AND NOT EXISTS(SELECT 1 FROM agent_operations o WHERE o.run_id=agent_run_executions.run_id AND o.state IN ('accepted','dispatched'))`,
				[now, scope.runId, scope.executionGeneration, scope.userId, scope.appId],
			);
			return result.changes === 1;
		});
	}

	admit(intent: StoredOperationIntent, prepare: () => StoredOperationPreparation): Promise<StoredOperationAdmission> {
		return this.db.transaction(async (tx) => {
			// Original receipts are read before any current binding/generation admission.
			const original = await tx.one(
				'SELECT * FROM agent_operations WHERE run_id=? AND user_id=? AND app_id=? AND caller_id=? AND operation_key=?',
				[intent.scope.runId, intent.scope.userId, intent.scope.appId, intent.callerId, intent.operationKey],
			);
			if (original) {
				const operation = operationRow(original);
				return operation.requestHash === intent.requestHash
					? { status: 'replayed', operation }
					: { status: 'idempotency_conflict' };
			}
			if (!(await isOpen(tx, intent.scope))) {
				return { status: 'scope_closed' };
			}
			if (intent.parentId !== null) {
				const parent = await getById(tx, intent.scope, intent.parentId);
				if (!parent || parent.state !== 'dispatched') {
					return { status: 'scope_closed' };
				}
			}
			const prepared = prepare();
			if (!prepared.record) {
				return { status: 'ephemeral' };
			}
			await tx.run(
				`INSERT INTO agent_operations(id,user_id,app_id,run_id,execution_generation,parent_id,caller_id,operation_key,request_hash,kind,label,binding_json,arguments_json,state,revision,result_json,failure_code,created_at,updated_at,sequence)
			 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'accepted',1,NULL,NULL,?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_operations))`,
				[
					intent.id,
					intent.scope.userId,
					intent.scope.appId,
					intent.scope.runId,
					intent.scope.executionGeneration,
					intent.parentId,
					intent.callerId,
					intent.operationKey,
					intent.requestHash,
					prepared.kind,
					prepared.label,
					prepared.bindingJson,
					prepared.argumentsJson,
					intent.now,
					intent.now,
				],
			);
			const operation = await getById(tx, intent.scope, intent.id);
			if (!operation) {
				throw new Error('Accepted operation missing');
			}
			return { status: 'accepted', operation };
		});
	}

	async get(scope: StoredOperationScope, callerId: string, operationKey: string): Promise<StoredOperation | null> {
		const row = await this.db.one(
			'SELECT * FROM agent_operations WHERE run_id=? AND user_id=? AND app_id=? AND caller_id=? AND operation_key=?',
			[scope.runId, scope.userId, scope.appId, callerId, operationKey],
		);
		return row === null ? null : operationRow(row);
	}

	dispatch(
		scope: StoredOperationScope,
		id: string,
		revision: number,
		authority: StoredOperationDispatchAuthority,
		now: number,
		admitBudget: Parameters<OperationStorage['dispatch']>[5],
	): Promise<StoredOperationMutation> {
		return this.db.transaction(async (tx) => {
			const original = await getById(tx, scope, id);
			if (!original) {
				return { status: 'not_found' };
			}
			if (
				original.revision !== revision ||
				original.state !== 'accepted' ||
				revision >= Number.MAX_SAFE_INTEGER
			) {
				return { status: 'version_conflict' };
			}
			if (!(await isOpen(tx, scope))) {
				return { status: 'scope_closed' };
			}
			if (!(await currentDispatchAuthority(tx, original, authority, now))) {
				return { status: 'scope_closed' };
			}
			const usage = await executionUsage(tx, scope.runId, scope.userId);
			admitBudget(
				await frozenExecution(tx, scope.runId),
				usage,
				original.kind,
				authority.modelReservation?.tokens ?? null,
			);
			if (original.kind === 'model') {
				if (!authority.provider || !authority.modelReservation) {
					throw new Error('Model dispatch requires its real provider and token reservation');
				}
				await tx.run(
					`INSERT INTO agent_operation_model_reservations(operation_id,root_id,provider_id,reserved_tokens,input_tokens,output_tokens)
				 VALUES(?,?,?,?,NULL,NULL)`,
					[id, usage.rootId, authority.provider.id, authority.modelReservation.tokens],
				);
			}
			await tx.run(
				"UPDATE agent_operations SET state='dispatched',revision=revision+1,updated_at=? WHERE id=? AND revision=? AND state='accepted'",
				[now, id, revision],
			);
			await tx.run('INSERT INTO agent_operation_authorities(operation_id,proof_json) VALUES(?,?)', [
				id,
				JSON.stringify(authority),
			]);
			const operation = await getById(tx, scope, id);
			if (!operation) {
				throw new Error('Dispatched operation missing');
			}
			return { status: 'ok', operation };
		});
	}

	verifyEffect(
		scope: StoredOperationScope,
		id: string,
		requestHash: string,
		label: string,
		allowCompleted: boolean,
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const current = await currentOperation(
				tx,
				{
					userId: scope.userId,
					appId: scope.appId,
					runId: scope.runId,
					operationId: id,
					operationHash: requestHash,
				},
				{ labels: [label], allowCompleted },
			);
			return current !== null && current.operation.scope.executionGeneration === scope.executionGeneration;
		});
	}

	evidence(scope: StoredOperationScope, id: string): ReturnType<OperationStorage['evidence']> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				`WITH RECURSIVE captured(id) AS (
			 SELECT id FROM agent_operations WHERE id=? AND user_id=? AND app_id=? AND run_id=?
			 UNION SELECT o.id FROM agent_operations o JOIN captured c ON o.parent_id=c.id
			 WHERE o.user_id=? AND o.app_id=? AND o.run_id=?)
			 SELECT o.*,proof.proof_json FROM captured c JOIN agent_operations o ON o.id=c.id
			 LEFT JOIN agent_operation_authorities proof ON proof.operation_id=o.id ORDER BY o.created_at,o.id`,
				[id, scope.userId, scope.appId, scope.runId, scope.userId, scope.appId, scope.runId],
			);
			return rows.map((row) => ({
				operation: operationRow(row),
				capabilities: operationCapabilities(operationRow(row)),
				authority: row.proof_json === null ? null : operationAuthority(row.proof_json),
			}));
		});
	}

	confirmArtifacts(
		scope: StoredOperationScope,
		id: string,
		requestHash: string,
		artifactIds: readonly string[],
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			const original = await getById(tx, scope, id);
			if (
				!original ||
				original.requestHash !== requestHash ||
				original.kind !== 'effect' ||
				original.state === 'accepted'
			) {
				throw new Error('Native artifact evidence owner missing');
			}
			for (const artifactId of artifactIds) {
				const artifact = await tx.one(
					`SELECT id,version,sha256,size_bytes FROM agent_artifacts
				 WHERE id=? AND user_id=? AND app_id=? AND sha256 IS NOT NULL AND ready_at IS NOT NULL`,
					[artifactId, scope.userId, scope.appId],
				);
				if (!artifact) {
					throw new Error('Confirmed native output artifact missing');
				}
				const originalEvidence = await tx.one(
					`SELECT artifact_version,sha256,size_bytes FROM agent_operation_artifacts
				 WHERE operation_id=? AND artifact_id=?`,
					[id, artifactId],
				);
				if (
					originalEvidence &&
					(originalEvidence.artifact_version !== artifact.version ||
						originalEvidence.sha256 !== artifact.sha256 ||
						originalEvidence.size_bytes !== artifact.size_bytes)
				) {
					throw new Error('Confirmed native output artifact changed');
				}
				await tx.run(
					`INSERT INTO agent_operation_artifacts(operation_id,artifact_id,artifact_version,sha256,size_bytes)
				 VALUES(?,?,?,?,?) ON CONFLICT(operation_id,artifact_id) DO NOTHING`,
					[
						id,
						artifactId,
						storedInteger(artifact.version, 1),
						storedText(artifact.sha256),
						storedInteger(artifact.size_bytes),
					],
				);
			}
		});
	}

	finish(
		scope: StoredOperationScope,
		id: string,
		revision: number,
		terminal: StoredOperationTerminal,
		now: number,
		diagnosticCode: AgentRunFailureCode | null,
	): Promise<StoredOperationMutation> {
		return this.db.transaction(async (tx) => {
			const original = await getById(tx, scope, id);
			if (!original) {
				return { status: 'not_found' };
			}
			if (
				original.revision !== revision ||
				(original.state !== 'accepted' && original.state !== 'dispatched') ||
				original.revision >= Number.MAX_SAFE_INTEGER
			) {
				return { status: 'version_conflict' };
			}
			if (terminal.state === 'completed' && original.state !== 'dispatched') {
				return { status: 'version_conflict' };
			}
			const pending = await tx.one(
				"SELECT id FROM agent_operations WHERE parent_id=? AND state IN ('accepted','dispatched') LIMIT 1",
				[id],
			);
			if (pending) {
				return { status: 'children_pending' };
			}
			const unknown = await tx.one(
				"SELECT id FROM agent_operations WHERE parent_id=? AND state='unknown' LIMIT 1",
				[id],
			);
			const state = unknown ? 'unknown' : terminal.state;
			const resultJson = state === 'completed' && terminal.state === 'completed' ? terminal.resultJson : null;
			const failureCode = state === 'failed' && terminal.state === 'failed' ? terminal.failureCode : null;
			if (original.kind === 'model' && resultJson !== null) {
				const result: unknown = JSON.parse(resultJson);
				if (
					typeof result !== 'object' ||
					result === null ||
					!('inputTokens' in result) ||
					!('outputTokens' in result) ||
					(result.inputTokens === null) !== (result.outputTokens === null) ||
					(result.inputTokens !== null &&
						(typeof result.inputTokens !== 'number' ||
							!Number.isSafeInteger(result.inputTokens) ||
							result.inputTokens < 0 ||
							typeof result.outputTokens !== 'number' ||
							!Number.isSafeInteger(result.outputTokens) ||
							result.outputTokens < 0))
				) {
					throw new Error('Invalid model operation usage');
				}
				await tx.run(
					'UPDATE agent_operation_model_reservations SET input_tokens=?,output_tokens=? WHERE operation_id=?',
					[
						result.inputTokens === null ? null : storedInteger(result.inputTokens),
						result.outputTokens === null ? null : storedInteger(result.outputTokens),
						id,
					],
				);
			}
			await tx.run(
				'UPDATE agent_operations SET state=?,revision=revision+1,result_json=?,failure_code=?,updated_at=? WHERE id=? AND revision=?',
				[state, resultJson, failureCode, now, id, revision],
			);
			if (diagnosticCode !== null && (state === 'failed' || state === 'unknown')) {
				await tx.run('INSERT INTO agent_operation_diagnostics(operation_id,code) VALUES (?,?)', [
					id,
					diagnosticCode,
				]);
			}
			const operation = await getById(tx, scope, id);
			if (!operation) {
				throw new Error('Finished operation missing');
			}
			return { status: 'ok', operation };
		});
	}

	interrupt(now: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run("UPDATE agent_run_executions SET state='closed',updated_at=? WHERE state<>'closed'", [now]);
			await tx.run(
				"UPDATE agent_operations SET state=CASE state WHEN 'accepted' THEN 'cancelled' ELSE 'unknown' END,revision=revision+1,updated_at=? WHERE state IN ('accepted','dispatched')",
				[now],
			);
		});
	}
}
