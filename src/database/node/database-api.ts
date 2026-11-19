import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Kysely, SqliteAdapter, SqliteIntrospector, sql, type DatabaseMetadataOptions } from 'kysely';
import { Migrator, type MigrationProvider } from 'kysely/migration';
import { GenericSqliteWorkerDialect } from 'kysely-generic-sqlite/worker';
import { createNodeWorkerExecutor } from 'kysely-generic-sqlite/worker-helper-node';
import type { PluginScopeApi } from '../../plugin/plugin-api.js';
import { CodedError } from '../../utils/error.js';
import { PluginDatabase, type PluginDatabaseApi } from './database-plugin-api.js';
import { PluginQueryCompiler } from './database-query-compiler.js';
import type { DatabaseWorkerOptions } from './database-worker.js';

interface DatabaseOptions {
	readonly directory: string;
}

const migrationTable = 'migrations';
const migrationLockTable = 'migration_lock';

export function pluginTablePrefix(ownerId: string): string {
	return `plugin_${createHash('sha256').update(ownerId).digest('hex')}_`;
}

class TransactionalSqliteAdapter extends SqliteAdapter {
	// SQLite 的表结构变更可随事务回滚，启用 Kysely Migrator 的事务路径。
	override get supportsTransactionalDdl(): boolean {
		return true;
	}
}

class DatabaseDialect extends GenericSqliteWorkerDialect<Worker, Record<string, unknown>> {
	readonly #tablePrefix: string | undefined;

	constructor(options: DatabaseWorkerOptions) {
		super(
			createNodeWorkerExecutor({
				worker: () => new Worker(new URL('./database-worker.ts', import.meta.url), { workerData: options }),
			}),
		);
		this.#tablePrefix = options.tablePrefix;
	}

	override createAdapter(): SqliteAdapter {
		return new TransactionalSqliteAdapter();
	}

	override createQueryCompiler() {
		return this.#tablePrefix ? new PluginQueryCompiler(this.#tablePrefix) : super.createQueryCompiler();
	}

	override createIntrospector(db: Kysely<unknown>) {
		return this.#tablePrefix ? new PluginDatabaseIntrospector(db, this.#tablePrefix) : super.createIntrospector(db);
	}
}

class PluginDatabaseIntrospector extends SqliteIntrospector {
	readonly #prefix: string;

	constructor(db: Kysely<unknown>, prefix: string) {
		super(db);
		this.#prefix = prefix;
	}

