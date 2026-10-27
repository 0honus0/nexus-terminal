import {
	TARGET_CONNECTION_NAME_MAX_BYTES,
	TARGET_CONNECTION_MAX_JUMPS,
	TARGET_CONNECTION_MAX_TAGS,
	TARGET_CONNECTION_HOST_MAX_BYTES,
	TARGET_CONNECTION_USERNAME_MAX_BYTES,
	TARGET_CONNECTION_NOTES_MAX_BYTES,
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

const columnNames = ['name', 'type', 'host', 'port', 'username', 'route', 'proxy_id', 'notes'] as const;
const propertyNames = ['name', 'type', 'host', 'port', 'username', 'route', 'proxyId', 'notes'] as const;

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
		version: decodeInteger(row.version),
		createdAt: decodeInteger(row.created_at, 0),
		updatedAt: decodeInteger(row.updated_at, 0),
		lastConnectedAt:
			row.last_connected_at === null
				? null
				: decodeInteger(row.last_connected_at, decodeInteger(row.created_at, 0)),
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
	return decodeConnection(row, tags, jumps);
}

function decodeConnection(
	row: Record<string, unknown>,
	tags: Record<string, unknown>[],
	jumps: Record<string, unknown>[],
): StoredConnection {
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
			// Read one consistent snapshot with three Worker round trips, independent of catalog size.
			const rows = await tx.all('SELECT * FROM connections ORDER BY id');
			const tagRows = await tx.all(
				'SELECT connection_id,tag_id FROM connection_tags ORDER BY connection_id,tag_id',
			);
			const jumpRows = await tx.all(
				'SELECT connection_id,jump_connection_id,position FROM connection_jumps ORDER BY connection_id,position',
			);
			const tags = new Map<number, Record<string, unknown>[]>();
			const jumps = new Map<number, Record<string, unknown>[]>();
			for (const [source, grouped] of [
				[tagRows, tags],
				[jumpRows, jumps],
			] as const) {
				for (const row of source) {
					const id = decodeInteger(row.connection_id);
					const group = grouped.get(id) ?? [];
					group.push(row);
					grouped.set(id, group);
				}
			}
			return rows.map((row) => {
				const id = decodeInteger(row.id);
				return decodeConnection(row, tags.get(id) ?? [], jumps.get(id) ?? []);
			});
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

	recordConnected(
		id: number,
		version: number,
		createdAt: number,
		type: StoredConnection['type'],
		timestamp: number,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run(
				'UPDATE connections SET last_connected_at=? WHERE id=? AND version=? AND created_at=? AND type=? AND (last_connected_at IS NULL OR last_connected_at<?)',
				[timestamp, id, version, createdAt, type, timestamp],
			);
		});
	}
}
