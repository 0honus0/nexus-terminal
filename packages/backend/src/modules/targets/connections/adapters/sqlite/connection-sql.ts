import {
	TARGET_CONNECTION_NAME_MAX_BYTES,
	TARGET_CONNECTION_MAX_JUMPS,
	TARGET_CONNECTION_MAX_TAGS,
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_NOTES_MAX_BYTES,
	TARGET_RDP_REMOTE_APP_MAX_BYTES,
	TARGET_RDP_REMOTE_APP_DIRECTORY_MAX_BYTES,
	TARGET_RDP_REMOTE_APP_ARGUMENTS_MAX_BYTES,
} from '@nexus-terminal/shared/targets/connections/values';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ConnectionData,
	StoredConnection,
	ConnectionStorage,
	MutationResult,
	ConnectionGraphValidator,
	ConnectionTypeChangeValidator,
	StoredCatalogEntry,
} from '../../storage/connection-storage.js';
import { readSshGraph } from './ssh-graph-sql.js';
import { TargetReferenceInUse } from '../../../storage/target-storage-refusal.js';

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

function decodeInteger(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
		throw new Error('Corrupt integer');
	}
	return value;
}

function decodeString(value: unknown, maxBytes: number, allowEmpty = true): string {
	if (
		typeof value !== 'string' ||
		Buffer.byteLength(value, 'utf8') > maxBytes ||
		Buffer.from(value, 'utf8').toString('utf8') !== value ||
		(!allowEmpty && !value.trim())
	) {
		throw new Error('Corrupt string');
	}
	return value;
}

function decodeNullableString(value: unknown, maxBytes: number): string | null {
	if (value === null) {
		return null;
	}
	return decodeString(value, maxBytes);
}

/** Shared persistent metadata decoder for management and desktop resolution. */
export function readConnectionMetadataRow(row: Record<string, unknown>): Omit<StoredConnection, 'tagIds' | 'jumpIds'> {
	const type = row.type;
	if (type !== 'SSH' && type !== 'RDP' && type !== 'VNC') {
		throw new Error('Corrupt connection type');
	}
	const route = row.route;
	if (route !== 'direct' && route !== 'proxy' && route !== 'jump') {
		throw new Error('Corrupt route');
	}
	if (row.last_connected_at !== null) {
		decodeInteger(row.last_connected_at, 0);
	}
	return {
		id: decodeInteger(row.id),
		name: decodeString(row.name, TARGET_CONNECTION_NAME_MAX_BYTES, false),
		type,
		host: decodeString(row.host, TARGET_CONNECTION_HOST_MAX_BYTES, false),
		port: decodeInteger(row.port, 1, 65535),
		username: decodeString(row.username, TARGET_CONNECTION_USERNAME_MAX_BYTES),
		route,
		proxyId: row.proxy_id === null ? null : decodeInteger(row.proxy_id),
		notes: decodeNullableString(row.notes, TARGET_CONNECTION_NOTES_MAX_BYTES),
		rdpRemoteApp: decodeNullableString(row.rdp_remote_app, TARGET_RDP_REMOTE_APP_MAX_BYTES),
		rdpRemoteAppDirectory: decodeNullableString(
			row.rdp_remote_app_directory,
			TARGET_RDP_REMOTE_APP_DIRECTORY_MAX_BYTES,
		),
		rdpRemoteAppArguments: decodeNullableString(
			row.rdp_remote_app_arguments,
			TARGET_RDP_REMOTE_APP_ARGUMENTS_MAX_BYTES,
		),
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at, 0),
		updatedAt: decodeInteger(row.updated_at, 0),
	};
}

