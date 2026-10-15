import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredGrant } from '../../storage/governance-storage.js';
import { scopeJson } from './governance-row.js';

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
