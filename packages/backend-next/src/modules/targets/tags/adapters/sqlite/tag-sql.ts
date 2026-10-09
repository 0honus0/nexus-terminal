import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';

/** Called only with the import transaction's explicit executor. */
export async function findOrCreateTag(tx: SqlExecutor, name: string): Promise<number> {
	const now = Date.now();
	await tx.run('INSERT INTO tags(name,created_at,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO NOTHING', [
		name,
		now,
		now,
	]);
	const row = await tx.one('SELECT id FROM tags WHERE name=?', [name]);
	if (!row || typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1) {
		throw new Error('Corrupt tag identity');
	}
	return row.id;
}
