// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

import type { StoredGrant } from '../../storage/governance-storage.js';

import { scopeJson, assertRevisionAvailable } from './governance-row.js';

export async function initializeAppPolicy(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	grants: StoredGrant[],
): Promise<void> {
	await tx.run('INSERT INTO agent_governance_policies(user_id,app_id) VALUES(?,?)', [userId, appId]);
	// Called only in the transaction that creates the App; existing defaults are never restored.
	await replaceAppGrants(tx, userId, appId, grants);
}

export async function replaceAppGrants(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	grants: StoredGrant[],
): Promise<void> {
	await tx.run('DELETE FROM agent_governance_grants WHERE user_id=? AND app_id=?', [userId, appId]);
	for (const grant of grants) {
		await tx.run(
			'INSERT INTO agent_governance_grants(user_id,app_id,capability,schema_version,scope_json,granted_at) VALUES(?,?,?,?,?,?)',
			[userId, appId, grant.capability, grant.schemaVersion, scopeJson(grant.scope), grant.grantedAt],
		);
	}
}

export async function invalidateAppPolicy(tx: SqlExecutor, userId: number, appId: string): Promise<void> {
	const current = await tx.one('SELECT policy_revision FROM agent_governance_policies WHERE user_id=? AND app_id=?', [
		userId,
		appId,
	]);
	if (current === null) {
		throw new Error('Missing App governance policy during revocation');
	}
	assertRevisionAvailable(current.policy_revision);
	await assertPendingApprovalRevisions(tx, userId, appId);
	const result = await tx.run(
		'UPDATE agent_governance_policies SET policy_revision=policy_revision+1 WHERE user_id=? AND app_id=?',
		[userId, appId],
	);
	if (result.changes !== 1) {
		throw new Error('Missing App governance policy during revocation');
	}
	await supersedePendingApprovals(tx, userId, appId);
}

export async function assertPendingApprovalRevisions(tx: SqlExecutor, userId: number, appId: string): Promise<void> {
	const exhausted = await tx.one(
		`SELECT a.id FROM agent_operation_approvals a JOIN agent_operations o ON o.id=a.operation_id
		 WHERE o.user_id=? AND o.app_id=? AND a.status IN ('requested','approved') AND a.consumed_at IS NULL AND a.version>=? LIMIT 1`,
		[userId, appId, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted !== null) {
		throw new Error('Agent approval revision exhausted');
	}
}

/** Revocation preserves consumed evidence but invalidates every unused permit in the same policy transaction. */
export async function supersedePendingApprovals(tx: SqlExecutor, userId: number, appId: string): Promise<void> {
	await tx.run(
		`UPDATE agent_operation_approvals SET status='superseded',version=version+1
	 WHERE status IN ('requested','approved') AND consumed_at IS NULL AND operation_id IN
	 (SELECT id FROM agent_operations WHERE user_id=? AND app_id=?)`,
		[userId, appId],
	);
}
