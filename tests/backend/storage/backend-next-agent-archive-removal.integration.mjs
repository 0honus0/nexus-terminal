import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { applicationMigrations } from '../../../packages/backend/dist/bootstrap/schema.js';
import { initializeSchema } from '../../../packages/backend/dist/platform/storage/sqlite/schema.js';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { readRunAppExecution } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-app-execution-row.js';
import { snapshotPluginVersion } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-plugin-versions.js';
import { definitionComposition } from '../../../packages/backend/dist/modules/agent/scope/adapters/sqlite/definition-composition-row.js';
import { validateSnapshotRunExecution } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-run-execution.js';
import { registerAgentSnapshot } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-registration.js';

async function fixture(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-archive-removal-'));
	const path = join(directory, 'state.db');
	let db = SqliteRuntime.open(path);
	t.after(async () => {
		try {
			await db.close();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	await initializeSchema(
		db,
		applicationMigrations.filter((m) => m.version <= 60),
	);
	await db.run(
		"INSERT INTO access_accounts(id,username,password_hash,created_at,updated_at) VALUES(1,'retained-account','opaque-password-hash',1,1)",
	);
	const { publicKey } = generateKeyPairSync('ed25519');
	const publisher =
		'ed25519:' +
		createHash('sha256')
			.update(publicKey.export({ type: 'spki', format: 'der' }))
			.digest('hex');
	await db.run("INSERT INTO agent_plugin_publishers VALUES(1,?,?,'fixture',1,1,NULL)", [
		publisher,
		publicKey.export({ type: 'spki', format: 'pem' }).toString(),
	]);
	const unbound = randomUUID();
	await db.run("INSERT INTO agent_app_definitions VALUES('fixture.unbound','1.0.0','Unbound legacy App',?)", [
		'a'.repeat(64),
	]);
	await db.run(
		"INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,1,'Unbound legacy App','fixture.unbound','1.0.0',0,1,1)",
		[unbound],
	);
	const identities = [];
	for (const sdk of [4, 3]) {
		const app = randomUUID(),
			thread = randomUUID(),
			run = randomUUID(),
			stage = randomUUID();
		const packageId = 'fixture.sdk' + sdk,
			hash = String(sdk).repeat(64);
		const manifest = {
			schemaVersion: sdk,
			id: packageId,
			version: '1.0.0',
			displayName: 'SDK ' + sdk,
			compatibility: { host: { minVersion: '1.0.0', maxVersion: '1.99.99' }, backendSdk: sdk, frontendSdk: null },
			capabilities: [],
			intents: [],
			dependencies: [],
			namespaces: [packageId],
			frontendEntry: null,
			backendEntry: 'backend/index.mjs',
			contributions: {
				app: { entry: packageId + '.run', uiContract: null, uiApiVersion: null },
				tools: false,
				services: false,
				ui: null,
				settings: null,
				skills: [],
			},
		};
		const json = JSON.stringify(manifest);
		const composition = definitionComposition(1, [
			{ packageId, kind: 'app', version: '1.0.0', packageHash: hash, publisherKeyId: publisher },
		]);
		await db.run('INSERT INTO agent_app_definitions VALUES(?,?,?,?)', [
			composition.id,
			'1.0.0',
			manifest.displayName,
			composition.digest,
		]);
		await db.run(
			'INSERT INTO agent_apps(id,user_id,name,definition_id,definition_version,enabled,created_at,updated_at) VALUES(?,1,?,?,?,1,1,1)',
			[app, manifest.displayName, composition.id, '1.0.0'],
		);
		await db.run(
			"INSERT INTO agent_threads(id,user_id,app_id,title,title_origin,version,created_at,updated_at) VALUES(?,1,?,'retained thread','manual',1,1,1)",
			[thread, app],
		);
		await db.run("INSERT INTO agent_plugin_stages VALUES(?,1,?,1024,'installed',1,?,?,1,1)", [
			stage,
			hash,
			publisher,
			json,
		]);
		await db.run('INSERT INTO agent_plugin_versions VALUES(1,?,?,?,?,?,?)', [
			packageId,
			'1.0.0',
			hash,
			publisher,
			stage,
			json,
		]);
		await db.run("INSERT INTO agent_app_definition_packages VALUES(1,?,? ,?,'app',?,?,?)", [
			composition.id,
			'1.0.0',
			packageId,
			'1.0.0',
			hash,
			publisher,
		]);
		await db.run("INSERT INTO agent_plugin_packages VALUES(1,?,'1.0.0',?,?,'installed',1,1,1)", [
			packageId,
			hash,
			publisher,
		]);
		await db.run("INSERT INTO agent_plugin_installations VALUES(1,?,?,'1.0.0',?,?,'installed',1,1,1)", [
			app,
			packageId,
			hash,
			publisher,
		]);
		await db.run('INSERT INTO agent_plugin_app_bindings VALUES(1,?,1,1)', [app]);
		await db.run("INSERT INTO agent_plugin_app_packages VALUES(1,?,?,'app','1.0.0',?,?,1)", [
			app,
			packageId,
			hash,
			publisher,
		]);
		await db.run("INSERT INTO agent_plugin_instances VALUES(?,1,?,?,?,1,1,1,1,1,'{}',1,1)", [
			app,
			app,
			packageId,
			packageId,
		]);
		await db.run("INSERT INTO agent_plugin_private_data VALUES(1,?,?,?,?,?,'value',2,'{\"preserve\":true}',1)", [
			app,
			publisher,
			packageId,
			app,
			packageId,
		]);
		await db.run("INSERT INTO agent_plugin_data VALUES(1,?,'value',2,'{\"preserve\":true}',1)", [app]);
		await db.run(
			"INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,approval_mode,status,version,input_text,deadline_at,selected_connections_json,created_at,updated_at) VALUES(?,1,?,?,1,'root','ask','unknown',3,'prompt',9999999999999,'[]',1,3)",
			[run, app, thread],
		);
		const execution =
			sdk === 4
				? {
						kind: 'plugin',
						package: { packageId, version: '1.0.0', packageHash: hash, publisherKeyId: publisher },
						codeDependencies: [],
						handler: packageId + '.run',
					}
				: { kind: 'retired' };
		await db.run('INSERT INTO agent_run_inputs VALUES(?,?,?,NULL)', [
			run,
			JSON.stringify(execution),
			'{"message":"prompt"}',
		]);
		for (const [index, type] of ['run.created', 'run.started', 'run.unknown'].entries())
			await db.run('INSERT INTO agent_run_events VALUES(?,?,?,?,?)', [
				run,
				index + 1,
				index + 1,
				index + 1,
				type,
			]);
		identities.push({ app, thread, run, packageId, stage, execution, manifest });
	}
	return {
		get db() {
			return db;
		},

		identities,
		unbound,

		async restart() {
			await db.close();
			db = SqliteRuntime.open(path);
		},
	};
}

await test('Archive removal: v60 upgrade deletes old Agent history while preserving SDK4 unknown fences, configuration and non-Agent records', async (t) => {
	const f = await fixture(t),
		current = f.identities[0],
		old = f.identities[1];
	const account = await f.db.one('SELECT * FROM access_accounts WHERE id=1');
	const oldVersions = await f.db.all('SELECT * FROM schema_version ORDER BY version');
	const preservedTables = [
		'agent_apps',
		'agent_threads',
		'agent_runs',
		'agent_plugin_installations',
		'agent_plugin_instances',
		'agent_plugin_data',
		'agent_plugin_private_data',
	];
	const before = new Map();
	for (const table of preservedTables) {
		const column = table === 'agent_apps' ? 'id' : 'app_id';
		before.set(table, await f.db.all('SELECT * FROM ' + table + ' WHERE ' + column + '=?', [current.app]));
	}
	await initializeSchema(f.db, applicationMigrations);
	for (const table of preservedTables) {
		const column = table === 'agent_apps' ? 'id' : 'app_id';
		assert.deepEqual(
			await f.db.all('SELECT * FROM ' + table + ' WHERE ' + column + '=?', [current.app]),
			before.get(table),
			table + ' is retained exactly',
		);
		assert.deepEqual(
			await f.db.all('SELECT * FROM ' + table + ' WHERE ' + column + '=?', [old.app]),
			[],
			table + ' clears obsolete App',
		);
	}
	assert.deepEqual(await f.db.one('SELECT * FROM access_accounts WHERE id=1'), account);
	assert.equal(await f.db.one('SELECT * FROM agent_apps WHERE id=?', [f.unbound]), null);
	assert.equal(await f.db.one("SELECT * FROM agent_app_definitions WHERE id='fixture.unbound'"), null);
	assert.deepEqual((await f.db.all('SELECT * FROM schema_version ORDER BY version')).slice(0, 60), oldVersions);
	assert.deepEqual(
		readRunAppExecution(
			(await f.db.one('SELECT * FROM agent_run_inputs WHERE run_id=?', [current.run])).app_execution_json,
		),
		current.execution,
	);
	assert.equal(await f.db.one('SELECT * FROM agent_run_inputs WHERE run_id=?', [old.run]), null);
	assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
	assert.equal((await f.db.one('PRAGMA integrity_check')).integrity_check, 'ok');
	const committed = await f.db.all('SELECT * FROM schema_version ORDER BY version');
	await f.restart();
	await initializeSchema(f.db, applicationMigrations);
	assert.deepEqual(await f.db.all('SELECT * FROM schema_version ORDER BY version'), committed);
	assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [current.run])).status, 'unknown');
	const registered = registerAgentSnapshot(null, () => {});
	const rows = new Map();
	for (const table of registered.tables) rows.set(table.name, await f.db.all('SELECT * FROM ' + table.name));
	registered.validate(rows);
	for (const table of registered.tables) {
		for (const row of await f.db.all('SELECT * FROM ' + table.name))
			assert.deepEqual(
				registered.restore(table, registered.transfer(table, row)),
				Object.fromEntries(Object.entries(row)),
			);
	}
});

