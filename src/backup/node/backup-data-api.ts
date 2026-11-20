import { isDeepStrictEqual } from 'node:util';
import { sql, type QueryExecutorProvider, type Kysely } from 'kysely';
import { z } from 'zod';
import type { DatabaseApi } from '../../database/node/database-api.js';
import type { CryptoApi } from '../../crypto/node/crypto-api.js';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import { BackupDeclarationSchema, BackupPackageSchema, BackupTableSchema, type BackupTable } from '../backup-types.js';
import {
	BackupStorage,
	backupTableName,
	verifyBackupTable,
	type BackupRow as Row,
	type BackupTables,
} from './backup-storage.js';

export const backupDataLimit = 16 * 1024 * 1024;

const CellSchema = z.union([
	z.string(),
	z.number(),
	z.null(),
	z.strictObject({ bytes: z.string(), storage: z.enum(['blob', 'text']) }),
]);

const ArchiveSchema = z.strictObject({
	packages: z.array(BackupPackageSchema).optional(),
	entries: z.array(
		z.strictObject({
			pluginId: z.string(),
			pluginVersion: z.string(),
			table: BackupTableSchema,
			rows: z.array(z.record(z.string(), CellSchema)),
		}),
	),
});

type Archive = z.infer<typeof ArchiveSchema>;

type ArchiveEntry = Archive['entries'][number];

type Cell = z.infer<typeof CellSchema>;

type Connection = Kysely<BackupTables>;

interface Mutation {
	readonly name: string;
	readonly keys: readonly string[];
	readonly before?: Row;
	readonly changes?: Row;
}

interface ReferenceColumn {
	readonly child: string;
	readonly id: number;
	readonly seq: number;
	readonly from: string;
	readonly to: string | null;
	readonly on_delete: string;
	readonly on_update: string;
}

async function loadWriteGuards(db: Connection, mutations: readonly Mutation[]) {
	const guards = new Map<string, ReferenceColumn[][]>();
	for (const name of new Set(mutations.map((mutation) => mutation.name))) {
		const trigger =
			await sql`select 1 from sqlite_schema where type = 'trigger' and lower(tbl_name) = ${name}`.execute(db);
		if (trigger.rows.length) throw new CodedError('BACKUP_RESTORE_TRIGGER_UNSAFE');
		const { rows } =
			await sql<ReferenceColumn>`select s.name as child, f.id, f.seq, f."from", f."to", f.on_delete, f.on_update
			from sqlite_schema as s join pragma_foreign_key_list(s.name) as f
			where s.type = 'table' and lower(f."table") = ${name}
			order by s.name, f.id, f.seq`.execute(db);
		if (!rows.length) continue;
		const { rows: primary } = await sql<{
			name: string;
		}>`select name from pragma_table_info(${name}) where pk > 0 order by pk`.execute(db);
		const groups = new Map<string, ReferenceColumn[]>();
		for (const link of rows) {
			const key = JSON.stringify([link.child, link.id]);
			const to = link.to ?? primary[link.seq]?.name;
			if (!to) throw new CodedError('BACKUP_RESTORE_RELATIONSHIP_UNSAFE');
			const column = { ...link, to };
			const group = groups.get(key);
			if (group) group.push(column);
			else groups.set(key, [column]);
		}
		guards.set(name, [...groups.values()]);
	}
	return guards;
}

async function verifyWrite(
	db: Connection,
	mutation: Mutation,
	references: readonly ReferenceColumn[][],
): Promise<void> {
	const { before, changes, name, keys } = mutation;
	if (!before) return;
	for (const columns of references) {
		const first = columns[0]!;
		const action = changes ? first.on_update : first.on_delete;
		if (!['CASCADE', 'SET NULL', 'SET DEFAULT'].includes(action)) continue;
		if (changes && !columns.some(({ to }) => Object.hasOwn(changes, to!.toLowerCase()))) continue;
		// 父列决定排序规则，单目 + 移除子列表达式的亲和性，模拟 SQLite 的外键比较。
		const relations = columns.map(({ from, to }) => sql`${sql.id('parent', to!)} = +${sql.id('child', from)}`);
		const match = keys.map((key) => sql`${sql.id('parent', key)} collate binary = ${before[key]}`);
		const { rows } = await sql`select 1 from ${sql.id(name)} as parent join ${sql.id(first.child)} as child
			on ${sql.join(relations, sql` and `)} where ${sql.join(match, sql` and `)} limit 1`.execute(db);
		if (rows.length) throw new CodedError('BACKUP_RESTORE_RELATIONSHIP_UNSAFE');
	}
}

