import { TargetReferenceInUse } from '../../../storage/target-storage-refusal.js';
import {
	TARGET_PROXY_NAME_MAX_BYTES,
	TARGET_PROXY_HOST_MAX_BYTES,
	TARGET_PROXY_USERNAME_MAX_BYTES,
} from '@nexus-terminal/shared/targets/proxies/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ProxyRecord,
	ProxyStorage,
	ProxyMutation,
	ProxyPatch,
	ProxyWrite,
	StoredProxyCredential,
} from '../../storage/proxy-storage.js';

function decodeInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt proxy integer');
	}
	return value;
}

export function readProxyCredentialRow(row: Record<string, unknown>): StoredProxyCredential {
	if (typeof row.encrypted_password !== 'string' || !row.encrypted_password) {
		throw new Error('Corrupt proxy credential');
	}
	return {
		proxyId: decodeInteger(row.proxy_id),
		encryptedPassword: row.encrypted_password,
		updatedAt: decodeInteger(row.updated_at, 0),
	};
}

export function readProxyRow(row: Record<string, unknown>): ProxyRecord {
	if (
		typeof row.name !== 'string' ||
		typeof row.host !== 'string' ||
		!row.name.trim() ||
		!row.host.trim() ||
		Buffer.byteLength(row.name, 'utf8') > TARGET_PROXY_NAME_MAX_BYTES ||
		Buffer.byteLength(row.host, 'utf8') > TARGET_PROXY_HOST_MAX_BYTES ||
		Buffer.from(row.name, 'utf8').toString('utf8') !== row.name ||
		Buffer.from(row.host, 'utf8').toString('utf8') !== row.host ||
		(row.type !== 'HTTP' && row.type !== 'SOCKS5') ||
		!(
			row.username === null ||
			(typeof row.username === 'string' &&
				Buffer.byteLength(row.username, 'utf8') <= TARGET_PROXY_USERNAME_MAX_BYTES &&
				Buffer.from(row.username, 'utf8').toString('utf8') === row.username)
		)
	) {
		throw new Error('Corrupt proxy record');
	}

	return {
		id: decodeInteger(row.id),
		name: row.name,
		type: row.type,
		host: row.host,
		port: decodeInteger(row.port, 1, 65535),
		username: row.username,
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at, 0),
		updatedAt: decodeInteger(row.updated_at, 0),
	};
}

async function readProxyRecord(tx: SqlExecutor, id: number): Promise<ProxyRecord | null> {
	const row = await tx.one(
		'SELECT id,name,type,host,port,username,version,created_at,updated_at FROM proxies WHERE id=?',
		[id],
	);
	return row ? readProxyRow(row) : null;
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
			).map(readProxyRow),
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
		return this.db.transaction(async (tx) => {
			if (await tx.one('SELECT 1 FROM connections WHERE proxy_id=? LIMIT 1', [id])) {
				throw new TargetReferenceInUse();
			}
			return (await tx.run('DELETE FROM proxies WHERE id=?', [id])).changes > 0;
		});
	}
}
