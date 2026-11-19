import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { on, once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { sql } from 'kysely';
import { create as createArchive } from 'tar';
import { WebSocket } from 'ws';
import { App } from '../../../src/app/node/app.js';
import {
	backupBase,
	BackupFileSchema,
	BackupJobSchema,
	BackupPlanSchema,
	BackupStatusSchema,
	BackupStatusTopic,
} from '../../../src/backup/backup-http-types.js';
import { BackupDataApi } from '../../../src/backup/node/backup-data-api.js';
import type { BackupTable } from '../../../src/backup/backup-types.js';
import { pluginTablePrefix } from '../../../src/database/node/database-api.js';
import { MarketplaceRepositorySchema } from '../../../src/marketplace/marketplace-catalog-types.js';
import { MarketplaceInstallPlanSchema } from '../../../src/marketplace/marketplace-install-types.js';
import { MarketplaceStorage } from '../../../src/marketplace/node/marketplace-storage.js';
import { MarketplaceOperationSchema, MarketplacePluginId } from '../../../src/marketplace/marketplace-types.js';
import { inspectPluginPackage } from '../../../src/plugin/plugin-api.node.js';
import { PluginScope } from '../../../src/plugin/plugin-api.js';
import { settingsBase, SettingsSnapshotSchema } from '../../../src/settings/settings-http-types.js';
import { SettingsPluginId } from '../../../src/settings/settings-types.js';
import { readPluginRuntime } from './plugin-test-host.js';
import { StateMessageSchema } from '../../../src/state/state-ws-types.js';

const pluginId = '@test/backup-fixture';
const password = 'backup-password';
const secretContext = 'fixture-secret';
type Tables = { items: { id: string; label: string; secret: Uint8Array; excluded: string } };

test('备份已停用插件，跨宿主重加密密文，恢复完成后重新启用目标插件', { timeout: 20000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-backup-'));
	const directory = join(root, 'plugin');
	const source = new App({ dataDirectory: join(root, 'source'), logLevel: 'fatal' });
	const target = new App({ dataDirectory: join(root, 'target'), logLevel: 'fatal' });
	const scope = new PluginScope(() => {});
	t.after(async () => {
		await scope.close();
		await Promise.all([source.close(), target.close()]);
		await rm(root, { recursive: true, force: true });
	});
	await mkdir(directory);
	await writeFile(
		join(directory, 'package.json'),
		JSON.stringify({
			name: pluginId,
			version: '1.0.0',
			type: 'module',
			peerDependencies: { 'nexus-terminal': '^1.0.0' },
			nexus: { kind: 'extension', entry: { backend: 'index.mjs' } },
		}),
	);
	await writeFile(
		join(directory, 'index.mjs'),
		`
		export const backup = [{ table: 'items', version: 1, keys: ['id'],
			fields: { id: 'plain', label: 'plain', secret: { secret: '${secretContext}' } } }];
		export const migrations = {
			async getMigrations() {
				return { tables: { async up(db) {
					await db.schema.createTable('items').addColumn('id', 'text', (column) => column.primaryKey())
						.addColumn('label', 'text').addColumn('secret','blob')
						.addColumn('excluded', 'text', (column) => column.defaultTo('local')).execute();
				} } };
			}
		};
		export function activate(ctx) { ctx.self.readiness.set({ state: 'ready' }); }
	`,
	);
	const installed = await inspectPluginPackage(directory);

	const setup = async (app: App, label: string) => {
		await app.initialize();
		await app.startBuiltinPlugins();
		const database = app.services.get('database');
		const storage = new MarketplaceStorage(database.bind(MarketplacePluginId, scope));
		await storage.register(installed);
		await storage.setEnabled(pluginId, true);
		await app.startExternalPlugins();
		const crypto = app.services.get('crypto').bind(pluginId, scope);
		const secret = await crypto.encrypt(Buffer.from(label), { mode: 'local', context: secretContext });
		assert.ok(secret.isOk());
		const client = database.bind(pluginId, scope);
		await client.withClient((db) =>
			db
				.$extendTables<Tables>()
				.insertInto('items')
				.values({ id: 'same', label, secret: secret.value, excluded: label + '-local' })
				.execute(),
		);
		const origin = app.services.get('http').origin;
		const auth = await fetch(origin + '/api/auth/initialize', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: 'test', password: 'fixture-owner' }),
		});
		assert.equal(auth.status, 201);
		const cookie = auth.headers.get('set-cookie')!.split(';')[0];

		function call(path: string, data?: object, method = data ? 'POST' : 'GET') {
			return fetch(origin + path, {
				method,
				headers: { cookie, 'content-type': 'application/json' },
				...(data && { body: JSON.stringify(data) }),
			});
		}

		return { origin, cookie, call, client, crypto, secret: secret.value };
	};

	const from = await setup(source, 'source data');
	const to = await setup(target, 'target data');

	const updated = await from.call(
		settingsBase,
		{ animationSpeed: 1.9, motionEffects: false, theme: 'dark' },
		'PATCH',
	);
	assert.equal(updated.status, 200);
	await updated.body?.cancel();
	for (const animationSpeed of [0.7, 0.9]) {
		const response = await to.call(settingsBase, { animationSpeed }, 'PATCH');
		assert.equal(response.status, 200);
		await response.body?.cancel();
	}
	const settingsBefore = SettingsSnapshotSchema.parse(await (await to.call(settingsBase)).json());

	const stopped = await fetch(
		from.origin +
			'/api/plugins/' +
			encodeURIComponent(MarketplacePluginId) +
			'/manager/plugins/' +
			encodeURIComponent(pluginId),
		{
			method: 'PATCH',
			headers: { cookie: from.cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ enabled: false }),
		},
	);
	assert.equal(stopped.status, 202);
	const stopJob = MarketplaceOperationSchema.parse(await stopped.json());
	const stopPath = `/api/plugins/${encodeURIComponent(MarketplacePluginId)}/manager/operations/${stopJob.id}`;
	const deadline = AbortSignal.timeout(3000);
	for (;;) {
		deadline.throwIfAborted();
		const operation = MarketplaceOperationSchema.parse(await (await from.call(stopPath)).json());
		if (operation.state === 'succeeded') break;
		assert.notEqual(operation.state, 'failed');
		await wait(20, undefined, { signal: deadline });
	}
	assert.equal(
		(await readPluginRuntime(from.origin, from.cookie)).find((row) => row.pluginId === pluginId)?.runtime,
		'stopped',
	);
	assert.equal((await fetch(to.origin + backupBase + '/status')).status, 401);

	const exported = await from.call(backupBase + '/export', { password });
	assert.equal(exported.status, 200, exported.status === 200 ? '' : await exported.text());
	const file = BackupFileSchema.parse(await exported.json());
	const wrong = await to.call(backupBase + '/preview', { password: 'wrong-password', file });
	assert.equal(wrong.status, 400);
	const previewed = await to.call(backupBase + '/preview', { password, file });
	assert.equal(previewed.status, 200, previewed.status === 200 ? '' : await previewed.text());
	const plan = BackupPlanSchema.parse(await previewed.json());
	assert.deepEqual(plan.tables, [
		{ pluginId: SettingsPluginId, table: 'preferences', rows: 1 },
		{ pluginId, table: 'items', rows: 1 },
	]);
	const withoutPreview = await to.call(backupBase + '/restore', {
		password,
		file,
		token: '00000000-0000-4000-8000-000000000000',
	});
	assert.equal(withoutPreview.status, 409);

	const socket = new WebSocket(to.origin.replace('http:', 'ws:') + '/api/state/ws', {
		headers: { cookie: to.cookie },
	});
	const events = on(socket, 'message', { signal: AbortSignal.timeout(5000) });
	try {
		await once(socket, 'open');
		socket.send(JSON.stringify({ type: 'subscribe', topic: BackupStatusTopic }));
		await events.next();
		const response = await to.call(backupBase + '/restore', { password, file, token: plan.token });
		assert.equal(response.status, 202);
		const accepted = BackupStatusSchema.parse(await response.json());
		for await (const [raw] of events) {
			const frame = StateMessageSchema.parse(JSON.parse(String(raw)));
			if (frame.type !== 'patch') continue;
			const state = BackupJobSchema.parse(await (await to.call(backupBase + '/status')).json());
			if (state.job?.id !== accepted.id || state.job.state === 'restoring') continue;
			assert.equal(state.job.state, 'succeeded');
			break;
		}
	} finally {
		socket.terminate();
	}
	const row = await to.client.withClient((db) =>
		db.$extendTables<Tables>().selectFrom('items').selectAll().executeTakeFirstOrThrow(),
	);
	assert.equal(row.label, 'source data');
	assert.equal(row.excluded, 'target data-local');
	assert.notDeepEqual(row.secret, from.secret);
	const restored = await to.crypto.decrypt(row.secret, { mode: 'local', context: secretContext });
	assert.ok(restored.isOk());
	assert.equal(Buffer.from(restored.value).toString(), 'source data');
	assert.equal(
		(await readPluginRuntime(to.origin, to.cookie)).find((row) => row.pluginId === pluginId)?.runtime,
		'running',
	);
	const settingsAfter = SettingsSnapshotSchema.parse(await (await to.call(settingsBase)).json());
	assert.equal(settingsAfter.revision, settingsBefore.revision + 1);
	assert.equal(settingsAfter.preferences.animationSpeed, 1.9);
	assert.equal(settingsAfter.preferences.motionEffects, false);
	assert.equal(settingsAfter.preferences.theme, 'dark');
});

