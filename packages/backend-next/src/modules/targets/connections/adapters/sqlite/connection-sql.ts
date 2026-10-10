import { TargetFailure } from '../../../target-failure.js';
import type { SqliteRuntime, SqlExecutor } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ConnectionData,
	StoredConnection,
	ConnectionStorage,
	MutationResult,
} from '../../storage/connection-storage.js';
import { validateAffectedSshGraph } from './ssh-graph-sql.js';

const columnNames = [
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
const propertyNames = [
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

interface ConnectionColumnValues {
	columns: string[];
	parameters: (string | number | null)[];
}

function buildColumnValues(input: Partial<ConnectionData>): ConnectionColumnValues {
	const columns: string[] = [];
	const parameters: (string | number | null)[] = [];
	propertyNames.forEach((key, index) => {
		const value = input[key];
		if (value !== undefined) {
			columns.push(columnNames[index]);
			parameters.push(value);
		}
	});
	return { columns, parameters };
}

function decodeInteger(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new Error('Corrupt integer');
	}
	return value;
}

function decodeString(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt string');
	}
	return value;
}

function decodeNullableString(value: unknown): string | null {
	if (value === null) {
		return null;
	}
	return decodeString(value);
}

async function readConnection(tx: SqlExecutor, id: number): Promise<StoredConnection | null> {
	const row = await tx.one('SELECT * FROM connections WHERE id=?', [id]);
	if (!row) {
		return null;
	}
	const tags = await tx.all('SELECT tag_id FROM connection_tags WHERE connection_id=? ORDER BY tag_id', [id]);
	const jumps = await tx.all(
		'SELECT jump_connection_id,position FROM connection_jumps WHERE connection_id=? ORDER BY position',
		[id],
	);
	jumps.forEach((jump, index) => {
		if (jump.position !== index) {
			throw new Error('Corrupt jump positions');
		}
	});
	const type = decodeString(row.type);
	if (type !== 'SSH' && type !== 'RDP' && type !== 'VNC') {
		throw new Error('Corrupt connection type');
	}
	const route = decodeString(row.route);
	if (route !== 'direct' && route !== 'proxy' && route !== 'jump') {
		throw new Error('Corrupt route');
	}
	const item: StoredConnection = {
		id: decodeInteger(row.id),
		name: decodeString(row.name),
		type,
		host: decodeString(row.host),
		port: decodeInteger(row.port),
		username: decodeString(row.username),
		route,
		proxyId: row.proxy_id === null ? null : decodeInteger(row.proxy_id),
		notes: decodeNullableString(row.notes),
		rdpRemoteApp: decodeNullableString(row.rdp_remote_app),
		rdpRemoteAppDirectory: decodeNullableString(row.rdp_remote_app_directory),
		rdpRemoteAppArguments: decodeNullableString(row.rdp_remote_app_arguments),
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at),
		updatedAt: decodeInteger(row.updated_at),
		tagIds: tags.map((tag) => decodeInteger(tag.tag_id)),
		jumpIds: jumps.map((jump) => decodeInteger(jump.jump_connection_id)),
	};
	if (item.route === 'jump' && (!item.jumpIds.length || item.type !== 'SSH')) {
		throw new Error('Corrupt jump route');
	}
	if (item.route !== 'jump' && item.jumpIds.length) {
		throw new Error('Corrupt jump relation');
	}
	return item;
}

async function readRequiredConnection(tx: SqlExecutor, id: number): Promise<StoredConnection> {
	const connection = await readConnection(tx, id);
	if (connection === null) {
		throw new Error('Connection missing after write');
	}
	return connection;
}

