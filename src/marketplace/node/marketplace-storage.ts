import { randomUUID } from 'node:crypto';
import type { MigrationProvider } from 'kysely/migration';
import type { PluginDatabaseApi } from '../../database/node/database-plugin-api.js';
import {
	MarketplaceRepositorySourceSchema,
	type MarketplaceInstallAttempt,
	type MarketplaceRepositorySource,
} from '../marketplace-types.js';
import type { InstalledPluginTarget } from '../../plugin/plugin-api.node.js';
import {
	RepositoryCatalogSchema,
	type MarketplaceRepository,
	type RepositoryCatalog,
} from '../marketplace-catalog-types.js';

const table = 'plugins';

const repositories = 'repositories';

const retained = 'retained_data';

const attempts = 'install_attempts';

export const officialRepositoryUrl =
	'https://raw.githubusercontent.com/0honus0/nexus-agent-plugins/catalog/catalog.json';

type RepositoryRecord = Pick<MarketplaceRepository, 'id' | 'url' | 'label'>;

type MarketplaceTables = {
	[table]: {
		pluginId: string;
		version: string;
		directory: string;
		source: 'local' | 'repository';
		repositoryId: string | null;
		enabled: number;
	};
	[attempts]: { pluginId: string; target: string; state: MarketplaceInstallAttempt['state'] };
	[retained]: { pluginId: string; version: string };
	[repositories]: RepositoryRecord & { catalogJson: string };
};

export interface InstalledPlugin extends InstalledPluginTarget {
	readonly source: MarketplaceTables[typeof table]['source'];
	readonly repositoryId: string | null;
	readonly enabled: boolean;
}

export const marketplaceMigrations: MigrationProvider = {
	async getMigrations() {
		return {
			'001_plugins': {
				async up(db) {
					await db.schema
						.createTable(table)
						.addColumn('pluginId', 'text', (column) => column.primaryKey())
						.addColumn('version', 'text', (column) => column.notNull())
						.addColumn('directory', 'text', (column) => column.notNull())
						.addColumn('source', 'text', (column) => column.notNull())
						.addColumn('enabled', 'integer', (column) => column.notNull().defaultTo(0))
						.execute();
				},
			},
			'002_repositories': {
				async up(db) {
					await db.schema
						.createTable(repositories)
						.addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('url', 'text', (column) => column.notNull().unique())
						.addColumn('label', 'text', (column) => column.notNull())
						.addColumn('catalogJson', 'text', (column) => column.notNull())
						.execute();
				},
			},
			'003_managed_packages': {
				async up(db) {
					await db.schema.alterTable(table).addColumn('repositoryId', 'text').execute();
					await db.schema
						.createTable(retained)
						.addColumn('pluginId', 'text', (column) => column.primaryKey())
						.addColumn('version', 'text', (column) => column.notNull())
						.execute();
				},
			},
			'004_install_attempts': {
				async up(db) {
					await db.schema
						.createTable(attempts)
						.addColumn('pluginId', 'text', (column) => column.primaryKey())
						.addColumn('target', 'text', (column) => column.notNull())
						.addColumn('state', 'text', (column) => column.notNull())
						.execute();
				},
			},
			'005_official_repository': {
				async up(db) {
					// 只登记一次。保留现有同地址仓库的 ID 和缓存，用户删除后也不在重启时重新插入。
					await db
						.$extendTables<MarketplaceTables>()
						.insertInto(repositories)
						.values({
							id: randomUUID(),
							url: officialRepositoryUrl,
							label: 'Nexus Terminal',
							catalogJson: '[]',
						})
						.onConflict((conflict) => conflict.column('url').doNothing())
						.execute();
				},
			},
		};
	},
};

function decode(row: MarketplaceTables[typeof table]): InstalledPlugin {
	return { ...row, enabled: row.enabled === 1 };
}

/** 保存安装记录、启用意图，以及每个仓库的最近一次有效目录。 */
export class MarketplaceStorage {
	readonly #database: PluginDatabaseApi;

	constructor(database: PluginDatabaseApi) {
		this.#database = database;
	}

