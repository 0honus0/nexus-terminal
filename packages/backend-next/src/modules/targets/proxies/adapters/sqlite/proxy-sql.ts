import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ProxyData } from '../../storage/proxy-storage.js';

/** Called only with the import transaction's explicit executor. */
export async function findOrCreateProxy(tx: SqlExecutor, data: ProxyData): Promise<number> {
	const identity = [data.name, data.type, data.host, data.port];
	const query = 'SELECT id FROM proxies WHERE name=? AND type=? AND host=? AND port=?';
	let row = await tx.one(query, identity);
	if (!row) {
		const now = Date.now();
		await tx.run('INSERT INTO proxies(name,type,host,port,username,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [
			...identity,
			data.username,
			now,
			now,
		]);
		row = await tx.one(query, identity);
	}
	if (!row || typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id < 1) {
		throw new Error('Corrupt proxy identity');
	}
	return row.id;
}
