import type { SqlExecutor, SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ProxyRecord, ProxyStorage, ProxyMutation, ProxyPatch, ProxyWrite } from '../../storage/proxy-storage.js';

function decode(row: Record<string, unknown>): ProxyRecord {
	if (
		typeof row.name !== 'string' ||
		typeof row.host !== 'string' ||
		!['HTTP', 'SOCKS5'].includes(String(row.type)) ||
		!(row.username === null || typeof row.username === 'string')
	) {
		throw new Error('Corrupt proxy record');
	}
	for (const col of ['id', 'port', 'version', 'created_at', 'updated_at']) {
		if (typeof row[col] !== 'number' || !Number.isSafeInteger(row[col])) {
			throw new Error('Corrupt proxy integer');
		}
	}
	return {
		id: row.id as number,
		name: row.name,
		type: row.type as ProxyRecord['type'],
		host: row.host,
		port: row.port as number,
		username: row.username,
		version: row.version as number,
		createdAt: row.created_at as number,
		updatedAt: row.updated_at as number,
	};
}

async function get(tx: SqlExecutor, id: number): Promise<ProxyRecord | null> {
	const row = await tx.one(
		'SELECT id,name,type,host,port,username,version,created_at,updated_at FROM proxies WHERE id=?',
		[id],
	);
	return row ? decode(row) : null;
}

export class SqliteProxyStorage implements ProxyStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list() {
		return this.db.transaction(async (tx) =>
			(
				await tx.all(
					'SELECT id,name,type,host,port,username,version,created_at,updated_at FROM proxies ORDER BY id',
				)
			).map(decode),
		);
	}

	get(id: number) {
		return this.db.transaction((tx) => get(tx, id));
	}

	create(data: ProxyWrite) {
		return this.db.transaction(async (tx) => {
			const now = Date.now();
			const row = await tx.run(
				'INSERT INTO proxies(name,type,host,port,username,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
				[data.name, data.type, data.host, data.port, data.username, now, now],
			);
			if (data.encryptedPassword) {
				await tx.run('INSERT INTO proxy_credentials(proxy_id,encrypted_password,updated_at) VALUES(?,?,?)', [
					row.lastId,
					data.encryptedPassword,
					now,
				]);
			}
			return (await get(tx, row.lastId))!;
		});
	}

	update(id: number, version: number, patch: ProxyPatch): Promise<ProxyMutation> {
		return this.db.transaction(async (tx) => {
			const old = await get(tx, id);
			if (!old) {
				return { status: 'not_found' };
			}
			if (old.version !== version) {
				return { status: 'version_conflict' };
			}
			const allowed = { name: 'name', type: 'type', host: 'host', port: 'port', username: 'username' } as const;
			const cols: string[] = [],
				vals: (string | number | null)[] = [];
			for (const key of Object.keys(allowed) as (keyof typeof allowed)[]) {
				if (patch[key] !== undefined) {
					cols.push(allowed[key] + '=?');
					vals.push(patch[key] as string | number | null);
				}
			}
			const now = Date.now();
			await tx.run(
				'UPDATE proxies SET ' +
					[...cols, 'version=version+1', 'updated_at=?'].join(',') +
					' WHERE id=? AND version=?',
				[...vals, now, id, version],
			);
			if (patch.encryptedPassword !== undefined) {
				if (patch.encryptedPassword === null) {
					await tx.run('DELETE FROM proxy_credentials WHERE proxy_id=?', [id]);
				} else {
					await tx.run(
						'INSERT INTO proxy_credentials(proxy_id,encrypted_password,updated_at) VALUES(?,?,?) ON CONFLICT(proxy_id) DO UPDATE SET encrypted_password=excluded.encrypted_password,updated_at=excluded.updated_at',
						[id, patch.encryptedPassword, now],
					);
				}
			}
			return { status: 'updated', value: (await get(tx, id))! };
		});
	}

	delete(id: number) {
		return this.db.transaction(async (tx) => (await tx.run('DELETE FROM proxies WHERE id=?', [id])).changes > 0);
	}
}
