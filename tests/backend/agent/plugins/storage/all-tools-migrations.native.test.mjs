import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeRunTools } from '../../../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-schema.js';
import { generalizeToolChildren } from '../../../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-children-migration.js';
import { persistToolRequiredCapabilities } from '../../../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-capabilities-migration.js';
import { persistToolOutputArtifacts } from '../../../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-artifacts-migration.js';
import { persistToolIdentities } from '../../../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-identity-migration.js';
import { retirePreviousPluginToolContract } from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-tool-contract-migration.js';
import { pluginToolName } from '../../../../../packages/backend/dist/modules/agent/plugins/plugin-tool-authority-rules.js';
import { snapshotPluginVersion } from '../../../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-plugin-versions.js';
import { readAgentToolIdentity } from '../../../../../packages/shared/dist/agent/tools/identity-codec.js';

function sqlite(t) {
	const db = new DatabaseSync(':memory:');
	t.after(() => db.close());
	const tx = {
		exec: async (sql) => {
			db.exec(sql);
		},

		run: async (sql, args = []) => db.prepare(sql).run(...args),

		one: async (sql, args = []) => db.prepare(sql).get(...args) ?? null,

		all: async (sql, args = []) => db.prepare(sql).all(...args),
	};
	return { db, tx };
}

await test('All tools migration: 26-28 preserve historical hashes while adding exact requirements, trusted output references and signed identities', async (t) => {
	const { db, tx } = sqlite(t);
	// Production journal DDL/child relation; unrelated App owners expose only their referenced keys.
	db.exec(`CREATE TABLE agent_apps(id TEXT,user_id INTEGER,PRIMARY KEY(id,user_id));
   CREATE TABLE agent_runs(id TEXT,user_id INTEGER,app_id TEXT,PRIMARY KEY(id,user_id,app_id));
   CREATE TABLE agent_run_model_steps(run_id TEXT,step_index INTEGER,PRIMARY KEY(run_id,step_index));
   CREATE TABLE agent_plugin_versions(user_id INTEGER,definition_id TEXT,version TEXT,package_hash TEXT,manifest_json TEXT);
   CREATE TABLE agent_governance_approvals(id TEXT,user_id INTEGER,tool_call_id TEXT,inspection_json TEXT,operation_hash TEXT,version INTEGER,status TEXT);`);
	await initializeRunTools(tx);
	await generalizeToolChildren(tx);
	const app = randomUUID(),
		run = randomUUID(),
		artifact = randomUUID(),
		second = randomUUID();
	db.prepare('INSERT INTO agent_apps VALUES(?,1)').run(app);
	db.prepare('INSERT INTO agent_runs VALUES(?,1,?)').run(run, app);
	db.prepare('INSERT INTO agent_run_model_steps VALUES(?,1)').run(run);
	const packageId = 'third.party',
		packageHash = 'a'.repeat(64),
		local = 'artifact_create';
	const signedName = pluginToolName(packageId, local);
	const manifest = JSON.stringify({
		schemaVersion: 2,
		id: packageId,
		version: '1.0.0',
		contributions: { tools: [{ name: local }] },
	});
	db.prepare('INSERT INTO agent_plugin_versions VALUES(1,?,?,?,?)').run(packageId, '1.0.0', packageHash, manifest);

	const insert = (name, state, result, version = '1.0.0') => {
		const id = randomUUID();
		db.prepare(
			`INSERT INTO agent_run_tools(id,user_id,app_id,run_id,model_step_index,provider_call_id,tool_name,tool_version,capability,risk,mutation,summary,arguments_json,operation_hash,operation_revision,revision,state,result_text,created_at,updated_at)
      VALUES(?,1,?,?,1,?,?,?,'file.read','read',0,'historical summary','{}',?,1,1,?,?,1,1)`,
		).run(id, app, run, id, name, version, 'b'.repeat(64), state, result);
		return id;
	};

	const delivered = insert(
		'file_deliver',
		'unknown',
		JSON.stringify({
			items: [
				{ status: 'completed', value: { id: artifact } },
				{ status: 'completed', value: { id: artifact } },
				{ status: 'failed', failureCode: 'not_found' },
				{ status: 'unknown' },
			],
		}),
	);
	const image = insert('image_generate', 'completed', JSON.stringify({ id: second }));
	const malformedUnknown = insert('artifact_present', 'unknown', 'unknown transport prefix');
	const fake = insert(signedName, 'completed', JSON.stringify({ id: second }), packageId + '@1.0.0#' + packageHash);
	const parent = insert(signedName, 'completed', '{}', packageId + '@1.0.0#' + packageHash);
	const permission = insert('plugin_tool_call', 'completed', '{}');
	db.prepare("INSERT INTO agent_tool_children VALUES(?,?,?,'actual-owned-output','plugin_tool',?,1,?,1)").run(
		delivered,
		parent,
		'b'.repeat(64),
		packageId,
		randomUUID(),
	);
	db.prepare('INSERT INTO agent_governance_approvals VALUES(?,1,?,?,?,7,?)').run(
		randomUUID(),
		fake,
		JSON.stringify({
			toolName: signedName,
			toolVersion: packageId + '@1.0.0#' + packageHash,
			summary: 'retained approval summary',
		}),
		'b'.repeat(64),
		'approved',
	);
	db.prepare('INSERT INTO agent_governance_approvals VALUES(?,1,?,?,?,3,?)').run(
		randomUUID(),
		fake,
		JSON.stringify({
			toolName: 'shell_execute',
			toolVersion: '1.0.0',
			summary: 'superseded inspection remains its own historical authority',
		}),
		'c'.repeat(64),
		'superseded',
	);
	const original = db
		.prepare(
			'SELECT id,tool_name,tool_version,operation_hash,summary,arguments_json FROM agent_run_tools ORDER BY id',
		)
		.all();
	await persistToolRequiredCapabilities(tx);
	assert.deepEqual(
		JSON.parse(
			db.prepare('SELECT required_capabilities_json FROM agent_run_tools WHERE id=?').get(delivered)
				.required_capabilities_json,
		),
		['artifacts.write'],
	);
	assert.deepEqual(
		JSON.parse(
			db.prepare('SELECT required_capabilities_json FROM agent_run_tools WHERE id=?').get(fake)
				.required_capabilities_json,
		),
		[],
	);
	await persistToolOutputArtifacts(tx);

	const outputs = (id) =>
		JSON.parse(
			db.prepare('SELECT output_artifact_ids_json FROM agent_run_tools WHERE id=?').get(id)
				.output_artifact_ids_json,
		);

	assert.deepEqual(outputs(delivered), [artifact], 'unknown retains only confirmed, deduplicated historical outputs');
	assert.deepEqual(outputs(image), [second]);
	assert.deepEqual(outputs(parent), [artifact], 'terminal package parent inherits only actual journal descendants');
	assert.deepEqual(outputs(fake), [], 'same local name and fake result JSON cannot manufacture artifact authority');
	assert.deepEqual(outputs(malformedUnknown), [], 'unknown text is not parsed as a confirmed output');
	await persistToolIdentities(tx);

	const identity = (id) =>
		readAgentToolIdentity(
			JSON.parse(db.prepare('SELECT identity_json FROM agent_run_tools WHERE id=?').get(id).identity_json),
		);

	assert.deepEqual(identity(fake), {
		kind: 'plugin',
		packageId,
		packageVersion: '1.0.0',
		packageSha256: packageHash,
		name: local,
	});
	// These immutable migration steps still execute before v61 deletes the archive.
	for (const id of [fake, parent]) {
		const row = db.prepare('SELECT * FROM agent_run_tools WHERE id=?').get(id);
		assert.equal(row.tool_name, signedName);
		assert.deepEqual(JSON.parse(row.identity_json), identity(id));
		assert.deepEqual(JSON.parse(row.output_artifact_ids_json), id === parent ? [artifact] : []);
	}
	assert.deepEqual(identity(delivered), { kind: 'host', operation: 'remote.deliver' });
	assert.deepEqual(identity(permission), { kind: 'host', operation: 'plugins.invoke' });
	const superseded = db.prepare("SELECT * FROM agent_governance_approvals WHERE status='superseded'").get();
	assert.deepEqual(
		JSON.parse(superseded.inspection_json).identity,
		{ kind: 'host', operation: 'shell.execute' },
		'superseded approval uses its own inspection, not the current tool_call_id target',
	);
	assert.equal(superseded.operation_hash, 'c'.repeat(64));
	assert.equal(superseded.version, 3);
	const approval = db.prepare("SELECT * FROM agent_governance_approvals WHERE status='approved'").get();
	assert.deepEqual(JSON.parse(approval.inspection_json).identity, identity(fake));
	assert.equal(approval.operation_hash, 'b'.repeat(64));
	assert.equal(approval.version, 7);
	assert.equal(approval.status, 'approved');
	assert.deepEqual(
		db
			.prepare(
				'SELECT id,tool_name,tool_version,operation_hash,summary,arguments_json FROM agent_run_tools ORDER BY id',
			)
			.all(),
		original,
	);
});

