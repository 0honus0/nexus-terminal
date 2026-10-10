import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { ProxyRecord, ProxyStorage, ProxyMutation, ProxyPatch, ProxyWrite } from '../../storage/proxy-storage.js';

function decodeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new Error('Corrupt proxy integer');
	}
	return value;
}

function decode(row: Record<string, unknown>): ProxyRecord {
	if (
		typeof row.name !== 'string' ||
		typeof row.host !== 'string' ||
		(row.type !== 'HTTP' && row.type !== 'SOCKS5') ||
		!(row.username === null || typeof row.username === 'string')
	) {
		throw new Error('Corrupt proxy record');
	}

	return {
		id: decodeInteger(row.id),
		name: row.name,
		type: row.type,
		host: row.host,
		port: decodeInteger(row.port),
		username: row.username,
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at),
		updatedAt: decodeInteger(row.updated_at),
	};
}

async function readProxyRecord(tx: SqlExecutor, id: number): Promise<ProxyRecord | null> {
	const row = await tx.one(
		'SELECT id,name,type,host,port,username,version,created_at,updated_at FROM proxies WHERE id=?',
		[id],
	);
	return row ? decode(row) : null;
}

async function readRequiredProxyRecord(tx: SqlExecutor, id: number): Promise<ProxyRecord> {
	const record = await readProxyRecord(tx, id);
	if (record === null) {
		throw new Error('proxy missing after write');
	}
	return record;
}

export class SqliteProxyStorage implements ProxyStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list(): Promise<ProxyRecord[]> {
		return this.db.transaction(async (tx) =>
			(
				await tx.all(
					'SELECT id,name,type,host,port,username,version,created_at,updated_at FROM proxies ORDER BY id',
				)
			).map(decode),
		);
	}

	get(id: number): Promise<ProxyRecord | null> {
		return this.db.transaction((tx) => readProxyRecord(tx, id));
	}

	create(data: ProxyWrite): Promise<ProxyRecord> {
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
			return await readRequiredProxyRecord(tx, row.lastId);
		});
	}

	update(id: number, version: number, patch: ProxyPatch): Promise<ProxyMutation> {
		return this.db.transaction(async (tx) => {
			const old = await readProxyRecord(tx, id);
			if (!old) {
				return { status: 'not_found' };
			}
			if (old.version !== version) {
				return { status: 'version_conflict' };
			}
			const allowed = [
				['name', 'name'],
				['type', 'type'],
				['host', 'host'],
				['port', 'port'],
				['username', 'username'],
			] as const;
			const columns: string[] = [];
			const parameters: (string | number | null)[] = [];
			for (const [key, column] of allowed) {
				const value = patch[key];
				if (value !== undefined) {
					columns.push(column + '=?');
					parameters.push(value);
				}
			}
			const now = Date.now();
			await tx.run(
				'UPDATE proxies SET ' +
					[...columns, 'version=version+1', 'updated_at=?'].join(',') +
					' WHERE id=? AND version=?',
				[...parameters, now, id, version],
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
			return { status: 'updated', value: await readRequiredProxyRecord(tx, id) };
		});
	}

	delete(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => (await tx.run('DELETE FROM proxies WHERE id=?', [id])).changes > 0);
	}
}