export async function readConnection(tx: SqlReader, id: number): Promise<StoredConnection | null> {
	const row = await tx.one('SELECT * FROM connections WHERE id=?', [id]);
	if (!row) {
		return null;
	}
	const tags = await tx.all('SELECT tag_id FROM connection_tags WHERE connection_id=? ORDER BY tag_id', [id]);
	const jumps = await tx.all(
		'SELECT jump_connection_id,position FROM connection_jumps WHERE connection_id=? ORDER BY position',
		[id],
	);
	if (tags.length > TARGET_CONNECTION_MAX_TAGS || jumps.length > TARGET_CONNECTION_MAX_JUMPS) {
		throw new Error('Corrupt connection relationship capacity');
	}
	jumps.forEach((jump, index) => {
		if (jump.position !== index) {
			throw new Error('Corrupt jump positions');
		}
	});
	const metadata = readConnectionMetadataRow(row);
	const item: StoredConnection = {
		...metadata,
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

async function writeRelationships(
	tx: SqlExecutor,
	id: number,
	data: ConnectionData,
	validateGraph: ConnectionGraphValidator,
): Promise<void> {
	validateGraph(data, await readSshGraph(tx), id);
	await tx.run('DELETE FROM connection_jumps WHERE connection_id=?', [id]);
	for (let i = 0; i < data.jumpIds.length; i++) {
		await tx.run('INSERT INTO connection_jumps(connection_id,position,jump_connection_id) VALUES(?,?,?)', [
			id,
			i,
			data.jumpIds[i],
		]);
	}
	await tx.run('DELETE FROM connection_tags WHERE connection_id=?', [id]);
	for (const tag of data.tagIds) {
		await tx.run('INSERT INTO connection_tags(connection_id,tag_id) VALUES(?,?)', [id, tag]);
	}
}

export async function insertConnectionInTransaction(
	tx: SqlExecutor,
	data: ConnectionData,
	validateGraph: ConnectionGraphValidator,
): Promise<StoredConnection> {
	const { columns, parameters } = buildColumnValues(data);
	const now = Date.now();
	const result = await tx.run(
		`INSERT INTO connections(${columns.join(',')},version,created_at,updated_at) VALUES(${columns.map(() => '?').join(',')},1,?,?)`,
		[...parameters, now, now],
	);
	await writeRelationships(tx, result.lastId, data, validateGraph);
	return readRequiredConnection(tx, result.lastId);
}

export class ConnectionSqliteAdapter implements ConnectionStorage {
	constructor(
		private readonly db: SqliteRuntime,
		private readonly validateGraph: ConnectionGraphValidator,
		private readonly validateTypeChange: ConnectionTypeChangeValidator,
	) {}

	async listEntries(ids: number[]): Promise<StoredCatalogEntry[]> {
		if (ids.length === 0) {
			return [];
		}
		const rows = await this.db.all(
			`SELECT id,version,type,name,host,port,username FROM connections WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
			ids,
		);
		return rows.map((row) => {
			const type = row.type;
			if (type !== 'SSH' && type !== 'RDP' && type !== 'VNC') {
				throw new Error('Corrupt directory connection type');
			}
			const id = decodeInteger(row.id);
			const version = decodeInteger(row.version);
			const port = decodeInteger(row.port, 1, 65535);
			return {
				id,
				version,
				type,
				name: decodeString(row.name, TARGET_CONNECTION_NAME_MAX_BYTES, false),
				host: decodeString(row.host, TARGET_CONNECTION_HOST_MAX_BYTES, false),
				port,
				username: decodeString(row.username, TARGET_CONNECTION_USERNAME_MAX_BYTES),
			};
		});
	}

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
		return this.db.transaction((tx) => insertConnectionInTransaction(tx, data, this.validateGraph));
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
			this.validateTypeChange({
				previousType: old.type,
				nextType: changes.type ?? old.type,
				hasCredential:
					(await tx.one('SELECT 1 AS present FROM connection_credentials WHERE connection_id=?', [id])) !==
					null,
				isJumpTarget:
					(await tx.one('SELECT 1 AS present FROM connection_jumps WHERE jump_connection_id=? LIMIT 1', [
						id,
					])) !== null,
			});
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
			await writeRelationships(tx, id, merged, this.validateGraph);
			return { status: 'updated', value: await readRequiredConnection(tx, id) };
		});
	}

	clone(id: number, name: string): Promise<StoredConnection | null> {
		return this.db.transaction(async (tx) => {
			const old = await readConnection(tx, id);
			if (!old) {
				return null;
			}
			const copy = await insertConnectionInTransaction(tx, { ...old, name }, this.validateGraph);
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
			if (await tx.one('SELECT 1 FROM connection_jumps WHERE jump_connection_id=? LIMIT 1', [id])) {
				throw new TargetReferenceInUse();
			}
			return (await tx.run('DELETE FROM connections WHERE id=?', [id])).changes > 0;
		});
	}

	setTags(id: number, expectedVersion: number, tagIds: number[]): Promise<MutationResult> {
		return this.update(id, expectedVersion, { tagIds });
	}
}
