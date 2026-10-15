import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { fenceRunSteps } from './run-fence.js';
import { storedInteger, storedText } from './run-participant-sql.js';

/** The bounded direct-child set is fenced in the parent's transaction. */
export async function fenceRunChildren(
	tx: SqlExecutor,
	parentId: string,
	now: number,
	ids: string[] | null = null,
): Promise<string[]> {
	const rows = await tx.all(
		`SELECT r.id,r.version FROM agent_runs r JOIN agent_run_children c ON c.run_id=r.id WHERE c.parent_id=? AND r.status IN ('pending','running','unknown') ORDER BY r.id`,
		[parentId],
	);
	const cancelled: string[] = [];
	for (const row of rows) {
		const id = storedText(row.id);
		if (ids !== null && !ids.includes(id)) {
			continue;
		}
		const version = storedInteger(row.version, 1) + 1;
		const changed = await tx.run(
			"UPDATE agent_runs SET status='cancelled',version=?,updated_at=? WHERE id=? AND version=?",
			[version, now, id, version - 1],
		);
		if (changed.changes !== 1) {
			throw new Error('Lost child fence CAS');
		}
		await tx.run(
			"INSERT INTO agent_run_events(run_id,sequence,event_type,run_version,created_at) VALUES(?,(SELECT COALESCE(MAX(sequence),0)+1 FROM agent_run_events WHERE run_id=?),'run.cancelled',?,?)",
			[id, id, version, now],
		);
		await fenceRunSteps(tx, id, version, now);
		cancelled.push(id);
	}
	return cancelled;
}
