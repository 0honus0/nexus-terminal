import type { SqliteRuntime, SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ConnectionData,
	StoredConnection,
	ConnectionStorage,
	MutationResult,
} from '../../storage/connection-storage.js';

const fields = [
	'name',
	'type',
	'host',
	'port',
	'username',
	'route',
	'proxy_id',
	'notes',
	'rdp_remote_app',
	'rdp_remote_app_directory',
	'rdp_remote_app_arguments',
] as const;
const keys = [
	'name',
	'type',
	'host',
	'port',
	'username',
	'route',
	'proxyId',
	'notes',
	'rdpRemoteApp',
	'rdpRemoteAppDirectory',
	'rdpRemoteAppArguments',
] as const;

function columns(input: Partial<ConnectionData>): { cols: string[]; vals: (string | number | null)[] } {
	const cols: string[] = [];
	const vals: (string | number | null)[] = [];
	keys.forEach((key, i) => {
		if (input[key] !== undefined) {
			cols.push(fields[i]);
			vals.push(input[key] as string | number | null);
		}
	});
	return { cols, vals };
}

function number(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error('Corrupt integer');
	return value;
}

function string(value: unknown): string {
	if (typeof value !== 'string') throw new Error('Corrupt string');
	return value;
}

function nullable(value: unknown): string | null {
	if (value === null) return null;
	return string(value);
}

async function read(tx: SqlExecutor, id: number): Promise<StoredConnection | null> {
	const row = await tx.one('SELECT * FROM connections WHERE id=?', [id]);
	if (!row) return null;
	const tags = await tx.all('SELECT tag_id FROM connection_tags WHERE connection_id=? ORDER BY tag_id', [id]);
	const jumps = await tx.all(
		'SELECT jump_connection_id,position FROM connection_jumps WHERE connection_id=? ORDER BY position',
		[id],
	);
	jumps.forEach((j, i) => {
		if (j.position !== i) throw new Error('Corrupt jump positions');
	});
	const type = string(row.type);
	if (!['SSH', 'RDP', 'VNC'].includes(type)) throw new Error('Corrupt connection type');
	const route = string(row.route);
	if (!['direct', 'proxy', 'jump'].includes(route)) throw new Error('Corrupt route');
	const item: StoredConnection = {
		id: number(row.id),
		name: string(row.name),
		type: type as ConnectionData['type'],
		host: string(row.host),
		port: number(row.port),
		username: string(row.username),
		route: route as ConnectionData['route'],
		proxyId: row.proxy_id === null ? null : number(row.proxy_id),
		notes: nullable(row.notes),
		rdpRemoteApp: nullable(row.rdp_remote_app),
		rdpRemoteAppDirectory: nullable(row.rdp_remote_app_directory),
		rdpRemoteAppArguments: nullable(row.rdp_remote_app_arguments),
		version: number(row.version),
		createdAt: number(row.created_at),
		updatedAt: number(row.updated_at),
		tagIds: tags.map((t) => number(t.tag_id)),
		jumpIds: jumps.map((j) => number(j.jump_connection_id)),
	};
	if (item.route === 'jump' && (!item.jumpIds.length || item.type !== 'SSH')) throw new Error('Corrupt jump route');
	if (item.route !== 'jump' && item.jumpIds.length) throw new Error('Corrupt jump relation');
	return item;
}

async function relationships(tx: SqlExecutor, id: number, data: ConnectionData): Promise<void> {
	if (data.route === 'jump' && (data.type !== 'SSH' || data.jumpIds.length === 0))
		throw new Error('Jump requires SSH chain');
	if (data.route !== 'jump' && data.jumpIds.length) throw new Error('Unexpected jump chain');
	if ((data.route === 'proxy' && data.proxyId === null) || (data.route !== 'proxy' && data.proxyId !== null))
		throw new Error('Invalid proxy route');
	if (new Set(data.jumpIds).size !== data.jumpIds.length || new Set(data.tagIds).size !== data.tagIds.length)
		throw new Error('Duplicate relations');
	for (const target of data.jumpIds) {
		const row = await tx.one('SELECT type FROM connections WHERE id=?', [target]);
		if (!row || row.type !== 'SSH' || target === id) throw new Error('Invalid SSH jump reference');
	}
	await tx.run('DELETE FROM connection_jumps WHERE connection_id=?', [id]);
	for (let i = 0; i < data.jumpIds.length; i++)
		await tx.run('INSERT INTO connection_jumps(connection_id,position,jump_connection_id) VALUES(?,?,?)', [
			id,
			i,
			data.jumpIds[i],
		]);
	// A reference can be valid locally and still close a cycle through another SSH hop.
	const cyclic = await tx.one(
		`WITH RECURSIVE chain(id,depth) AS (
		   SELECT jump_connection_id,1 FROM connection_jumps WHERE connection_id=?
		   UNION ALL
		   SELECT j.jump_connection_id,chain.depth+1
		   FROM chain JOIN connection_jumps j ON j.connection_id=chain.id WHERE chain.depth<17
		 ) SELECT 1 AS invalid FROM chain WHERE id=? OR depth>16 LIMIT 1`,
		[id, id],
	);
	if (cyclic) throw new Error('SSH jump chain contains a cycle or exceeds 16 hops');
	await tx.run('DELETE FROM connection_tags WHERE connection_id=?', [id]);
	for (const tag of data.tagIds)
		await tx.run('INSERT INTO connection_tags(connection_id,tag_id) VALUES(?,?)', [id, tag]);
}

