import { readTagRow } from './tag-management-sql.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** Called only with the import transaction's explicit executor. */
export async function findOrCreateTag(tx: SqlExecutor, name: string): Promise<number> {
	const now = Date.now();
	await tx.run('INSERT INTO tags(name,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING', [
		name,
		now,
		now,
	]);
	const row = await tx.one('SELECT id,name,version,created_at,updated_at FROM tags WHERE name=?', [name]);
	if (!row) {
		throw new Error('Corrupt tag identity');
	}
	return readTagRow(row).id;
}
