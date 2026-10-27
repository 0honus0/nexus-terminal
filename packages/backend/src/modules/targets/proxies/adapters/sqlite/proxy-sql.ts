import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { ProxyWrite } from '../../storage/proxy-storage.js';
import { ProxyStorageRefusal } from '../../storage/proxy-storage.js';
import { readProxyRow } from './proxy-management-sql.js';

/** Called only with the import transaction's explicit executor. */
export async function findOrCreateProxy(tx: SqlExecutor, data: ProxyWrite): Promise<number> {
	const identity = [data.name, data.type, data.host, data.port];
	const query = 'SELECT * FROM proxies WHERE name=? AND type=? AND host=? AND port=?';
	const existing = await tx.one(query, identity);
	let row = existing === null ? null : readProxyRow(existing);
	if (row && (row.username !== data.username || data.encryptedPassword !== undefined)) {
		throw new ProxyStorageRefusal();
	}
	if (!row) {
		const now = Date.now();
		const inserted = await tx.run(
			'INSERT INTO proxies(name,type,host,port,username,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
			[...identity, data.username, now, now],
		);
		const created = await tx.one(query, identity);
		row = created === null ? null : readProxyRow(created);
		if (row && data.encryptedPassword !== undefined && data.encryptedPassword !== null) {
			await tx.run('INSERT INTO proxy_credentials(proxy_id,encrypted_password,updated_at) VALUES(?,?,?)', [
				inserted.lastId,
				data.encryptedPassword,
				now,
			]);
		}
	}
	if (!row) {
		throw new Error('Corrupt proxy identity');
	}
	return row.id;
}