	list(): Promise<InstalledPlugin[]> {
		return this.#database.withClient(async (client) => {
			const rows = await client
				.$extendTables<MarketplaceTables>()
				.selectFrom(table)
				.selectAll()
				.orderBy('pluginId')
				.execute();
			return rows.map(decode);
		});
	}

	get(pluginId: string): Promise<InstalledPlugin | undefined> {
		return this.#database.withClient(async (client) => {
			const row = await client
				.$extendTables<MarketplaceTables>()
				.selectFrom(table)
				.selectAll()
				.where('pluginId', '=', pluginId)
				.executeTakeFirst();
			return row && decode(row);
		});
	}

	async register(target: InstalledPluginTarget): Promise<InstalledPlugin> {
		return this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.transaction()
				.execute(async (tx) => {
					// 同一个 ID 的已安装版本须由后续更新操作替换。重复登记保留启用意图。
					await tx
						.insertInto(table)
						.values({
							pluginId: target.pluginId,
							version: target.version,
							directory: target.directory,
							source: 'local',
							repositoryId: null,
							enabled: 0,
						})
						.onConflict((conflict) => conflict.column('pluginId').doNothing())
						.execute();
					return decode(
						await tx
							.selectFrom(table)
							.selectAll()
							.where('pluginId', '=', target.pluginId)
							.executeTakeFirstOrThrow(),
					);
				}),
		);
	}

	commitPackage(
		target: InstalledPluginTarget,
		source: MarketplaceRepositorySource,
		enabled: boolean,
	): Promise<InstalledPlugin> {
		return this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.transaction()
				.execute(async (db) => {
					const record = {
						pluginId: target.pluginId,
						version: target.version,
						directory: target.directory,
						source: 'repository' as const,
						repositoryId: source.repositoryId,
						enabled: Number(enabled),
					};
					const row = await db
						.insertInto(table)
						.values(record)
						.onConflict((conflict) => conflict.column('pluginId').doUpdateSet(record))
						.returningAll()
						.executeTakeFirstOrThrow();
					await db.deleteFrom(retained).where('pluginId', '=', target.pluginId).execute();
					return decode(row);
				}),
		);
	}

	remove(record: InstalledPlugin): Promise<void> {
		return this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.transaction()
				.execute(async (db) => {
					const data = { pluginId: record.pluginId, version: record.version };
					await db
						.insertInto(retained)
						.values(data)
						.onConflict((conflict) => conflict.column('pluginId').doUpdateSet(data))
						.execute();
					await db.deleteFrom(table).where('pluginId', '=', record.pluginId).execute();
					await db.deleteFrom(attempts).where('pluginId', '=', record.pluginId).execute();
				}),
		);
	}

	listRetained() {
		return this.#database.withClient((client) =>
			client.$extendTables<MarketplaceTables>().selectFrom(retained).selectAll().orderBy('pluginId').execute(),
		);
	}

	async removeRetained(pluginId: string): Promise<void> {
		await this.#database.withClient((client) =>
			client.$extendTables<MarketplaceTables>().deleteFrom(retained).where('pluginId', '=', pluginId).execute(),
		);
	}

	setEnabled(pluginId: string, enabled: boolean): Promise<InstalledPlugin | undefined> {
		return this.#database.withClient(async (client) => {
			const row = await client
				.$extendTables<MarketplaceTables>()
				.updateTable(table)
				.set({ enabled: Number(enabled) })
				.where('pluginId', '=', pluginId)
				.returningAll()
				.executeTakeFirst();
			return row && decode(row);
		});
	}

	async listAttempts(): Promise<MarketplaceInstallAttempt[]> {
		const records = await this.#database.withClient((client) =>
			client.$extendTables<MarketplaceTables>().selectFrom(attempts).selectAll().orderBy('pluginId').execute(),
		);
		return records.map(({ target, state }) => ({
			target: MarketplaceRepositorySourceSchema.parse(JSON.parse(target)),
			state,
		}));
	}

	async startAttempt(target: MarketplaceRepositorySource): Promise<void> {
		const row = { pluginId: target.pluginId, target: JSON.stringify(target), state: 'installing' as const };
		await this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.insertInto(attempts)
				.values(row)
				.onConflict((conflict) => conflict.column('pluginId').doUpdateSet(row))
				.execute(),
		);
	}

	async failAttempt(pluginId: string): Promise<void> {
		await this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.updateTable(attempts)
				.set({ state: 'failed' })
				.where('pluginId', '=', pluginId)
				.execute(),
		);
	}

	async interruptAttempts(): Promise<void> {
		await this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.updateTable(attempts)
				.set({ state: 'interrupted' })
				.where('state', '=', 'installing')
				.execute(),
		);
	}

	async removeAttempt(pluginId: string): Promise<void> {
		await this.#database.withClient((client) =>
			client.$extendTables<MarketplaceTables>().deleteFrom(attempts).where('pluginId', '=', pluginId).execute(),
		);
	}

	listRepositories(): Promise<RepositoryRecord[]> {
		return this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.selectFrom(repositories)
				.select(['id', 'url', 'label'])
				.orderBy('id')
				.execute(),
		);
	}

	async readCatalog(): Promise<{ repository: RepositoryRecord; catalog: RepositoryCatalog }[]> {
		const rows = await this.#database.withClient((client) =>
			client.$extendTables<MarketplaceTables>().selectFrom(repositories).selectAll().orderBy('id').execute(),
		);

		return rows.map(({ catalogJson, ...repository }) => ({
			repository,
			catalog: RepositoryCatalogSchema.parse(JSON.parse(catalogJson)),
		}));
	}

	async addRepository(repository: RepositoryRecord, catalog: RepositoryCatalog): Promise<void> {
		await this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.insertInto(repositories)
				.values({ ...repository, catalogJson: JSON.stringify(catalog) })
				.execute(),
		);
	}

	/** 标签修改可以保留目录；地址及缓存由同一条 UPDATE 提交。 */
	async updateRepository(repository: RepositoryRecord, catalog?: RepositoryCatalog): Promise<void> {
		const { id, url, label } = repository;
		const changes = catalog === undefined ? { url, label } : { url, label, catalogJson: JSON.stringify(catalog) };

		await this.#database.withClient((client) =>
			client
				.$extendTables<MarketplaceTables>()
				.updateTable(repositories)
				.set(changes)
				.where('id', '=', id)
				.execute(),
		);
	}

	async removeRepository(id: string): Promise<void> {
		await this.#database.withClient((client) =>
			client.$extendTables<MarketplaceTables>().deleteFrom(repositories).where('id', '=', id).execute(),
		);
	}
}

export function installedSource(record: InstalledPlugin): { kind: 'local' } | MarketplaceRepositorySource {
	const { source, repositoryId, pluginId, version } = record;
	return source === 'repository' && repositoryId
		? { kind: 'repository', repositoryId, pluginId, version }
		: { kind: 'local' };
}