await test('All tools migration: 28 rejects missing or forged historical signed package identity without committing partial provenance', async (t) => {
	for (const variant of ['missing-version', 'wrong-hash', 'undeclared-name'])
		await t.test(variant, async (scope) => {
			const { db, tx } = sqlite(scope);
			db.exec(
				'CREATE TABLE agent_run_tools(id TEXT,user_id INTEGER,tool_name TEXT,tool_version TEXT,operation_hash TEXT); CREATE TABLE agent_plugin_versions(user_id INTEGER,definition_id TEXT,version TEXT,package_hash TEXT,manifest_json TEXT);',
			);
			const hash = 'a'.repeat(64),
				name = pluginToolName('third.party', 'declared');
			db.prepare('INSERT INTO agent_run_tools VALUES(?,1,?,?,?)').run(
				randomUUID(),
				name,
				'third.party@1.0.0#' + hash,
				'b'.repeat(64),
			);
			if (variant !== 'missing-version')
				db.prepare('INSERT INTO agent_plugin_versions VALUES(1,?,?,?,?)').run(
					'third.party',
					'1.0.0',
					variant === 'wrong-hash' ? 'f'.repeat(64) : hash,
					JSON.stringify({
						id: 'third.party',
						version: '1.0.0',
						contributions: { tools: [{ name: variant === 'undeclared-name' ? 'other' : 'declared' }] },
					}),
				);
			const original = db.prepare('SELECT * FROM agent_run_tools').all();
			db.exec('BEGIN');
			await assert.rejects(persistToolIdentities(tx));
			db.exec('ROLLBACK');
			assert.deepEqual(db.prepare('SELECT * FROM agent_run_tools').all(), original);
			assert.ok(
				!db
					.prepare('PRAGMA table_info(agent_run_tools)')
					.all()
					.some((column) => column.name === 'identity_json'),
			);
		});
});