test('恢复普通外键时允许前向引用，无效引用回滚，并拦截触发器和级联副作用', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-backup-fk-'));
	const app = new App({ dataDirectory: root, logLevel: 'fatal' });
	const scope = new PluginScope(() => {});
	t.after(async () => {
		await scope.close();
		await app.close();
		await rm(root, { recursive: true, force: true });
	});
	await app.initialize();
	const database = app.services.get('database');
	const backup = new BackupDataApi({ database, crypto: app.services.get('crypto') });
	await backup.initialize(scope.signal);

	const prefix = pluginTablePrefix(pluginId);
	const parents = sql.id(prefix + 'parents');
	const children = sql.id(prefix + 'children');
	const retained = sql.id(prefix + 'retained');
	const marker = sql.id(prefix + 'marker');
	await database.withClient(async (db) => {
		await sql`create table ${parents} (id text primary key, code text unique not null)`.execute(db);
		await sql`create table ${children} (id text primary key, parent text references ${parents}(id))`.execute(db);
		await sql`create table ${retained} (id text primary key, parent text references ${parents}(code) on update cascade)`.execute(
			db,
		);
		await sql`create table ${marker} (id text primary key)`.execute(db);
		await sql`insert into ${marker} values ('existing')`.execute(db);
		await sql`create trigger backup_marker after delete on ${marker} begin select 1; end`.execute(db);
	});
	const definitions: BackupTable[] = [
		{ table: 'children', version: 1, keys: ['id'], fields: { id: 'plain', parent: 'plain' } },
		{ table: 'parents', version: 1, keys: ['id'], fields: { id: 'plain', code: 'plain' } },
		{ table: 'marker', version: 1, keys: ['id'], fields: { id: 'plain' } },
	];
	await backup.register(pluginId, '1.0.0', definitions, scope.signal);

	const archive = (child: string, code: string, markerRows = [{ id: 'existing' }]) =>
		backup.parse({
			entries: [[{ id: 'child', parent: child }], [{ id: 'parent', code }], markerRows].map((rows, index) => ({
				pluginId,
				pluginVersion: '1.0.0',
				table: definitions[index],
				rows,
			})),
		});

	const valid = archive('parent', 'original');
	await backup.preview(valid, scope);
	await backup.restore(valid, scope);
	const invalid = archive('missing', 'updated');
	await assert.rejects(backup.restore(invalid, scope), /FOREIGN KEY constraint failed/u);
	assert.deepEqual(await backup.export(scope), valid);

	await database.withClient((db) => sql`insert into ${retained} values ('local', 'original')`.execute(db));
	const cascade = archive('parent', 'updated');
	await assert.rejects(backup.preview(cascade, scope), { code: 'BACKUP_RESTORE_RELATIONSHIP_UNSAFE' });
	await assert.rejects(backup.restore(cascade, scope), { code: 'BACKUP_RESTORE_RELATIONSHIP_UNSAFE' });
	const triggered = archive('parent', 'original', []);
	await assert.rejects(backup.preview(triggered, scope), { code: 'BACKUP_RESTORE_TRIGGER_UNSAFE' });
	await assert.rejects(backup.restore(triggered, scope), { code: 'BACKUP_RESTORE_TRIGGER_UNSAFE' });
	assert.deepEqual(await backup.export(scope), valid);

	// 即使归档会先删除子行，执行也遵循预览对原始引用关系的整批检查。
	const retainedTable: BackupTable = {
		table: 'retained',
		version: 1,
		keys: ['id'],
		fields: { id: 'plain', parent: 'plain' },
	};
	await backup.register(pluginId, '1.0.0', [...definitions, retainedTable], scope.signal);
	const removesReference = backup.parse({
		entries: [{ pluginId, pluginVersion: '1.0.0', table: retainedTable, rows: [] }, ...cascade.entries],
	});
	await assert.rejects(backup.preview(removesReference, scope), { code: 'BACKUP_RESTORE_RELATIONSHIP_UNSAFE' });
	await assert.rejects(backup.restore(removesReference, scope), { code: 'BACKUP_RESTORE_RELATIONSHIP_UNSAFE' });
	const saved = await backup.export(scope);
	assert.deepEqual(saved.entries.find(({ table }) => table.table === 'retained')?.rows, [
		{ id: 'local', parent: 'original' },
	]);
});