async function writeRelationships(tx: SqlExecutor, id: number, data: ConnectionData): Promise<void> {
	if (data.route === 'jump' && (data.type !== 'SSH' || data.jumpIds.length === 0)) {
		throw new TargetFailure('invalid_input');
	}
	if (data.route !== 'jump' && data.jumpIds.length) {
		throw new TargetFailure('invalid_input');
	}
	if ((data.route === 'proxy' && data.proxyId === null) || (data.route !== 'proxy' && data.proxyId !== null)) {
		throw new TargetFailure('invalid_input');
	}
	if (new Set(data.jumpIds).size !== data.jumpIds.length || new Set(data.tagIds).size !== data.tagIds.length) {
		throw new TargetFailure('invalid_input');
	}
	for (const target of data.jumpIds) {
		const row = await tx.one('SELECT type FROM connections WHERE id=?', [target]);
		if (!row || row.type !== 'SSH' || target === id) {
			throw new TargetFailure('invalid_input');
		}
	}
	await tx.run('DELETE FROM connection_jumps WHERE connection_id=?', [id]);
	for (let i = 0; i < data.jumpIds.length; i++) {
		await tx.run('INSERT INTO connection_jumps(connection_id,position,jump_connection_id) VALUES(?,?,?)', [
			id,
			i,
			data.jumpIds[i],
		]);
	}
	await validateAffectedSshGraph(tx, id);
	await tx.run('DELETE FROM connection_tags WHERE connection_id=?', [id]);
	for (const tag of data.tagIds) {
		await tx.run('INSERT INTO connection_tags(connection_id,tag_id) VALUES(?,?)', [id, tag]);
	}
}

export async function insertConnectionInTransaction(tx: SqlExecutor, data: ConnectionData): Promise<StoredConnection> {
	const { columns, parameters } = buildColumnValues(data);
	const now = Date.now();
	const result = await tx.run(
		`INSERT INTO connections(${columns.join(',')},version,created_at,updated_at) VALUES(${columns.map(() => '?').join(',')},1,?,?)`,
		[...parameters, now, now],
	);
	await writeRelationships(tx, result.lastId, data);
	return readRequiredConnection(tx, result.lastId);
}

export class ConnectionSqliteAdapter implements ConnectionStorage {
	constructor(private readonly db: SqliteRuntime) {}

	list(): Promise<StoredConnection[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all('SELECT id FROM connections ORDER BY id');
			const items: StoredConnection[] = [];
			for (const row of rows) {
				const connection = await readConnection(tx, decodeInteger(row.id));
				if (connection) {
					items.push(connection);
				}
			}
			return items;
		});
	}

	get(id: number): Promise<StoredConnection | null> {
		return this.db.transaction((tx) => readConnection(tx, id));
	}

	create(data: ConnectionData): Promise<StoredConnection> {
		return this.db.transaction((tx) => insertConnectionInTransaction(tx, data));
	}

	update(id: number, expectedVersion: number, changes: Partial<ConnectionData>): Promise<MutationResult> {
		return this.db.transaction(async (tx) => {
			const old = await readConnection(tx, id);
			if (!old) {
				return { status: 'not_found' };
			}
			if (old.version !== expectedVersion) {
				return { status: 'version_conflict' };
			}
			if (old.type === 'SSH' && changes.type && changes.type !== 'SSH') {
				if (await tx.one('SELECT 1 AS present FROM connection_credentials WHERE connection_id=?', [id])) {
					throw new TargetFailure('reference_in_use');
				}
				const refs = await tx.one(
					'SELECT 1 AS present FROM connection_jumps WHERE jump_connection_id=? LIMIT 1',
					[id],
				);
				if (refs) {
					throw new TargetFailure('reference_in_use');
				}
			}
			const merged: ConnectionData = { ...old, ...changes };
			const { columns, parameters } = buildColumnValues(changes);
			const timestamp = Date.now();
			const update = await tx.run(
				`UPDATE connections SET ${[...columns.map((column) => column + '=?'), 'version=version+1', 'updated_at=?'].join(',')} WHERE id=? AND version=?`,
				[...parameters, timestamp, id, expectedVersion],
			);
			if (!update.changes) {
				return { status: 'version_conflict' };
			}
			await writeRelationships(tx, id, merged);
			return { status: 'updated', value: await readRequiredConnection(tx, id) };
		});
	}

	clone(id: number, name: string): Promise<StoredConnection | null> {
		return this.db.transaction(async (tx) => {
			const old = await readConnection(tx, id);
			if (!old) {
				return null;
			}
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
			if (refs) {
				throw new TargetFailure('reference_in_use');
			}
			return (await tx.run('DELETE FROM connections WHERE id=?', [id])).changes > 0;
		});
	}

	setTags(id: number, expectedVersion: number, tagIds: number[]): Promise<MutationResult> {
		return this.update(id, expectedVersion, { tagIds });
	}
}