await test('Archive removal: failure after real DROP and deletion rolls back data, DDL and migration marker, then permits retry', async (t) => {
	const f = await fixture(t);
	await initializeSchema(f.db, applicationMigrations.slice(0, 61));
	const migration = applicationMigrations.find((m) => m.version === 62);
	const stop = new Error('injected before migration commit');
	await assert.rejects(
		initializeSchema(f.db, [
			...applicationMigrations.slice(0, 61),
			{
				...migration,

				async apply(tx) {
					await migration.apply(tx);
					throw stop;
				},
			},
		]),
		(error) => error === stop,
	);
	assert.equal((await f.db.one('SELECT MAX(version) AS version FROM schema_version')).version, 61);
	assert.ok(await f.db.one("SELECT name FROM sqlite_master WHERE name='agent_run_model_steps'"));
	assert.equal((await f.db.one('SELECT COUNT(*) AS count FROM agent_runs')).count, 2);
	assert.deepEqual(await f.db.all("SELECT name FROM sqlite_temp_master WHERE name LIKE 'agent_removed_%'"), []);
	await initializeSchema(f.db, applicationMigrations);
	assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
});

await test('Archive removal: current decoders and snapshot provenance reject retired Run and SDK3 package documents', () => {
	assert.throws(() => readRunAppExecution('{"kind":"retired"}'));
	assert.throws(() =>
		snapshotPluginVersion({
			user_id: 1,
			definition_id: 'fixture.old',
			version: '1.0.0',
			package_hash: 'a'.repeat(64),
			publisher_key_id: 'ed25519:' + 'b'.repeat(64),
			manifest_json: JSON.stringify({ schemaVersion: 3 }),
		}),
	);
	const run = randomUUID();
	assert.throws(() =>
		validateSnapshotRunExecution(
			new Map([
				['agent_runs', [{ id: run, user_id: 1 }]],
				['agent_run_inputs', [{ run_id: run, app_execution_json: '{\"kind\":\"retired\"}', input_json: '{}' }]],
			]),
		),
	);
});