await test('All tools migration: 29 retires old current and pending contracts across user/App references while retaining immutable history and unrelated UI', async (t) => {
	const { db, tx } = sqlite(t);
	// The adapter under test owns the actual conversion; fixture tables preserve all columns it reads and writes.
	db.exec(`CREATE TABLE agent_plugin_versions(user_id INTEGER,definition_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,stage_id TEXT,manifest_json TEXT,PRIMARY KEY(user_id,definition_id,version));
   CREATE TABLE agent_plugin_stages(id TEXT PRIMARY KEY,user_id INTEGER,size_bytes INTEGER,status TEXT,publisher_key_id TEXT,manifest_json TEXT,package_hash TEXT);
   CREATE TABLE agent_plugin_legacy_versions(user_id INTEGER,definition_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,stage_id TEXT,source_user_id INTEGER,size_bytes INTEGER,manifest_json TEXT,PRIMARY KEY(user_id,definition_id,version));
   CREATE TABLE agent_plugin_packages(user_id INTEGER,package_id TEXT,version TEXT,status TEXT,revision INTEGER,updated_at INTEGER,PRIMARY KEY(user_id,package_id));
   CREATE TABLE agent_plugin_package_updates(user_id INTEGER,package_id TEXT,stage_id TEXT,data_migrated INTEGER);
   CREATE TABLE agent_plugin_app_packages(user_id INTEGER,app_id TEXT,package_id TEXT,kind TEXT);
   CREATE TABLE agent_plugin_installations(user_id INTEGER,app_id TEXT,status TEXT,revision INTEGER,updated_at INTEGER);
   CREATE TABLE agent_plugin_retirements(user_id INTEGER,app_id TEXT,stage_id TEXT);
   CREATE TABLE agent_apps(user_id INTEGER,id TEXT,enabled INTEGER);
   CREATE TABLE agent_plugin_data(user_id INTEGER,app_id TEXT,key TEXT,version INTEGER,value_json TEXT);
   CREATE TABLE agent_plugin_extension_data(user_id INTEGER,app_id TEXT,package_id TEXT,key TEXT,version INTEGER,value_json TEXT);
   CREATE TABLE agent_governance_policies(user_id INTEGER,app_id TEXT,execution_overrides_json TEXT);
   CREATE TABLE agent_integrations(user_id INTEGER,app_id TEXT,id TEXT,configuration_json TEXT,encrypted_credential TEXT);
   CREATE TABLE agent_runs(user_id INTEGER,app_id TEXT,id TEXT,status TEXT,output_text TEXT);
   CREATE TABLE agent_plugin_runtime_instances(user_id INTEGER,app_id TEXT,instance_id TEXT,state TEXT,unknown_at INTEGER);
   CREATE TABLE agent_plugin_app_bindings(user_id INTEGER,app_id TEXT,execution_revision INTEGER,ui_revision INTEGER);`);
	const hash = 'c'.repeat(64),
		publisher = 'ed25519:' + 'd'.repeat(64);

	const old = (id) =>
		JSON.stringify({
			schemaVersion: 2,
			id,
			version: '1.0.0',
			displayName: id,
			compatibility: { host: { minVersion: '1.1.0', maxVersion: '1.1.0' }, backendSdk: 2, frontendSdk: null },
			capabilities: ['file.read'],
			intents: [],
			frontendEntry: null,
			backendEntry: 'backend/index.mjs',
			contributions: {
				app: null,
				ui: false,
				skills: [],
				tools: [
					{
						name: 'file_read',
						description: 'Historical signed remote read',
						inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
						capability: 'file.read',
						risk: 'read',
						mutation: false,
						scheduling: 'parallel',
						discovery: 'initial',
						executionProfile: 'remote-files-read',
					},
				],
			},
		});

	const current = (id) =>
		JSON.stringify({
			schemaVersion: 2,
			id,
			version: '1.0.0',
			displayName: id,
			capabilities: ['file.read'],
			contributions: {
				tools: [
					{
						name: 'file_read',
						discovery: { mode: 'initial' },
						childAccess: 'inherit',
						hostOperations: ['remote.readTextPage'],
						executionProfile: 'managed',
					},
				],
			},
		});

	const pureUi = JSON.stringify({
		schemaVersion: 2,
		id: 'test.ui',
		version: '1.0.0',
		displayName: 'UI',
		capabilities: [],
		contributions: { tools: [], ui: true },
	});
	const originals = [];
	const migratedCandidates = [];
	for (const user of [1, 2]) {
		for (const [id, manifest] of [
			['test.old-tools', old('test.old-tools')],
			['test.pending-tools', current('test.pending-tools')],
			['test.ui', pureUi],
		]) {
			const stage = randomUUID();
			db.prepare("INSERT INTO agent_plugin_stages VALUES(?,?,1024,'installed',?,?,?)").run(
				stage,
				user,
				publisher,
				manifest,
				hash,
			);
			db.prepare('INSERT INTO agent_plugin_versions VALUES(?,?,?, ?,?,?,?)').run(
				user,
				id,
				'1.0.0',
				hash,
				publisher,
				stage,
				manifest,
			);
			db.prepare("INSERT INTO agent_plugin_packages VALUES(?,?,?,'installed',3,1)").run(user, id, '1.0.0');
			originals.push({ user, id, manifest, stage });
		}
		const candidate = randomUUID();
		db.prepare("INSERT INTO agent_plugin_stages VALUES(?,?,1024,'verified',?,?,?)").run(
			candidate,
			user,
			publisher,
			old('test.pending-tools'),
			hash,
		);
		db.prepare('INSERT INTO agent_plugin_package_updates VALUES(?,?,?,?)').run(
			user,
			'test.pending-tools',
			candidate,
			user === 1 ? 1 : 0,
		);
		migratedCandidates.push({
			user,
			stage: candidate,
			dataMigrated: user === 1,
			manifest: old('test.pending-tools'),
		});
		for (const [suffix, id] of [
			['first', 'test.old-tools'],
			['second', 'test.old-tools'],
			['pending', 'test.pending-tools'],
			['ui', 'test.ui'],
		]) {
			const app = user + '-' + suffix;
			db.prepare('INSERT INTO agent_apps VALUES(?,?,1)').run(user, app);
			db.prepare("INSERT INTO agent_plugin_installations VALUES(?,?,'installed',5,1)").run(user, app);
			db.prepare("INSERT INTO agent_plugin_app_packages VALUES(?,?,?,'tool')").run(user, app, id);
			db.prepare('INSERT INTO agent_plugin_data VALUES(?,?,?,2,?)').run(user, app, 'kept', '{"kv":true}');
			db.prepare('INSERT INTO agent_plugin_extension_data VALUES(?,?,?,?,3,?)').run(
				user,
				app,
				'test.shared',
				'kept',
				'{"extension":true}',
			);
			db.prepare('INSERT INTO agent_governance_policies VALUES(?,?,?)').run(user, app, '{"maxModelRequests":7}');
			db.prepare('INSERT INTO agent_integrations VALUES(?,?,?,?,?)').run(
				user,
				app,
				randomUUID(),
				'{"kind":"mcp"}',
				'encrypted-history',
			);
			db.prepare('INSERT INTO agent_runs VALUES(?,?,?,?,?)').run(
				user,
				app,
				randomUUID(),
				'completed',
				'retained history',
			);
			db.prepare('INSERT INTO agent_plugin_runtime_instances VALUES(?,?,?,?,1)').run(
				user,
				app,
				randomUUID(),
				'unknown',
			);
			db.prepare('INSERT INTO agent_plugin_app_bindings VALUES(?,?,4,6)').run(user, app);
		}
	}
	const preservedTables = [
		'agent_plugin_data',
		'agent_plugin_extension_data',
		'agent_governance_policies',
		'agent_integrations',
		'agent_runs',
		'agent_plugin_runtime_instances',
		'agent_plugin_app_bindings',
	];
	const preserved = Object.fromEntries(
		preservedTables.map((name) => [name, db.prepare('SELECT * FROM ' + name + ' ORDER BY user_id,app_id').all()]),
	);
	const references = db.prepare('SELECT * FROM agent_plugin_app_packages ORDER BY user_id,app_id').all();
	db.exec('BEGIN');
	await retirePreviousPluginToolContract(tx);
	db.exec('COMMIT');
	for (const row of db.prepare('SELECT * FROM agent_plugin_packages').all()) {
		assert.equal(row.status, row.package_id === 'test.ui' ? 'installed' : 'incompatible');
		assert.equal(row.revision, row.package_id === 'test.ui' ? 3 : 4);
	}
	for (const row of db.prepare('SELECT * FROM agent_plugin_installations').all()) {
		assert.equal(row.status, row.app_id.endsWith('-ui') ? 'installed' : 'removed');
		assert.equal(row.revision, row.app_id.endsWith('-ui') ? 5 : 6);
	}
	for (const row of db.prepare('SELECT * FROM agent_apps').all())
		assert.equal(row.enabled, Number(row.id.endsWith('-ui')));
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_plugin_package_updates').get().n, 1);
	for (const candidate of migratedCandidates) {
		const pending = db
			.prepare('SELECT * FROM agent_plugin_package_updates WHERE user_id=? AND package_id=?')
			.get(candidate.user, 'test.pending-tools');
		if (candidate.dataMigrated) {
			assert.equal(pending.stage_id, candidate.stage);
			assert.equal(pending.data_migrated, 1);
		} else assert.equal(pending, undefined);
		const stage = db.prepare('SELECT * FROM agent_plugin_stages WHERE id=?').get(candidate.stage);
		assert.equal(stage.status, 'failed');
		assert.equal(
			stage.manifest_json,
			candidate.dataMigrated ? candidate.manifest : null,
			'only data-migrated candidate keeps raw historical proof',
		);
		assert.equal(stage.publisher_key_id, candidate.dataMigrated ? publisher : null);
	}
	for (const original of originals) {
		const version = db
			.prepare('SELECT * FROM agent_plugin_versions WHERE user_id=? AND definition_id=?')
			.get(original.user, original.id);
		assert.equal(version.package_hash, hash);
		assert.equal(version.publisher_key_id, publisher);
		assert.equal(version.version, '1.0.0');
		const stage = db.prepare('SELECT * FROM agent_plugin_stages WHERE id=?').get(original.stage);
		assert.equal(stage.package_hash, hash);
		if (original.id === 'test.old-tools') {
			const archive = db
				.prepare('SELECT * FROM agent_plugin_legacy_versions WHERE user_id=? AND definition_id=?')
				.get(original.user, original.id);
			assert.equal(archive.manifest_json, original.manifest);
			assert.equal(
				createHash('sha256').update(archive.manifest_json).digest('hex'),
				createHash('sha256').update(original.manifest).digest('hex'),
			);
			assert.equal(JSON.parse(version.manifest_json).format, 'legacy-archive');
			assert.throws(() => snapshotPluginVersion(version), 'current snapshots reject archived manifests');
			assert.equal(stage.status, 'failed');
			assert.equal(stage.manifest_json, null);
			assert.equal(stage.publisher_key_id, null);
		} else assert.equal(version.manifest_json, original.manifest);
	}
	for (const name of preservedTables)
		assert.deepEqual(
			db.prepare('SELECT * FROM ' + name + ' ORDER BY user_id,app_id').all(),
			preserved[name],
			name + ' survives contract retirement unchanged',
		);
	assert.deepEqual(db.prepare('SELECT * FROM agent_plugin_app_packages ORDER BY user_id,app_id').all(), references);
});
