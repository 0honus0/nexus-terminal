import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { OperationActivityStorage, StoredOperationActivity } from '../../storage/operation-activity-storage.js';
import type { StoredOperation } from '../../storage/operation-storage.js';
import { operationRow } from './operation-row.js';
import { operationPresentation } from './operation-activity-row.js';

// Native effects with a tool ancestor belong to that card. Direct effects remain observable for non-model Apps.
const visible = `o.kind='tool' OR (o.kind='effect' AND NOT EXISTS(
 WITH RECURSIVE ancestors(id,parent_id,kind) AS (
 SELECT p.id,p.parent_id,p.kind FROM agent_operations p WHERE p.id=o.parent_id
 UNION SELECT p.id,p.parent_id,p.kind FROM agent_operations p JOIN ancestors a ON p.id=a.parent_id)
 SELECT 1 FROM ancestors WHERE kind='tool'))`;

async function activity(tx: SqlExecutor, operation: StoredOperation): Promise<StoredOperationActivity> {
	const base = operationPresentation(operation);
	const descendants = await tx.all(
		`WITH RECURSIVE effects(id) AS (
	 SELECT id FROM agent_operations WHERE id=?
	 UNION SELECT o.id FROM agent_operations o JOIN effects e ON o.parent_id=e.id)
	 SELECT o.* FROM agent_operations o JOIN effects e ON e.id=o.id ORDER BY o.sequence`,
		[operation.id],
	);
	const artifacts = await tx.all(
		`WITH RECURSIVE captured(id) AS (
	 SELECT id FROM agent_operations WHERE id=? UNION SELECT o.id FROM agent_operations o JOIN captured c ON o.parent_id=c.id)
	 SELECT DISTINCT a.artifact_id FROM agent_operation_artifacts a JOIN captured c ON c.id=a.operation_id ORDER BY a.artifact_id`,
		[operation.id],
	);
	const artifactIds = artifacts.map((artifact) => {
		if (typeof artifact.artifact_id !== 'string') {
			throw new Error('Invalid operation artifact identity');
		}
		return artifact.artifact_id;
	});
	const effects: StoredOperationActivity['effects'] = [];
	const riskOrder = ['read', 'control', 'mutate', 'destructive', 'forbidden'];
	let revision = artifactIds.length;
	let updatedAt = operation.updatedAt;
	for (const row of descendants) {
		const effect = operationRow(row);
		revision += effect.revision;
		updatedAt = Math.max(updatedAt, effect.updatedAt);
		if (effect.kind !== 'effect') {
			continue;
		}
		const details = operationPresentation(effect);
		effects.push({ id: effect.id, requestHash: effect.requestHash });
		if (riskOrder.indexOf(details.risk) > riskOrder.indexOf(base.risk)) {
			base.risk = details.risk;
		}
		base.mutation ||= details.mutation;
	}
	if (!Number.isSafeInteger(revision)) {
		throw new Error('Activity revision exhausted');
	}
	return {
		operation,
		revision,
		updatedAt,
		identity: base.identity,
		name: base.name,
		version: base.version,
		summary: base.summary,
		capability: base.capability,
		risk: base.risk,
		mutation: base.mutation,
		target: base.target === null ? null : { id: base.target.id, version: base.target.version },
		effects,
		outputArtifactIds: artifactIds,
	};
}

export class SqliteOperationActivityStorage implements OperationActivityStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list(
		userId: number,
		appId: string,
		threadId: string,
		before: { createdAt: number; id: string } | null,
		limit: number,
	) {
		return this.db.transaction(async (tx) => {
			if (
				!(await tx.one('SELECT id FROM agent_threads WHERE user_id=? AND app_id=? AND id=?', [
					userId,
					appId,
					threadId,
				]))
			) {
				return null;
			}
			const rows = await tx.all(
				`SELECT o.* FROM agent_operations o JOIN agent_runs r ON r.id=o.run_id
			 WHERE o.user_id=? AND o.app_id=? AND r.thread_id=? AND (${visible})
			 AND (?=1 OR (o.created_at,o.id)<(?,?)) ORDER BY o.created_at DESC,o.id DESC LIMIT ?`,
				[userId, appId, threadId, before === null ? 1 : 0, before?.createdAt ?? 0, before?.id ?? '', limit + 1],
			);
			const items: StoredOperationActivity[] = [];
			for (const row of rows.slice(0, limit).reverse()) {
				items.push(await activity(tx, operationRow(row)));
			}
			return { items, hasMore: rows.length > limit };
		});
	}

	get(userId: number, appId: string, runId: string, id: string): Promise<StoredOperationActivity | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				`SELECT o.* FROM agent_operations o WHERE o.user_id=? AND o.app_id=? AND o.run_id=? AND o.id=? AND (${visible})`,
				[userId, appId, runId, id],
			);
			return row === null ? null : activity(tx, operationRow(row));
		});
	}
}
