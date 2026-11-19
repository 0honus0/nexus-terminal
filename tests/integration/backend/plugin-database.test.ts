import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import { App } from '../../../src/app/node/app.js';
import { DatabaseApi } from '../../../src/database/node/database-api.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';

function physicalTable(ownerId: string, table: string): string {
	return `plugin_${createHash('sha256').update(ownerId).digest('hex')}_${table}`;
}

async function withDirectory(t: TestContext): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-database-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

test('测试插件先执行迁移再激活，重启时继续使用同一张表', async (t) => {
	const dataDirectory = await withDirectory(t);
	const directory = fileURLToPath(new URL('../../fixtures/plugins/test/', import.meta.url));
	const items = physicalTable('@nexus-terminal/test', 'items');
	const migrations = physicalTable('@nexus-terminal/test', 'migrations');
	for (let run = 0; run < 2; run++) {
		const app = new App({ dataDirectory, logLevel: 'fatal' });
		try {
			await app.initialize();
			await app.startBuiltinPlugins();
			await app.startExternalPlugins([directory]);
			const { rows } = await app.services
				.get('database')
				.withClient((db) => sql`SELECT label FROM ${sql.table(items)}`.execute(db));
			assert.deepEqual(rows, [{ label: 'sample' }]);
			const history = await app.services
				.get('database')
				.withClient((db) => sql`SELECT name FROM ${sql.table(migrations)}`.execute(db));
			assert.deepEqual(history.rows, [{ name: '001_items' }]);
		} finally {
			await app.close();
		}
	}
});

test('插件用相同逻辑名称建表和索引，各自查询自己的数据', async (t) => {
	type Schema = { items: { id: number }; links: { itemId: number } };
	const directory = await withDirectory(t);
	const database = new DatabaseApi({ directory });
	const scope = new PluginScope(() => {});
	const migrations = {
		async getMigrations() {
			return {
				'001_items': {
					async up(db) {
						await db.schema
							.createTable('items')
							.addColumn('id', 'integer', (column) => column.primaryKey())
							.execute();
						await db.schema
							.createTable('links')
							.addColumn('itemId', 'integer', (column) => column.notNull().references('items.id'))
							.execute();
						await db.schema.createIndex('links_item').on('links').column('itemId').execute();
					},
				},
			};
		},
	} satisfies Parameters<DatabaseApi['migratePlugin']>[1];
	try {
		await database.initialize(scope.signal);
		for (const [ownerId, id] of [
			['@demo/one', 1],
			['@demo/two', 2],
		] as const) {
			await database.migratePlugin(ownerId, migrations, scope.signal);
			const api = database.bind(ownerId, scope);
			await api.withClient(async (client) => {
				const db = client.$extendTables<Schema>();
				await db.insertInto('items').values({ id }).execute();
				await db.insertInto('links').values({ itemId: id }).execute();
				await assert.rejects(db.insertInto('links').values({ itemId: 0 }).execute(), /FOREIGN KEY/);
				await db.schema.createView('visible_items').as(db.selectFrom('items').select('items.id')).execute();
				const rows = await db
					.with('ids', (query) => query.selectFrom('items').select('items.id'))
					.selectFrom('links as link')
					.innerJoin('ids as item', 'item.id', 'link.itemId')
					.select('item.id')
					.execute();
				assert.deepEqual(rows, [{ id }]);
				const { rows: visible } = await sql`SELECT id FROM ${sql.table('visible_items')}`.execute(db);
				assert.deepEqual(visible, [{ id }]);
				assert.deepEqual(
					(await db.introspection.getTables()).map(({ name }) => name),
					['items', 'links', 'visible_items'],
				);
			});
		}
	} finally {
		await scope.close();
		await database.close();
	}
});

test('同库插件连接限制表访问并在停用时撤销', async (t) => {
	const directory = await withDirectory(t);
	const database = new DatabaseApi({ directory });
	const scope = new PluginScope(() => {});
	const foreignTable = physicalTable('@demo/two', 'items');
	try {
		await database.initialize(scope.signal);
		await database.withClient(async (db) => {
			await db.schema.createTable('items').addColumn('id', 'integer').execute();
			await db.schema.createTable(foreignTable).addColumn('id', 'integer').execute();
		});
		await database.migratePlugin(
			'@demo/one',
			{
				async getMigrations() {
					return {
						'001_items': {
							async up(db) {
								await db.schema.createTable('items').addColumn('id', 'integer').execute();
							},
						},
					};
				},
			},
			scope.signal,
		);

		const api = database.bind('@demo/one', scope);
		await api.withClient((db) => sql`INSERT INTO ${sql.table('items')} VALUES (1)`.execute(db));
		const denied = /not authorized|prohibited/i;
		await assert.rejects(
			api.withClient((db) => sql`SELECT * FROM items`.execute(db)),
			denied,
		);
		await assert.rejects(
			api.withClient((db) => sql`SELECT * FROM ${sql.table('items')} JOIN ${sql.id(foreignTable)}`.execute(db)),
			denied,
		);
		await assert.rejects(
			api.withClient((db) => sql`INSERT INTO ${sql.id(foreignTable)} VALUES (2)`.execute(db)),
			denied,
		);
		await api.withClient((db) =>
			sql`CREATE VIEW ${sql.table('external_view')} AS SELECT * FROM ${sql.id(foreignTable)}`.execute(db),
		);
		await assert.rejects(
			api.withClient((db) => sql`SELECT * FROM ${sql.table('external_view')}`.execute(db)),
			denied,
		);
		await api.withClient((db) =>
			sql`CREATE TRIGGER ${sql.table('external_trigger')} AFTER INSERT ON ${sql.table('items')}
				BEGIN INSERT INTO ${sql.id(foreignTable)} VALUES (new.id); END`.execute(db),
		);
		await assert.rejects(
			api.withClient((db) => sql`INSERT INTO ${sql.table('items')} VALUES (2)`.execute(db)),
			denied,
		);
		await assert.rejects(
			api.withClient((db) => sql`ATTACH DATABASE ':memory:' AS external`.execute(db)),
			denied,
		);
		await scope.close();
		await assert.rejects(
			api.withClient(() => undefined),
			{ code: 'PLUGIN_CONTEXT_EXPIRED' },
		);
	} finally {
		await scope.close();
		await database.close();
	}
});
