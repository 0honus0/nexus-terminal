import {
	AGENT_DENYLIST_MAX_TARGETS,
	AGENT_DENYLIST_MAX_REASON_BYTES,
	AGENT_DENYLIST_MAX_REASON_CODE_POINTS,
} from '@nexus-terminal/shared/agent/governance/values';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	StoredTargetDenylist,
	StoredDenylistCommand,
	StoredDenylistMutation,
} from '../../storage/governance-storage.js';
import { integer, string, assertRevisionAvailable } from './governance-row.js';
import { cancelRunsInScope } from '../../../runs/adapters/sqlite/run-fence.js';
import { invalidateAppPolicy } from './policy-write.js';

export async function currentDenylist(tx: SqlReader): Promise<StoredTargetDenylist> {
	const meta = await tx.one('SELECT revision FROM agent_target_denylist_meta WHERE id=1');
	if (meta === null) {
		throw new Error('Missing Agent target policy');
	}
	const rows = await tx.all(
		'SELECT connection_id,reason,changed_by,changed_at FROM agent_target_denylist ORDER BY connection_id LIMIT ?',
		[AGENT_DENYLIST_MAX_TARGETS + 1],
	);
	if (rows.length > AGENT_DENYLIST_MAX_TARGETS) {
		throw new Error('Corrupt Agent target policy capacity');
	}
	return {
		revision: integer(meta.revision, 1),
		entries: rows.map((row) => {
			const reason = string(row.reason);
			if (
				!reason.trim() ||
				Buffer.byteLength(reason, 'utf8') > AGENT_DENYLIST_MAX_REASON_BYTES ||
				[...reason].length > AGENT_DENYLIST_MAX_REASON_CODE_POINTS
			) {
				throw new Error('Corrupt Agent denial reason');
			}
			return {
				connectionId: integer(row.connection_id, 1),
				reason,
				changedBy: integer(row.changed_by, 1),
				changedAt: integer(row.changed_at),
			};
		}),
	};
}

export async function replaceTargetDenylist(
	tx: SqlExecutor,
	input: StoredDenylistCommand,
	now: () => number,
	decide: (current: StoredTargetDenylist) => { revoke: boolean },
): Promise<StoredDenylistMutation | 'version_conflict' | 'not_found'> {
	const current = await currentDenylist(tx);
	if (current.revision !== input.expectedRevision) {
		return 'version_conflict';
	}
	// This is reference/generation integrity; target discovery and application eligibility belong to Targets public + Model/Service.
	for (const target of input.targets) {
		const row = await tx.one('SELECT version FROM connections WHERE id=?', [target.id]);
		if (row === null) {
			return 'not_found';
		}
		if (integer(row.version, 1) !== target.version) {
			return 'version_conflict';
		}
	}
	const task = decide(current);
	assertRevisionAvailable(current.revision, 1);
	const timestamp = now();
	const updated = await tx.run(
		'UPDATE agent_target_denylist_meta SET revision=revision+1 WHERE id=1 AND revision=?',
		[input.expectedRevision],
	);
	if (updated.changes !== 1) {
		throw new Error('Lost target policy CAS');
	}
	await tx.run('DELETE FROM agent_target_denylist');
	for (const target of input.targets) {
		await tx.run(
			'INSERT INTO agent_target_denylist(connection_id,connection_version,reason,changed_by,changed_at) VALUES(?,?,?,?,?)',
			[target.id, target.version, input.reason, input.userId, timestamp],
		);
	}
	// Runs do not yet bind one target. Conservatively fence all old attempts; removal cannot resurrect them.
	if (task.revoke) {
		let cursor = '';
		while (true) {
			const apps = await tx.all('SELECT id,user_id FROM agent_apps WHERE id>? ORDER BY id LIMIT 128', [cursor]);
			for (const app of apps) {
				const id = string(app.id);
				const userId = integer(app.user_id, 1);
				cursor = id;
				await invalidateAppPolicy(tx, userId, id);
				await cancelRunsInScope(tx, userId, id, timestamp);
			}
			if (apps.length < 128) {
				break;
			}
		}
	}
	return { value: await currentDenylist(tx), revokedRuns: task.revoke };
}