function identity(row: Record<string, unknown>, keys: readonly string[]): string {
	const values = keys.map((key) => row[key]);
	if (values.some((value) => typeof value !== 'number' && typeof value !== 'string'))
		throw new CodedError('BACKUP_ROW_KEY_INVALID');
	return JSON.stringify(values);
}

function byKey(db: Connection, name: string, row: Row, keys: readonly string[]) {
	return keys.reduce(
		(query, key) => query.where(sql`${sql.id(key)} collate binary`, '=', row[key]),
		db.deleteFrom(name),
	);
}

export interface BackupHostTableHooks {
	validate(rows: readonly Record<string, Cell>[]): void;
	written(db: QueryExecutorProvider, table: string): Promise<void>;
	committed(): Promise<void>;
}

/** 跨插件数据库只在宿主内部使用。输入归档只能匹配迁移后登记的声明。 */
export class BackupDataApi {
	readonly #database: Pick<DatabaseApi, 'withClient'>;
	readonly #storage: BackupStorage;
	readonly #crypto: Pick<CryptoApi, 'bind'>;
	readonly #hostTables = new Map<string, { table: string; hooks: BackupHostTableHooks }>();

	constructor({
		database,
		crypto,
	}: {
		database: Pick<DatabaseApi, 'withClient' | 'migrateHost' | 'clearPluginData'>;
		crypto: Pick<CryptoApi, 'bind'>;
	}) {
		this.#database = database;
		this.#storage = new BackupStorage(database);
		this.#crypto = crypto;
	}