test('缺少插件时预览只读，确认后安装准确版本并在数据写入后激活', { timeout: 25000 }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'nexus-backup-install-'));
	const source = new App({ dataDirectory: join(root, 'source'), logLevel: 'fatal' });
	const target = new App({ dataDirectory: join(root, 'target'), logLevel: 'fatal' });
	const owner = '@test/restore-target';
	const provider = '@test/restore-provider';
	let downloads = 0;
	let catalog: Awaited<ReturnType<typeof artifact>>[] = [];
	const bodies = new Map<string, Buffer>();
	const server = createServer((request, response) => {
		if (request.url === '/catalog.json') {
			response.setHeader('content-type', 'application/json').end(JSON.stringify(catalog));
			return;
		}
		const bytes = request.url && bodies.get(request.url);
		if (!bytes) response.writeHead(404).end();
		else {
			downloads++;
			response.end(bytes);
		}
	});
	t.after(async () => {
		await Promise.all([source.close(), target.close()]);
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(root, { recursive: true, force: true });
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	const repository = 'http://127.0.0.1:' + address.port;
	const marketplace = `/api/plugins/${encodeURIComponent(MarketplacePluginId)}`;

	async function artifact(name: string, entry: string, dependsOn: Record<string, string>) {
		const folder = join(root, name);
		await mkdir(folder, { recursive: true });
		const manifest = {
			name,
			type: 'module',
			version: '1.0.0',
			peerDependencies: { 'nexus-terminal': '^1.0.0' },
			nexus: { kind: 'extension', entry: { backend: 'index.mjs' }, dependsOn },
		};
		await Promise.all([
			writeFile(join(folder, 'package.json'), JSON.stringify(manifest)),
			writeFile(join(folder, 'index.mjs'), entry),
		]);
		const path = join(folder, 'artifact.tgz');
		await createArchive({ cwd: folder, file: path, gzip: true, prefix: 'package/' }, ['package.json', 'index.mjs']);
		const data = await readFile(path);
		const url = '/' + encodeURIComponent(name) + '.tgz';
		bodies.set(url, data);
		return {
			id: name,
			versions: [
				{
					package: manifest,
					distributions: [
						{
							tarball: repository + url,
							integrity: 'sha512-' + createHash('sha512').update(data).digest('base64'),
						},
					],
				},
			],
		};
	}

	catalog = await Promise.all([
		artifact(provider, "export function activate(ctx) { ctx.self.readiness.set({ state: 'ready' }); }", {}),
		artifact(
			owner,
			`
			export const backup = [{table:'items',version:1,keys:['id'],fields:{id:'plain',label:'plain'}}];
			export const migrations = { async getMigrations() { return { tables: { async up(db) {
				await db.schema.createTable('items').addColumn('id', 'text', c => c.primaryKey()).addColumn('label','text').execute();
				await db.schema.createTable('activation').addColumn('seen','text').execute();
			} } }; } };
			export async function activate(ctx) {
				await ctx.app.database.withClient(async (db) => {
					const row = await db.selectFrom('items').select('label').executeTakeFirst();
					await db.insertInto('activation').values({ seen: row?.label ?? 'empty' }).execute();
				});
				ctx.self.readiness.set({state:'ready'});
			}
		`,
			{ [provider]: '^1.0.0' },
		),
	]);

	async function connect(app: App) {
		await app.initialize();
		await app.startBuiltinPlugins();
		await app.startExternalPlugins();
		const origin = app.services.get('http').origin;
		const auth = await fetch(origin + '/api/auth/initialize', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ username: 'test', password: 'fixture-owner' }),
		});
		const cookie = auth.headers.get('set-cookie')!.split(';')[0];
		await auth.body?.cancel();

		const call = (path: string, input?: object, method = input ? 'POST' : 'GET') =>
			fetch(origin + path, {
				method,
				headers: { cookie, 'content-type': 'application/json' },
				body: input && JSON.stringify(input),
			});

		return { origin, cookie, call };
	}

	const [{ call: from }, { call: to, origin: targetOrigin, cookie: targetCookie }] = await Promise.all([
		connect(source),
		connect(target),
	]);
	const input = { url: repository + '/catalog.json' };
	const registered = MarketplaceRepositorySchema.parse(
		await (await from(marketplace + '/repositories', input)).json(),
	);
	const plan = MarketplaceInstallPlanSchema.parse(
		await (
			await from(marketplace + '/manager/install-plan', {
				kind: 'repository',
				pluginId: owner,
				version: '1.0.0',
				repositoryId: registered.id,
			})
		).json(),
	);
	const installation = MarketplaceOperationSchema.parse(
		await (await from(marketplace + '/manager/install', { plan })).json(),
	);
	const deadline = AbortSignal.timeout(8_000);
	for (;;) {
		const status = MarketplaceOperationSchema.parse(
			await (await from(marketplace + '/manager/operations/' + installation.id)).json(),
		);
		if (status.finishedAt) {
			assert.equal(status.state, 'succeeded');
			break;
		}
		await wait(20, undefined, { signal: deadline });
	}
	const items = sql.id(pluginTablePrefix(owner) + 'items');
	await source.services
		.get('database')
		.withClient((db) => sql`insert into ${items} values ('item', 'restored first')`.execute(db));
	const file = BackupFileSchema.parse(await (await from(backupBase + '/export', { password })).json());

	const unavailable = await to(backupBase + '/preview', { file, password });
	assert.equal(unavailable.status, 409);
	assert.equal((await unavailable.json()).code, 'BACKUP_PLUGIN_SOURCE_UNAVAILABLE');
	assert.equal(downloads, 2);

	const targetRepo = MarketplaceRepositorySchema.parse(await (await to(marketplace + '/repositories', input)).json());
	assert.notEqual(targetRepo.id, registered.id);
	const preview = BackupPlanSchema.parse(await (await to(backupBase + '/preview', { file, password })).json());
	assert.deepEqual(
		preview.installs.map(({ pluginId }) => pluginId),
		[provider, owner],
	);
	assert.equal(downloads, 2);
	assert.equal(
		(await readPluginRuntime(targetOrigin, targetCookie)).find((row) => row.pluginId === owner),
		undefined,
	);
	const db = target.services.get('database');
	assert.equal(
		(
			await db.withClient((client) =>
				sql`select name from sqlite_schema where name = ${pluginTablePrefix(owner) + 'items'}`.execute(client),
			)
		).rows.length,
		0,
	);

	async function expectRestore(token: string, expected: 'succeeded' | 'failed') {
		const accepted = await to(backupBase + '/restore', { file, password, token });
		assert.equal(accepted.status, 202);
		const { id } = BackupStatusSchema.parse(await accepted.json());
		const restoreDeadline = AbortSignal.timeout(8_000);
		for (;;) {
			const { job } = BackupJobSchema.parse(await (await to(backupBase + '/status')).json());
			if (job?.id === id && job.state !== 'restoring') {
				assert.equal(job.state, expected, JSON.stringify(job));
				return job;
			}
			await wait(20, undefined, { signal: restoreDeadline });
		}
	}

	const original = catalog;
	catalog = original.map((item) => ({
		...item,
		versions: item.versions.map((version) => ({
			...version,
			distributions: version.distributions.map((dist) => ({ ...dist, tarball: dist.tarball + '?changed' })),
		})),
	}));
	const refreshPath = marketplace + '/repositories/' + targetRepo.id + '/refresh';
	assert.equal((await to(refreshPath, undefined, 'POST')).status, 204);
	assert.equal((await expectRestore(preview.token, 'failed')).error, 'BACKUP_RESTORE_PLAN_CHANGED');
	assert.equal(downloads, 2);
	assert.equal(
		(await readPluginRuntime(targetOrigin, targetCookie)).find((row) => row.pluginId === owner),
		undefined,
	);

	catalog = original;
	assert.equal((await to(refreshPath, undefined, 'POST')).status, 204);
	const updated = BackupPlanSchema.parse(await (await to(backupBase + '/preview', { file, password })).json());
	await expectRestore(updated.token, 'succeeded');

	assert.equal(downloads, 4);
	assert.equal(
		(await readPluginRuntime(targetOrigin, targetCookie)).find((row) => row.pluginId === owner)?.runtime,
		'running',
	);
	assert.equal(
		(await readPluginRuntime(targetOrigin, targetCookie)).find((row) => row.pluginId === provider)?.runtime,
		'running',
	);
	const activation = sql.id(pluginTablePrefix(owner) + 'activation');
	assert.deepEqual((await db.withClient((client) => sql`select seen from ${activation}`.execute(client))).rows, [
		{ seen: 'restored first' },
	]);
});