	override async getTables(options?: DatabaseMetadataOptions) {
		return (await super.getTables(options))
			.filter(({ name }) => name.startsWith(this.#prefix))
			.map((table) => ({ ...table, name: table.name.slice(this.#prefix.length) }))
			.filter(
				({ name }) =>
					options?.withInternalKyselyTables || (name !== migrationTable && name !== migrationLockTable),
			);
	}
}

class DatabaseConnection {
	readonly #options: DatabaseWorkerOptions;
	readonly #operations = new Set<Promise<unknown>>();
	#client: Kysely<unknown> | undefined;
	#initializing: Promise<void> | undefined;
	#closing: Promise<void> | undefined;

	constructor(options: DatabaseWorkerOptions) {
		this.#options = options;
	}

	initialize(signal: AbortSignal): Promise<void> {
		if (this.#closing) return Promise.reject(new CodedError('DATABASE_CLOSED'));
		return (this.#initializing ??= this.#initialize(signal));
	}

	async migrate(migrations: MigrationProvider, signal: AbortSignal, historyPrefix = ''): Promise<void> {
		signal.throwIfAborted();

		// 迁移和普通查询共用在途任务登记，关闭连接时等待迁移事务收尾。
		await this.withClient(async (client) => {
			signal.throwIfAborted();
			const result = await new Migrator({
				db: client,
				provider: migrations,
				migrationTableName: historyPrefix + migrationTable,
				migrationLockTableName: historyPrefix + migrationLockTable,
			}).migrateToLatest();
			if ('error' in result) throw result.error;

			// 已提交的迁移保留。取消后调用方不会继续初始化业务。
			signal.throwIfAborted();
			this.#assertOpen();
		});
	}

	async withClient<Result>(operation: (client: Kysely<unknown>) => Result | Promise<Result>): Promise<Result> {
		const client = this.assertReady();

		const pending = Promise.resolve().then(() => operation(client));
		this.#operations.add(pending);
		try {
			return await pending;
		} finally {
			this.#operations.delete(pending);
		}
	}

	close(): Promise<void> {
		return (this.#closing ??= this.#close());
	}

	assertReady(): Kysely<unknown> {
		this.#assertOpen();
		if (!this.#client) throw new CodedError('DATABASE_NOT_READY');
		return this.#client;
	}

	async #initialize(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const client = new Kysely<unknown>({
			dialect: new DatabaseDialect(this.#options),
		});

		try {
			// Kysely 惰性打开连接，主动获取一次以确认 Worker 和 SQLite 已就绪。
			await client.connection().execute(async () => {});
			signal.throwIfAborted();
			this.#assertOpen();
			this.#client = client;
		} catch (cause) {
			try {
				await client.destroy();
			} catch (cleanup) {
				throw new AggregateError([cause, cleanup], 'DATABASE_INITIALIZE_CLEANUP_FAILED');
			}
			throw cause;
		}
	}

	async #close(): Promise<void> {
		await this.#initializing?.catch(() => undefined);
		await Promise.allSettled(this.#operations);
		const client = this.#client;
		this.#client = undefined;
		await client?.destroy();
	}

	#assertOpen(): void {
		if (this.#closing) throw new CodedError('DATABASE_CLOSED');
	}
}

/** AppServices 管理同一个 SQLite 文件及其本体和插件连接。 */
export class DatabaseApi {
	readonly #filename: string;
	readonly #host: DatabaseConnection;
	readonly #plugins = new Set<DatabaseConnection>();
	#closing: Promise<void> | undefined;

	constructor({ directory }: DatabaseOptions) {
		this.#filename = join(directory, 'nexus.sqlite');
		this.#host = new DatabaseConnection({ filename: this.#filename });
	}

	initialize(signal: AbortSignal): Promise<void> {
		return this.#host.initialize(signal);
	}

	/** 在回调内等待完整查询或事务，由本体关闭共享连接。 */
	withClient<Result>(operation: (client: Kysely<unknown>) => Result | Promise<Result>): Promise<Result> {
		return this.#host.withClient(operation);
	}

	/** 每个宿主迁移序列使用独立命名空间。调用方提交该序列的完整迁移定义。 */
	async migrateHost(namespace: string, migrations: MigrationProvider, signal: AbortSignal): Promise<void> {
		if (!/^[a-z][a-z0-9_]*$/u.test(namespace)) throw new CodedError('DATABASE_MIGRATION_NAMESPACE_INVALID');
		await this.#host.migrate(migrations, signal, `${namespace}_`);
	}

	bind(ownerId: string, scope: PluginScopeApi): PluginDatabaseApi {
		scope.signal.throwIfAborted();
		const connection = this.#pluginConnection(pluginTablePrefix(ownerId));
		scope.onDispose(() => this.#releasePlugin(connection));
		return new PluginDatabase(connection, scope.signal);
	}

	/** 宿主可在运行时之外准备同一插件的表结构。 */
	async migratePlugin(ownerId: string, migrations: MigrationProvider, signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		const connection = this.#pluginConnection(pluginTablePrefix(ownerId));
		try {
			await connection.initialize(signal);
			await connection.migrate(migrations, signal);
		} finally {
			await this.#releasePlugin(connection);
		}
	}

	/** 仅宿主维护入口使用。调用方先停用插件，并在同一事务移除关联登记。 */
	clearPluginData(
		ownerId: string,
		signal: AbortSignal,
		finalize: (db: Kysely<unknown>) => Promise<void>,
	): Promise<void> {
		const prefix = pluginTablePrefix(ownerId);
		return this.withClient((client) =>
			client.transaction().execute(async (db) => {
				signal.throwIfAborted();
				const { rows: references } = await sql`
				select 1 from sqlite_schema as child join pragma_foreign_key_list(child.name) as fk
				where child.type = 'table'
				and substr(lower(child.name), 1, ${prefix.length}) <> ${prefix}
				and substr(lower(fk."table"), 1, ${prefix.length}) = ${prefix}
				limit 1
			`.execute(db);
				if (references.length) throw new CodedError('DATABASE_PLUGIN_DATA_REFERENCED');

				const { rows } = await sql<{ name: string; type: 'view' | 'table' }>`
				select name, type from sqlite_schema
				where type in ('view', 'table') and substr(lower(name), 1, ${prefix.length}) = ${prefix}
				order by type desc
			`.execute(db);
				await sql`pragma defer_foreign_keys = on`.execute(db);
				for (const { name, type } of rows) {
					signal.throwIfAborted();
					if (type === 'view') await db.schema.dropView(name).execute();
					else await db.schema.dropTable(name).execute();
				}
				await finalize(db);
				signal.throwIfAborted();
			}),
		);
	}

	close(): Promise<void> {
		return (this.#closing ??= this.#close());
	}

	#pluginConnection(tablePrefix: string): DatabaseConnection {
		this.#host.assertReady();
		const connection = new DatabaseConnection({ filename: this.#filename, tablePrefix });
		this.#plugins.add(connection);
		return connection;
	}

	async #releasePlugin(connection: DatabaseConnection): Promise<void> {
		try {
			await connection.close();
		} finally {
			this.#plugins.delete(connection);
		}
	}

	async #close(): Promise<void> {
		const results = await Promise.allSettled([this.#host.close(), ...[...this.#plugins].map((db) => db.close())]);
		this.#plugins.clear();
		const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'DATABASE_CLOSE_FAILED');
	}
}