export async function insertConnectionInTransaction(tx: SqlExecutor, data: ConnectionData): Promise<StoredConnection> {
	const { cols, vals } = columns(data);
	const now = Date.now();
	const result = await tx.run(
		`INSERT INTO connections(${cols.join(',')},version,created_at,updated_at) VALUES(${cols.map(() => '?').join(',')},1,?,?)`,
		[...vals, now, now],
	);
	await relationships(tx, result.lastId, data);
	return (await read(tx, result.lastId))!;
}

export class ConnectionSqliteAdapter implements ConnectionStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list(): Promise<StoredConnection[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all('SELECT id FROM connections ORDER BY id');
			const items: StoredConnection[] = [];
			for (const r of rows) {
				const c = await read(tx, number(r.id));
				if (c) items.push(c);
			}
			return items;
		});
	}

	get(id: number): Promise<StoredConnection | null> {
		return this.db.transaction((tx) => read(tx, id));
	}

	create(data: ConnectionData): Promise<StoredConnection> {
		return this.db.transaction((tx) => insertConnectionInTransaction(tx, data));
	}

	update(id: number, expectedVersion: number, changes: Partial<ConnectionData>): Promise<MutationResult> {
		return this.db.transaction(async (tx) => {
			const old = await read(tx, id);
			if (!old) return { status: 'not_found' };
			if (old.version !== expectedVersion) return { status: 'version_conflict' };
			if (old.type === 'SSH' && changes.type && changes.type !== 'SSH') {
				if (await tx.one('SELECT 1 AS present FROM connection_credentials WHERE connection_id=?', [id])) {
					throw new Error('Remove SSH credentials before changing connection type');
				}
				const refs = await tx.one(
					'SELECT 1 AS present FROM connection_jumps WHERE jump_connection_id=? LIMIT 1',
					[id],
				);
				if (refs) throw new Error('Connection is referenced as SSH jump');
			}
			const merged: ConnectionData = { ...old, ...changes };
			const { cols, vals } = columns(changes);
			const timestamp = Date.now();
			const update = await tx.run(
				`UPDATE connections SET ${[...cols.map((c) => c + '=?'), 'version=version+1', 'updated_at=?'].join(',')} WHERE id=? AND version=?`,
				[...vals, timestamp, id, expectedVersion],
			);
			if (!update.changes) return { status: 'version_conflict' };
			await relationships(tx, id, merged);
			return { status: 'updated', value: (await read(tx, id))! };
		});
	}

	clone(id: number, name: string): Promise<StoredConnection | null> {
		return this.db.transaction(async (tx) => {
			const old = await read(tx, id);
			if (!old) return null;
			const copy = await insertConnectionInTransaction(tx, { ...old, name });
			// Cloning must preserve authentication as well as visible metadata.
			// All three statements participate in the same transaction.
			await tx.run(
				'INSERT INTO connection_credentials(connection_id,auth_method,encrypted_password,ssh_key_id,updated_at) SELECT ?,auth_method,encrypted_password,ssh_key_id,? FROM connection_credentials WHERE connection_id=?',
				[copy.id, Date.now(), id],
			);
			return copy;
		});
	}

	delete(id: number): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const refs = await tx.one('SELECT 1 AS present FROM connection_jumps WHERE jump_connection_id=? LIMIT 1', [
				id,
			]);
			if (refs) throw new Error('Connection is referenced as SSH jump');
			return (await tx.run('DELETE FROM connections WHERE id=?', [id])).changes > 0;
		});
	}

	setTags(id: number, expectedVersion: number, tagIds: number[]): Promise<MutationResult> {
		return this.update(id, expectedVersion, { tagIds });
	}
}
