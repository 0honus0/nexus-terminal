import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
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
	await tx.run(
		"UPDATE agent_governance_approvals SET status='superseded',version=version+1 WHERE user_id=? AND app_id=? AND status='requested'",
		[userId, appId],
	);
}

export async function assertPendingApprovalRevisions(tx: SqlExecutor, userId: number, appId: string): Promise<void> {
	const exhausted = await tx.one(
		"SELECT id FROM agent_governance_approvals WHERE user_id=? AND app_id=? AND status='requested' AND version>=? LIMIT 1",
		[userId, appId, Number.MAX_SAFE_INTEGER],
	);
	if (exhausted !== null) {
		throw new Error('Agent approval revision exhausted');
	}
}