await test('Archive removal: queued file cleanup removes all other objects on failure and retries the retained item after restart', async (t) => {
	const f = await fixture(t),
		old = f.identities[1],
		current = f.identities[0];
	const { NativeBlobStore } =
		await import('../../../packages/backend/dist/platform/blobs/adapters/native-blob-store.js');
	const { BlobFailure } = await import('../../../packages/backend/dist/platform/blobs/blob-store.js');
	const { ArtifactModel } =
		await import('../../../packages/backend/dist/modules/agent/artifacts/model/artifact-model.js');
	const { ArtifactService } =
		await import('../../../packages/backend/dist/modules/agent/artifacts/service/artifact-service.js');
	const { SqliteArtifactStorage } =
		await import('../../../packages/backend/dist/modules/agent/artifacts/adapters/sqlite/artifact-sql.js');
	const directory = await mkdtemp(join(tmpdir(), 'nexus-removed-artifacts-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const blobs = await NativeBlobStore.open(directory);
	const ids = [randomUUID(), randomUUID(), randomUUID()];
	for (const [index, id] of ids.entries()) {
		const bytes = Buffer.from('actual retained blob ' + index);
		await blobs.write(
			id,
			(async function* () {
				yield bytes;
			})(),
			bytes.length,
			new AbortController().signal,
		);
		await f.db.run(
			"INSERT INTO agent_artifacts(id,user_id,app_id,name,media_type,kind,size_bytes,sha256,status,retained,version,created_at,ready_at,upload_claimed) VALUES(?,1,?,'blob','text/plain','document',?,?,'ready',0,1,1,1,0)",
			[id, index === 2 ? current.app : old.app, bytes.length, createHash('sha256').update(bytes).digest('hex')],
		);
	}
	await initializeSchema(f.db, applicationMigrations);
	assert.deepEqual(
		(await f.db.all('SELECT id FROM agent_artifact_blob_removals ORDER BY id')).map((r) => r.id),
		ids.slice(0, 2).sort(),
	);
	const registration = registerAgentSnapshot(null, () => {});
	assert.throws(
		() => registration.validate(new Map([['agent_artifact_blob_removals', [{ id: ids[0] }]]])),
		(error) => error.kind === 'source_changed',
	);
	let fail = true;
	const storage = new SqliteArtifactStorage(f.db);
	const model = new ArtifactModel(
		storage,
		{
			remove: async (id) => {
				if (fail && id === ids[0]) throw new BlobFailure('io_unknown');
				await blobs.remove(id);
			},
		},
		null,
		null,
	);
	const service = new ArtifactService(model, null, null);
	await assert.rejects(service.initialize(), AggregateError);
	assert.equal((await blobs.size(ids[0])) > 0, true);
	await assert.rejects(blobs.size(ids[1]), (error) => error instanceof BlobFailure && error.kind === 'not_found');
	assert.equal((await blobs.size(ids[2])) > 0, true);
	assert.deepEqual(await storage.pendingBlobRemovals(), [ids[0]]);
	await f.restart();
	fail = false;
	const restored = new ArtifactService(
		new ArtifactModel(new SqliteArtifactStorage(f.db), blobs, null, null),
		null,
		null,
	);
	await restored.initialize();
	assert.deepEqual(await f.db.all('SELECT * FROM agent_artifact_blob_removals'), []);
	await assert.rejects(blobs.size(ids[0]), (error) => error instanceof BlobFailure && error.kind === 'not_found');
	assert.equal((await blobs.size(ids[2])) > 0, true);
	await f.db.run('INSERT INTO agent_artifact_blob_removals VALUES(?)', [ids[2]]);
	await assert.rejects(restored.initialize(), AggregateError);
	assert.equal((await blobs.size(ids[2])) > 0, true, 'A corrupt queue must never delete a live Artifact');
	assert.deepEqual(
		(await f.db.all('SELECT id FROM agent_artifact_blob_removals')).map((row) => row.id),
		[ids[2]],
	);
});

await test('Archive removal: Provider deletion consults current Operation reservations after the fixed-model table is dropped', async (t) => {
	const f = await fixture(t),
		current = f.identities[0];
	await initializeSchema(f.db, applicationMigrations);
	const { SqliteProviderStorage } =
		await import('../../../packages/backend/dist/modules/agent/providers/adapters/sqlite/provider-sql.js');
	const providers = new SqliteProviderStorage(f.db),
		provider = randomUUID(),
		generation = randomUUID(),
		operation = randomUUID();
	await f.db.run(
		"INSERT INTO agent_providers(id,user_id,display_name,base_url,protocol,models_json,credential_revision,enabled,version,created_at,updated_at) VALUES(?,1,'Provider','https://provider.invalid','responses','[{\"id\":\"model\",\"supportsTools\":true}]',1,1,1,1,1)",
		[provider],
	);
	await f.db.run("INSERT INTO agent_run_executions VALUES(?,?,'draining',1,1)", [current.run, generation]);
	await f.db.run(
		"INSERT INTO agent_operations(id,user_id,app_id,run_id,execution_generation,caller_id,operation_key,request_hash,kind,label,binding_json,arguments_json,state,revision,created_at,updated_at,sequence) VALUES(?,1,?,?,?,?,'model',?,'model','model.invoke','{}','{}','unknown',2,1,1,1)",
		[operation, current.app, current.run, generation, current.app, 'a'.repeat(64)],
	);
	await f.db.run('INSERT INTO agent_operation_model_reservations VALUES(?,?,?,1,NULL,NULL)', [
		operation,
		current.run,
		provider,
	]);
	let checks = 0;
	assert.deepEqual(
		await providers.remove(1, provider, 1, 2, (usage) => {
			checks++;
			assert.deepEqual(usage.runStatuses, ['unknown']);
			return false;
		}),
		{ status: 'provider_in_use' },
	);
	assert.equal(checks, 1);
	assert.equal((await f.db.one('SELECT enabled FROM agent_providers WHERE id=?', [provider])).enabled, 1);
});

await test('Archive removal: plugin purge failure rolls back App deletion and file cleanup intents together', async (t) => {
	const f = await fixture(t);
	await initializeSchema(f.db, applicationMigrations.slice(0, 62));
	const previous = await f.db.all('SELECT * FROM agent_apps ORDER BY id');
	const migration = applicationMigrations[62],
		stop = new Error('plugin purge commit failure');
	await assert.rejects(
		initializeSchema(f.db, [
			...applicationMigrations.slice(0, 62),
			{
				...migration,

				async apply(tx) {
					await migration.apply(tx);
					throw stop;
				},
			},
		]),
		(error) => error === stop,
	);
	assert.deepEqual(await f.db.all('SELECT * FROM agent_apps ORDER BY id'), previous);
	assert.equal((await f.db.one('SELECT MAX(version) AS version FROM schema_version')).version, 62);
	assert.deepEqual(await f.db.all('SELECT * FROM agent_artifact_blob_removals'), []);
	await initializeSchema(f.db, applicationMigrations);
	assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
});

await test('Archive removal: SDK4 App runs with old code dependencies and their memories are removed without rewriting current records', async (t) => {
	const f = await fixture(t),
		current = f.identities[0],
		old = f.identities[1];
	const obsolete = randomUUID(),
		oldMemory = randomUUID(),
		currentMemory = randomUUID();
	await f.db.run(
		"INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,approval_mode,status,version,input_text,deadline_at,selected_connections_json,created_at,updated_at) SELECT ?,user_id,app_id,thread_id,2,run_kind,approval_mode,'failed',version,input_text,deadline_at,selected_connections_json,created_at,updated_at FROM agent_runs WHERE id=?",
		[obsolete, current.run],
	);
	const execution = {
		...current.execution,
		codeDependencies: [
			{
				packageId: old.packageId,
				version: '1.0.0',
				packageHash: '3'.repeat(64),
				publisherKeyId: current.execution.package.publisherKeyId,
			},
		],
	};
	await f.db.run('INSERT INTO agent_run_inputs VALUES(?,?,?,NULL)', [obsolete, JSON.stringify(execution), '{}']);
	for (const [id, run, version] of [
		[oldMemory, obsolete, Number.MAX_SAFE_INTEGER],
		[currentMemory, current.run, 1],
	]) {
		await f.db.run(
			"INSERT INTO agent_memories(id,user_id,app_id,content,confidence,status,source_run_id,version,created_at,updated_at) VALUES(?,1,?,'memory',1,'candidate',?,?,1,1)",
			[id, current.app, run, version],
		);
	}
	const retained = await f.db.one('SELECT * FROM agent_memories WHERE id=?', [currentMemory]);
	await initializeSchema(f.db, applicationMigrations);
	assert.equal(await f.db.one('SELECT * FROM agent_runs WHERE id=?', [obsolete]), null);
	assert.equal(await f.db.one('SELECT * FROM agent_memories WHERE id=?', [oldMemory]), null);
	assert.deepEqual(await f.db.one('SELECT * FROM agent_memories WHERE id=?', [currentMemory]), retained);
	assert.equal((await f.db.one('SELECT status FROM agent_runs WHERE id=?', [current.run])).status, 'unknown');
	assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
});

await test('Archive removal: deleting an obsolete child collects its entire persisted family without dangling collaboration or Operation references', async (t) => {
	const f = await fixture(t),
		current = f.identities[0];
	const generation = randomUUID(),
		operation = randomUUID(),
		oldChild = randomUUID(),
		sibling = randomUUID();
	await f.db.run("INSERT INTO agent_run_executions VALUES(?,?,'draining',1,1)", [current.run, generation]);
	await f.db.run(
		"INSERT INTO agent_operations(id,user_id,app_id,run_id,execution_generation,caller_id,operation_key,request_hash,kind,label,binding_json,arguments_json,state,revision,created_at,updated_at,sequence) VALUES(?,1,?,?,?,?,'child',?,'effect','child.create','{}','{}','unknown',1,1,1,1)",
		[operation, current.app, current.run, generation, current.app, 'a'.repeat(64)],
	);
	for (const [index, child] of [oldChild, sibling].entries()) {
		await f.db.run(
			"INSERT INTO agent_runs(id,user_id,app_id,thread_id,thread_sequence,run_kind,approval_mode,status,version,input_text,deadline_at,selected_connections_json,created_at,updated_at) SELECT ?,user_id,app_id,thread_id,?,'child',approval_mode,status,version,input_text,deadline_at,selected_connections_json,created_at,updated_at FROM agent_runs WHERE id=?",
			[child, index + 2, current.run],
		);
		await f.db.run('INSERT INTO agent_run_inputs VALUES(?,?,?,NULL)', [
			child,
			index === 0 ? '{"kind":"retired"}' : JSON.stringify(current.execution),
			'{}',
		]);
		const childOperation = index === 0 ? operation : randomUUID();
		if (index === 1)
			await f.db.run(
				"INSERT INTO agent_operations SELECT ?,user_id,app_id,run_id,execution_generation,parent_id,caller_id,'sibling',request_hash,kind,label,binding_json,arguments_json,state,revision,result_json,failure_code,created_at,updated_at,2 FROM agent_operations WHERE id=?",
				[childOperation, operation],
			);
		await f.db.run("INSERT INTO agent_run_children VALUES(?,?,?,?,'explore',NULL,'[]',1,'[]','success')", [
			child,
			current.run,
			childOperation,
			'a'.repeat(64),
		]);
	}
	await f.db.run("INSERT INTO agent_run_facts VALUES(?,'fact','legacy family',1,?)", [current.run, oldChild]);
	await initializeSchema(f.db, applicationMigrations);
	for (const run of [current.run, oldChild, sibling])
		assert.equal(await f.db.one('SELECT id FROM agent_runs WHERE id=?', [run]), null);
	assert.deepEqual(await f.db.all('SELECT * FROM agent_run_children'), []);
	assert.deepEqual(await f.db.all('SELECT * FROM agent_run_facts'), []);
	assert.deepEqual(await f.db.all('SELECT * FROM agent_operations'), []);
	assert.deepEqual(await f.db.all('PRAGMA foreign_key_check'), []);
});