	registerHostTable(pluginId: string, table: string, hooks: BackupHostTableHooks, scope: PluginScopeApi): void {
		scope.signal.throwIfAborted();
		if (this.#hostTables.has(pluginId)) throw new CodedError('BACKUP_HOST_TABLE_DUPLICATE');
		this.#hostTables.set(pluginId, { table, hooks });
		scope.onDispose(() => {
			this.#hostTables.delete(pluginId);
		});
	}

	isHostOwner(pluginId: string): boolean {
		return this.#hostTables.has(pluginId);
	}

	initialize(signal: AbortSignal): Promise<void> {
		return this.#storage.initialize(signal);
	}

	async register(pluginId: string, version: string, input: unknown, signal: AbortSignal): Promise<void> {
		const tables = BackupDeclarationSchema.parse(input === undefined ? [] : input);
		return this.#storage.register(pluginId, version, tables, signal);
	}

	clearPluginData(pluginId: string, signal: AbortSignal): Promise<void> {
		return this.#storage.clearPluginData(pluginId, signal);
	}

	export(scope: PluginScopeApi): Promise<Archive> {
		return this.#database.withClient((client) =>
			client
				.$extendTables<BackupTables>()
				.transaction()
				.execute(async (db) => {
					const entries: ArchiveEntry[] = [];
					let bytes = 0;
					for (const { id, version, tables } of await this.#storage.list(db)) {
						for (const table of tables) {
							scope.signal.throwIfAborted();
							const name = backupTableName(id, table);
							await verifyBackupTable(db, name, table);
							const rows: ArchiveEntry['rows'] = [];
							const query = table.keys.reduce(
								(query, key) => query.orderBy(key),
								db.selectFrom(name).select(Object.keys(table.fields)),
							);
							for await (const row of query.stream()) {
								scope.signal.throwIfAborted();
								identity(row, table.keys);
								const encoded = Object.fromEntries(
									await Promise.all(
										Object.entries(table.fields).map(
											async ([key, field]) =>
												[key, await this.#encode(id, row[key], field, scope)] as const,
										),
									),
								);
								bytes += Buffer.byteLength(JSON.stringify(encoded)) + 1;
								if (bytes > backupDataLimit || rows.length >= 100_000)
									throw new CodedError('BACKUP_TOO_LARGE');
								rows.push(encoded);
							}
							entries.push({ pluginId: id, pluginVersion: version, table, rows });
						}
					}
					return { entries };
				}),
		);
	}

	parse(data: unknown): Archive {
		const archive = ArchiveSchema.parse(data);
		const packages = new Map(archive.packages?.map((item) => [item.pluginId, item]));
		if (packages.size !== (archive.packages?.length ?? 0)) throw new CodedError('BACKUP_DUPLICATE_PACKAGE');
		const versions = new Map<string, string>();
		const seen = new Set<string>();
		for (const { pluginId, pluginVersion, table, rows } of archive.entries) {
			const version = packages.get(pluginId)?.pluginVersion ?? versions.get(pluginId);
			if (version !== undefined && version !== pluginVersion) throw new CodedError('BACKUP_VERSION_MISMATCH');
			versions.set(pluginId, pluginVersion);
			const key = JSON.stringify([pluginId, table.table]);
			if (seen.has(key)) throw new CodedError('BACKUP_DUPLICATE_TABLE');
			seen.add(key);
			const keys = new Set<string>();
			for (const row of rows) {
				if (
					Object.keys(row).length !== Object.keys(table.fields).length ||
					Object.keys(table.fields).some((field) => !Object.hasOwn(row, field))
				)
					throw new CodedError('BACKUP_ROW_INVALID');
				const id = identity(row, table.keys);
				if (keys.has(id)) throw new CodedError('BACKUP_DUPLICATE_KEY');
				keys.add(id);
			}
		}
		return archive;
	}

	async preview(archive: Archive, scope: PluginScopeApi, missing: ReadonlySet<string> = new Set()) {
		await this.#database.withClient((client) =>
			client
				.$extendTables<BackupTables>()
				.transaction()
				.execute(async (db) => {
					await this.#prepareRestore(
						db,
						{ entries: archive.entries.filter(({ pluginId }) => !missing.has(pluginId)) },
						scope,
					);
				}),
		);
		return {
			tables: archive.entries.map(({ pluginId, table, rows }) => ({
				pluginId,
				table: table.table,
				rows: rows.length,
			})),
		};
	}

	async restore(archive: Archive, scope: PluginScopeApi): Promise<void> {
		const hostTables = archive.entries.flatMap(({ pluginId, table }) => {
			const host = this.#hostTables.get(pluginId);
			return host?.table === table.table ? [{ name: backupTableName(pluginId, table), hooks: host.hooks }] : [];
		});
		await this.#database.withClient((client) =>
			client
				.$extendTables<BackupTables>()
				.transaction()
				.execute(async (db) => {
					const { mutations, guards } = await this.#prepareRestore(db, archive, scope);
					// 外键继续启用。普通引用在提交时校验，级联等副作用仍会即时执行，因此逐条复核。
					await sql`pragma defer_foreign_keys = on`.execute(db);
					for (const mutation of mutations) {
						scope.signal.throwIfAborted();
						await verifyWrite(db, mutation, guards.get(mutation.name) ?? []);
						const { name, keys, before, changes } = mutation;
						if (!changes) await byKey(db, name, before!, keys).execute();
						else if (!before) await db.insertInto(name).orAbort().values(changes).execute();
						else {
							// 避免表定义的 ON CONFLICT REPLACE 或 IGNORE 隐式覆盖、跳过记录。
							const values = Object.entries(changes).map(
								([key, value]) => sql`${sql.id(key)} = ${value}`,
							);
							const match = keys.map((key) => sql`${sql.id(key)} collate binary = ${before[key]}`);
							await sql`update or abort ${sql.id(name)} set ${sql.join(values)} where ${sql.join(match, sql` and `)}`.execute(
								db,
							);
						}
					}
					for (const { name, hooks } of hostTables) {
						scope.signal.throwIfAborted();
						await hooks.written(db, name);
					}
					scope.signal.throwIfAborted();
				}),
		);
		for (const { hooks } of hostTables) await hooks.committed();
	}

	/** 预览与实际恢复都在首次写入前检查整批变更。恢复会在当前事务内重新生成计划。 */
	async #prepareRestore(db: Connection, archive: Archive, scope: PluginScopeApi) {
		const mutations = await this.#plan(db, archive, scope);
		const guards = await loadWriteGuards(db, mutations);
		for (const mutation of mutations) {
			scope.signal.throwIfAborted();
			await verifyWrite(db, mutation, guards.get(mutation.name) ?? []);
		}
		return { mutations, guards };
	}

	async #plan(db: Connection, archive: Archive, scope: PluginScopeApi): Promise<Mutation[]> {
		const mutations: Mutation[] = [];
		for (const entry of archive.entries) {
			const { pluginId, table, rows } = entry;
			scope.signal.throwIfAborted();
			await this.#validate(db, entry);
			const host = this.#hostTables.get(pluginId);
			if (host?.table === table.table) host.hooks.validate(rows);
			const name = backupTableName(pluginId, table);
			const keys = table.keys;
			const query = db.selectFrom(name).select(Object.keys(table.fields));
			const previous = new Map((await query.execute()).map((row) => [identity(row, keys), row]));
			for (const cells of rows) {
				scope.signal.throwIfAborted();
				const matches = await keys
					.reduce((find, key) => find.where(key, '=', cells[key] as string | number), query)
					.limit(2)
					.execute();
				if (matches.length > 1) throw new CodedError('BACKUP_ROW_KEY_INVALID');
				const [before] = matches;
				if (before && !previous.delete(identity(before, keys))) throw new CodedError('BACKUP_DUPLICATE_KEY');
				const changes: Row = {};
				for (const [key, field] of Object.entries(table.fields)) {
					if (
						before &&
						(keys.includes(key) ||
							isDeepStrictEqual(await this.#encode(pluginId, before[key], field, scope), cells[key]))
					)
						continue;
					Object.defineProperty(changes, key, {
						value: await this.#decode(pluginId, cells[key], field, scope),
						enumerable: true,
					});
				}
				if (!before || Object.keys(changes).length) mutations.push({ name, keys, before, changes });
			}
			for (const before of previous.values()) mutations.push({ name, keys, before });
		}

		const phase = ({ changes, before }: Mutation) => (!changes ? 0 : before ? 1 : 2);

		return mutations.sort((left, right) => phase(left) - phase(right));
	}

	async #validate(db: Connection, { pluginId, pluginVersion, table }: ArchiveEntry): Promise<void> {
		const registration = await this.#storage.get(db, pluginId);
		const declared = registration?.tables.find((item) => item.table === table.table);
		if (registration?.version !== pluginVersion || !isDeepStrictEqual(declared, table))
			throw new CodedError('BACKUP_VERSION_MISMATCH');
		const name = backupTableName(pluginId, table);
		await verifyBackupTable(db, name, table);
	}

	async #encode(
		owner: string,
		value: Row[string],
		field: BackupTable['fields'][string],
		scope: PluginScopeApi,
	): Promise<Cell> {
		if (value === null) return null;
		if (field === 'plain')
			return value instanceof Uint8Array
				? { storage: 'blob', bytes: Buffer.from(value).toString('base64') }
				: CellSchema.parse(value);
		const storage = typeof value === 'string' ? 'text' : 'blob';
		if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new CodedError('BACKUP_SECRET_INVALID');
		const input = typeof value === 'string' ? Buffer.from(value, 'base64') : value;
		const context = typeof field === 'object' ? field.secret : undefined;
		const result = await this.#crypto.bind(owner, scope).decrypt(input, { mode: 'local', context });
		if (result.isErr()) throw new CodedError('BACKUP_SECRET_UNAVAILABLE');
		try {
			return {
				storage,
				bytes: Buffer.from(result.value.buffer, result.value.byteOffset, result.value.byteLength).toString(
					'base64',
				),
			};
		} finally {
			result.value.fill(0);
		}
	}

	async #decode(
		owner: string,
		cell: Cell,
		field: BackupTable['fields'][string],
		scope: PluginScopeApi,
	): Promise<Row[string]> {
		if (cell === null || (field === 'plain' && typeof cell !== 'object')) return cell as Row[string];
		if (typeof cell !== 'object' || (field === 'plain' && cell.storage !== 'blob'))
			throw new CodedError('BACKUP_CELL_INVALID');
		const bytes = Buffer.from(cell.bytes, 'base64');
		if (bytes.toString('base64') !== cell.bytes) throw new CodedError('BACKUP_CELL_INVALID');
		if (field === 'plain') return bytes;
		try {
			const context = typeof field === 'object' ? field.secret : undefined;
			const result = await this.#crypto.bind(owner, scope).encrypt(bytes, { mode: 'local', context });
			if (result.isErr()) throw new CodedError('BACKUP_SECRET_UNAVAILABLE');
			return cell.storage === 'text' ? Buffer.from(result.value).toString('base64') : result.value;
		} finally {
			bytes.fill(0);
		}
	}
}
