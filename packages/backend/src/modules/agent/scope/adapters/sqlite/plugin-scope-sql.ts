import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredPluginScopeActivation } from '../../storage/plugin-scope-storage.js';
import { initializeAppPolicy, invalidateAppPolicy } from '../../../governance/adapters/sqlite/policy-write.js';
import { cancelRunsInScope } from '../../../runs/adapters/sqlite/run-fence.js';
import { assertAppRevisionAvailable } from './app-row.js';

/** Participates in the installing owner's transaction; it alone writes Scope declarations and Apps. */
export async function activatePluginScope(tx: SqlExecutor, input: StoredPluginScopeActivation): Promise<void> {
	const definition = await tx.one(
		'SELECT content_hash,source_kind FROM agent_app_definitions WHERE id=? AND version=?',
		[input.definitionId, input.definitionVersion],
	);
	if (definition !== null) {
		if (definition.source_kind !== 'plugin' || definition.content_hash !== input.contentHash) {
			throw new Error('Immutable plugin declaration conflict');
		}
	} else {
		await tx.run("INSERT INTO agent_app_definitions VALUES(?,?,?,?,1,0,'plugin')", [
			input.definitionId,
			input.definitionVersion,
			input.displayName,
			input.contentHash,
		]);
		for (const capability of input.capabilities) {
			await tx.run('INSERT INTO agent_app_declared_capabilities VALUES(?,?,?)', [
				input.definitionId,
				input.definitionVersion,
				capability,
			]);
		}
	}
	const current = await tx.one('SELECT user_id,definition_id,definition_version,version FROM agent_apps WHERE id=?', [
		input.appId,
	]);
	if (current !== null) {
		if (current.user_id !== input.userId || current.definition_id !== input.definitionId) {
			throw new Error('Plugin App ownership conflict');
		}
		assertAppRevisionAvailable(current.version);
		// Activation preserves grants but disables the App. New version never inherits a running lease.
		await tx.run('UPDATE agent_apps SET definition_version=?,enabled=0,version=version+1,updated_at=? WHERE id=?', [
			input.definitionVersion,
			input.now,
			input.appId,
		]);
		await invalidateAppPolicy(tx, input.userId, input.appId);
		await cancelRunsInScope(tx, input.userId, input.appId, input.now);
	} else {
		await tx.run(
			'INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,version,updated_at,is_default,created_at) VALUES(?,?,?,?,?,0,1,?,0,?)',
			[
				input.appId,
				input.userId,
				input.displayName,
				input.definitionId,
				input.definitionVersion,
				input.now,
				input.now,
			],
		);
		await initializeAppPolicy(tx, input.userId, input.appId, []);
	}
}

export async function retirePluginScope(tx: SqlExecutor, userId: number, appId: string, now: number): Promise<void> {
	const current = await tx.one('SELECT version FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
	if (current === null) {
		throw new Error('Plugin App missing during retirement');
	}
	assertAppRevisionAvailable(current.version);
	const updated = await tx.run(
		'UPDATE agent_apps SET enabled=0,version=version+1,updated_at=? WHERE user_id=? AND id=?',
		[now, userId, appId],
	);
	if (updated.changes !== 1) {
		throw new Error('Plugin App missing during retirement');
	}
	await invalidateAppPolicy(tx, userId, appId);
	await cancelRunsInScope(tx, userId, appId, now);
}
