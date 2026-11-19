import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Kysely } from 'kysely';
import { App } from '../../../src/app/node/app.js';
import { DatabaseApi } from '../../../src/database/node/database-api.js';

type ItemsSchema = { items: { id: number; value: string } };

function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

async function withDirectory(t: TestContext): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-database-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	return directory;
}

async function createItems(db: Kysely<unknown>): Promise<void> {
	await db.schema
		.createTable('items')
		.addColumn('id', 'integer', (column) => column.primaryKey())
		.addColumn('value', 'text', (column) => column.notNull())
		.execute();
}

test('App 初始化后提供数据库，关闭并重新启动后保留数据', async (t) => {
	const directory = await withDirectory(t);
	const options = { dataDirectory: directory, logLevel: 'fatal' } as const;
	const first = new App(options);
	try {
		assert.throws(() => first.services.get('database'), { code: 'SERVICE_NOT_READY' });
		await first.initialize();
		await first.services.get('database').withClient(async (db) => {
			await createItems(db);
			await db.$extendTables<ItemsSchema>().insertInto('items').values({ id: 1, value: 'saved' }).execute();
		});
	} finally {
		await first.close();
	}

	const second = new App(options);
	try {
		await second.initialize();
		const items = await second.services
			.get('database')
			.withClient((db) => db.$extendTables<ItemsSchema>().selectFrom('items').selectAll().execute());
		assert.deepEqual(items, [{ id: 1, value: 'saved' }]);
	} finally {
		await second.close();
	}
});

test('迁移失败会回滚并释放资源，随后可重新打开数据库', async (t) => {
	const directory = await withDirectory(t);
	const signal = new AbortController().signal;
	const failure = new Error('migration failed');
	const database = new DatabaseApi({ directory });
	try {
		await database.initialize(signal);
		await assert.rejects(
			database.migrateHost(
				'items',
				{
					async getMigrations() {
						return {
							'001_items': {
								async up(db) {
									await createItems(db);
									throw failure;
								},
							},
						};
					},
				},
				signal,
			),
			(cause) => cause === failure,
		);
		const tables = await database.withClient((db) => db.introspection.getTables());
		assert.equal(
			tables.some(({ name }) => name === 'items'),
			false,
		);
	} finally {
		await database.close();
	}

	const reopened = new DatabaseApi({ directory });
	try {
		await reopened.initialize(signal);
		await reopened.migrateHost(
			'items',
			{
				async getMigrations() {
					return { '001_items': { up: createItems } };
				},
			},
			signal,
		);
		const tables = await reopened.withClient((db) => db.introspection.getTables());
		assert.ok(tables.some(({ name }) => name === 'items'));
	} finally {
		await reopened.close();
	}
});

test('迁移取消后，关闭等待在途迁移完成并拒绝新查询', async (t) => {
	const directory = await withDirectory(t);
	const controller = new AbortController();
	const entered = gate();
	const resume = gate();
	const database = new DatabaseApi({ directory });
	try {
		await database.initialize(controller.signal);
		const migration = database.migrateHost(
			'items',
			{
				async getMigrations() {
					return {
						'001_items': {
							async up(db) {
								entered.resolve();
								await resume.promise;
								await createItems(db);
							},
						},
					};
				},
			},
			controller.signal,
		);
		await Promise.race([entered.promise, migration]);
		controller.abort(new Error('startup cancelled'));
		const cancelled = assert.rejects(migration, (cause) => cause === controller.signal.reason);
		const closed = database.close();
		await assert.rejects(
			database.withClient(() => undefined),
			{ code: 'DATABASE_CLOSED' },
		);
		resume.resolve();
		await Promise.all([cancelled, closed]);
	} finally {
		resume.resolve();
		await database.close();
	}
});

test('宿主模块各自读取自己的迁移历史，相同迁移编号可以并存', async (t) => {
	const database = new DatabaseApi({ directory: await withDirectory(t) });
	const signal = new AbortController().signal;
	try {
		await database.initialize(signal);
		for (const namespace of ['items', 'settings', 'items']) {
			await database.migrateHost(
				namespace,
				{
					async getMigrations() {
						return {
							'001_initial': {
								async up(db) {
									await db.schema.createTable(namespace).addColumn('id', 'text').execute();
								},
							},
						};
					},
				},
				signal,
			);
		}
		const tables = await database.withClient((db) => db.introspection.getTables());
		assert.ok(tables.some(({ name }) => name === 'items'));
		assert.ok(tables.some(({ name }) => name === 'settings'));
	} finally {
		await database.close();
	}
});

test('关闭时拒绝新查询并等待已受理事务完成', async (t) => {
	const directory = await withDirectory(t);
	const database = new DatabaseApi({ directory });
	const entered = gate();
	const resume = gate();
	try {
		await database.initialize(new AbortController().signal);
		await database.withClient(createItems);
		const writing = database.withClient((db) =>
			db
				.$extendTables<ItemsSchema>()
				.transaction()
				.execute(async (transaction) => {
					entered.resolve();
					await resume.promise;
					return transaction
						.insertInto('items')
						.values({ id: 1, value: 'committed' })
						.returning('value')
						.executeTakeFirstOrThrow();
				}),
		);
		await Promise.race([entered.promise, writing]);
		const closed = database.close();
		await assert.rejects(
			database.withClient(() => undefined),
			{ code: 'DATABASE_CLOSED' },
		);
		resume.resolve();
		assert.deepEqual(await writing, { value: 'committed' });
		await closed;
	} finally {
		resume.resolve();
		await database.close();
	}
});
