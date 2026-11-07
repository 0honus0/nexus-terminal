import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { initializeRunTools } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-schema.js';
import { persistToolRequiredCapabilities } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-capabilities-migration.js';
import { persistToolOutputArtifacts } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-artifacts-migration.js';
import { persistToolIdentities } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-identity-migration.js';
import { generalizeToolChildren } from '../../../packages/backend/dist/modules/agent/runs/adapters/sqlite/run-tool-children-migration.js';
import { validateSnapshotToolChildren } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-tool-children.js';
import { SnapshotFailure } from '../../../packages/backend/dist/platform/storage/sqlite/snapshot-types.js';
import { pluginToolName } from '../../../packages/backend/dist/modules/agent/plugins/plugin-tool-authority-rules.js';
import { snapshotLegacyManifest } from '../../../packages/backend/dist/modules/agent/snapshots/adapters/sqlite/snapshot-legacy-package.js';
import { pluginManifest } from '../../../packages/backend/dist/modules/agent/plugins/adapters/package/plugin-manifest.js';
import { currentOperation } from '../../../packages/backend/dist/modules/agent/operations/adapters/sqlite/current-operation-sql.js';
import { openAgentExecution } from '../http/agent-execution-fixture.mjs';
import { openSshd, until } from '../remote/openssh-fixture.mjs';
import { findFixtureTool } from '../../support/package-tool-catalog.mjs';

await test(
	'Readonly tool participant: SDK4 Child effects retain exact live dispatch authority',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'readonly-authority-'),
		);
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd, { discover: 'collaboration_delegate file_read file_list' });
		t.after(() => f.close());
		await f.grants(['context.read', 'file.read', 'app.intents.exchange']);
		const path = join(directory, 'readonly.txt');
		await writeFile(path, 'Actual readonly Child output');
		const objective = f.program('Readonly child authority', (results, body) => {
			for (const name of ['file_write', 'collaboration_delegate']) {
				assert.equal(findFixtureTool(body, name), undefined, 'Child cannot acquire ' + name);
			}
			assert.ok(
				body.tools.every((tool) => !['remote.readTextPage', 'remote.listPage'].includes(tool.function.name)),
			);
			if (!results.length) return { name: 'file_read', input: { connectionId: f.connectionId, paths: [path] } };
			if (results.length === 1) {
				assert.ok(JSON.stringify(results[0]).includes('Actual readonly Child output'));
				return { name: 'file_list', input: { connectionId: f.connectionId, paths: [directory] } };
			}
			assert.ok(JSON.stringify(results[1]).includes('readonly.txt'));
			return { hold: true };
		});
		const root = await f.start('Retain readonly child while auditing current authority', (results) =>
			results.length
				? { hold: true }
				: {
						name: 'collaboration_delegate',
						input: {
							profile: 'explore',
							objective,
							targets: [String(f.connectionId)],
							dependencyMode: 'success',
						},
					},
		);
		await f.approve(await f.approval(root, 'collaboration_delegate'));
		await until(
			() => f.heldModelCount,
			(count) => count === 2,
			'Root and Child remain active after readonly effects',
		);
		const db = new DatabaseSync(f.database);
		try {
			const child = db.prepare('SELECT run_id FROM agent_run_children WHERE parent_id=?').get(root.id);
			assert.ok(child);
			const tx = { one: async (sql, values) => db.prepare(sql).get(...values) ?? null };
			for (const label of ['remote.readTextPage', 'remote.listPage']) {
				const effect = db
					.prepare('SELECT * FROM agent_operations WHERE run_id=? AND label=?')
					.get(child.run_id, label);
				assert.ok(effect, label);
				assert.equal(effect.state, 'completed');
				const identity = {
					userId: effect.user_id,
					appId: effect.app_id,
					runId: effect.run_id,
					operationId: effect.id,
					operationHash: effect.request_hash,
				};
				const options = { labels: [label], allowCompleted: true };
				const original = await currentOperation(tx, identity, options);
				assert.ok(original);
				const proof = original.authority;
				assert.equal(proof.instance.packageId, 'nexus.tools.remote');
				assert.equal(proof.target.id, f.connectionId);
				const binding = JSON.parse(effect.binding_json);
				assert.equal(binding.kind, 'native');
				assert.equal(binding.capability, 'file.read');
				assert.equal(binding.mutation, false);
				assert.equal(binding.target.id, f.connectionId);
				const parent = db.prepare('SELECT * FROM agent_operations WHERE id=?').get(effect.parent_id);
				assert.ok(parent.label.startsWith('nexus.tools.remote.file_'));
				assert.equal(JSON.parse(parent.binding_json).binding.instanceId, proof.instance.id);
				for (const wrong of [
					{ ...identity, runId: root.id },
					{ ...identity, operationHash: '0'.repeat(64) },
					{ ...identity, appId: randomUUID() },
				]) {
					assert.equal(
						await currentOperation(tx, wrong, options),
						null,
						'Identity cannot borrow another source',
					);
				}
				assert.equal(await currentOperation(tx, identity, { ...options, labels: ['remote.write'] }), null);
				for (const [name, sql, values] of [
					[
						'revoked policy',
						'UPDATE agent_governance_policies SET policy_revision=policy_revision+1 WHERE app_id=?',
						[f.appId],
					],
					['changed target', 'UPDATE connections SET version=version+1 WHERE id=?', [f.connectionId]],
					['disabled App', 'UPDATE agent_apps SET enabled=0 WHERE id=?', [f.appId]],
					[
						'closed execution',
						"UPDATE agent_run_executions SET state='closed' WHERE run_id=?",
						[child.run_id],
					],
					[
						'failed parent',
						"UPDATE agent_operations SET state='failed',result_json=NULL,failure_code='forbidden' WHERE id=?",
						[parent.id],
					],
					[
						'parent from another Run',
						'UPDATE agent_operations SET parent_id=? WHERE id=?',
						[
							db
								.prepare('SELECT id FROM agent_operations WHERE run_id=? ORDER BY sequence LIMIT 1')
								.get(root.id).id,
							effect.id,
						],
					],
					[
						'disabled logical instance',
						'UPDATE agent_plugin_instances SET enabled=0 WHERE id=? AND app_id=?',
						[proof.instance.id, f.appId],
					],
					[
						'retired runtime',
						"UPDATE agent_plugin_runtime_instances SET state='closed' WHERE logical_instance_id=? AND app_id=?",
						[proof.instance.id, f.appId],
					],
					[
						'changed instance configuration',
						'UPDATE agent_plugin_instances SET configuration_revision=configuration_revision+1 WHERE id=? AND app_id=?',
						[proof.instance.id, f.appId],
					],
					[
						'changed package identity',
						'UPDATE agent_plugin_packages SET package_hash=? WHERE package_id=?',
						['e'.repeat(64), proof.instance.packageId],
					],
					[
						'revoked publisher',
						'UPDATE agent_plugin_publishers SET revoked_at=1 WHERE key_id=(SELECT publisher_key_id FROM agent_plugin_packages WHERE package_id=?)',
						[proof.instance.packageId],
					],
				]) {
					db.exec('SAVEPOINT readonly_variant');
					try {
						assert.equal(db.prepare(sql).run(...values).changes, 1, name);
						assert.equal(await currentOperation(tx, identity, options), null, name);
					} finally {
						db.exec('ROLLBACK TO readonly_variant');
						db.exec('RELEASE readonly_variant');
					}
				}
				assert.ok(
					await currentOperation(tx, identity, options),
					'Every denial preserves the original authority',
				);
			}
		} finally {
			db.close();
			f.finishModels();
		}
		await f.wait(root, 'completed');
	},
);

await test('Readonly tool participant: retired SDK3 relations remain inert immutable audit evidence', async (t) => {
	const manifest = {
		schemaVersion: 3,
		id: 'fixture.retired-tools',
		version: '1.0.0',
		displayName: 'Retired readonly tools',
		compatibility: { host: { minVersion: '1.1.0', maxVersion: '1.1.0' }, backendSdk: 3, frontendSdk: null },
		capabilities: ['plugin.invoke', 'file.read'],
		intents: [],
		frontendEntry: null,
		backendEntry: 'backend/index.mjs',
		contributions: {
			app: null,
			tools: ['file_read', 'file_list'].map((name) => ({
				name,
				description: 'Archived readonly primitive',
				inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
				executionProfile: 'managed',
				discovery: { mode: 'initial', loader: false, keywords: [] },
				childAccess: 'inherit',
				hostOperations: [name === 'file_read' ? 'remote.readTextPage' : 'remote.listPage'],
			})),
			ui: false,
			skills: [],
		},
	};
	const archive = snapshotLegacyManifest(manifest);
	assert.throws(() => pluginManifest(manifest), 'Archived bytes never become an executable SDK4 package');
	const packageId = manifest.id,
		hash = 'a'.repeat(64),
		publisher = 'ed25519:' + 'b'.repeat(64);
	const appId = randomUUID(),
		rootId = randomUUID(),
		runId = randomUUID(),
		instanceId = randomUUID();
	const parentId = randomUUID(),
		operationId = randomUUID(),
		parentHash = 'c'.repeat(64);
	const parentName = pluginToolName(packageId, 'file_read');
	const db = new DatabaseSync(':memory:');
	t.after(() => db.close());
	// Use production tool DDL and relation migration. Only unrelated owners are reduced to the fields read by production authorization SQL.
	db.exec(`PRAGMA foreign_keys=ON;
	 CREATE TABLE agent_governance_approvals(id TEXT,user_id INTEGER,tool_call_id TEXT,inspection_json TEXT);
	 CREATE TABLE agent_apps(id TEXT,user_id INTEGER,enabled INTEGER,PRIMARY KEY(id,user_id));
	 CREATE TABLE agent_runs(id TEXT,user_id INTEGER,app_id TEXT,version INTEGER,run_kind TEXT,status TEXT,created_at INTEGER,deadline_at INTEGER,PRIMARY KEY(id,user_id,app_id));
	 CREATE TABLE agent_run_children(run_id TEXT,parent_id TEXT,profile TEXT,output_text TEXT,tools_json TEXT,max_requests INTEGER,dependencies_json TEXT,dependency_mode TEXT);
	 CREATE TABLE agent_run_model_steps(run_id TEXT,step_index INTEGER,PRIMARY KEY(run_id,step_index));
	 CREATE TABLE agent_run_frozen_inputs(run_id TEXT,app_execution_json TEXT);
	 CREATE TABLE agent_plugin_installations(user_id INTEGER,app_id TEXT,status TEXT,definition_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT);
	 CREATE TABLE agent_plugin_app_bindings(user_id INTEGER,app_id TEXT,execution_revision INTEGER,ui_revision INTEGER);
	 CREATE TABLE agent_plugin_app_packages(user_id INTEGER,app_id TEXT,package_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,kind TEXT);
	 CREATE TABLE agent_plugin_packages(user_id INTEGER,package_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,status TEXT);
	 CREATE TABLE agent_plugin_versions(user_id INTEGER,definition_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,manifest_json TEXT);
	 CREATE TABLE agent_plugin_legacy_versions(user_id INTEGER,definition_id TEXT,version TEXT,package_hash TEXT,publisher_key_id TEXT,manifest_json TEXT);
	 CREATE TABLE agent_plugin_publishers(user_id INTEGER,key_id TEXT,revoked_at INTEGER);
	 CREATE TABLE agent_plugin_runtime_instances(user_id INTEGER,app_id TEXT,package_id TEXT,instance_id TEXT,revision INTEGER,state TEXT);`);
	const tx = {
		exec: async (sql) => {
			db.exec(sql);
		},

		one: async (sql, parameters = []) => db.prepare(sql).get(...parameters) ?? null,

		all: async (sql, parameters = []) => db.prepare(sql).all(...parameters),

		run: async (sql, parameters = []) => db.prepare(sql).run(...parameters),
	};
	await initializeRunTools(tx);
	await generalizeToolChildren(tx);
	await persistToolRequiredCapabilities(tx);
	await persistToolOutputArtifacts(tx);
	await persistToolIdentities(tx);
	assert.equal(manifest.contributions.tools.find((tool) => tool.name === 'file_read').executionProfile, 'managed');
	db.prepare('INSERT INTO agent_apps VALUES(?,1,1)').run(appId);
	for (const [id, kind] of [
		[rootId, 'root'],
		[runId, 'child'],
	]) {
		db.prepare("INSERT INTO agent_runs VALUES(?,1,?,1,?,'running',1,999999)").run(id, appId, kind);
		db.prepare('INSERT INTO agent_run_model_steps VALUES(?,1)').run(id);
	}
	db.prepare("INSERT INTO agent_run_children VALUES(?,?,'explore',NULL,?,10,'[]','success')").run(
		runId,
		rootId,
		JSON.stringify([parentName]),
	);
	db.prepare("INSERT INTO agent_plugin_installations(user_id,app_id,status) VALUES(1,?,'installed')").run(appId);
	db.prepare('INSERT INTO agent_plugin_app_bindings VALUES(1,?,1,1)').run(appId);
	db.prepare("INSERT INTO agent_plugin_app_packages VALUES(1,?,?,?,?,?,'tool')").run(
		appId,
		packageId,
		manifest.version,
		hash,
		publisher,
	);
	db.prepare("INSERT INTO agent_plugin_packages VALUES(1,?,?,?,?,'installed')").run(
		packageId,
		manifest.version,
		hash,
		publisher,
	);
	db.prepare('INSERT INTO agent_plugin_versions VALUES(1,?,?,?,?,?)').run(
		packageId,
		manifest.version,
		hash,
		publisher,
		JSON.stringify(archive.summary),
	);
	db.prepare('INSERT INTO agent_plugin_legacy_versions VALUES(1,?,?,?,?,?)').run(
		packageId,
		manifest.version,
		hash,
		publisher,
		JSON.stringify(manifest),
	);
	db.prepare('INSERT INTO agent_plugin_publishers VALUES(1,?,NULL)').run(publisher);

	db.prepare("INSERT INTO agent_plugin_runtime_instances VALUES(1,?,?,?,1,'active')").run(
		appId,
		packageId,
		instanceId,
	);
	for (const [id, name, version, state, call, operationHash] of [
		[
			parentId,
			parentName,
			packageId + '@' + manifest.version + '#' + hash,
			'dispatched',
			'parent-call',
			parentHash,
		],
		[operationId, 'remote.readTextPage', '1', 'inspected', 'sdk:read', 'd'.repeat(64)],
	]) {
		db.prepare(
			`INSERT INTO agent_run_tools(id,user_id,app_id,run_id,model_step_index,provider_call_id,tool_name,tool_version,capability,target_id,target_version,risk,mutation,summary,arguments_json,operation_hash,operation_revision,revision,state,created_at,updated_at)
		 VALUES(?,1,?, ?,1,?,?,?,'file.read',11,3,'read',0,'readonly fixture','{}',?,1,1,?,1,1)`,
		).run(id, appId, runId, call, name, version, operationHash, state);
	}

	const parentIdentity = (name) => ({
		kind: 'plugin',
		packageId,
		packageVersion: manifest.version,
		packageSha256: hash,
		name,
	});

	db.prepare(
		"UPDATE agent_run_tools SET capability='plugin.invoke',target_id=NULL,target_version=NULL,identity_json=? WHERE id=?",
	).run(JSON.stringify(parentIdentity('file_read')), parentId);
	db.prepare('UPDATE agent_run_tools SET identity_json=?,arguments_json=? WHERE id=?').run(
		JSON.stringify({ kind: 'host', operation: 'remote.readTextPage' }),
		JSON.stringify({
			operation: 'remote.readTextPage',
			connectionId: 11,
			path: '/fixture.txt',
			offset: 0,
			maxBytes: 1024,
		}),
		operationId,
	);

	const selectOperation = (name) => {
		const localName = name === 'remote.readTextPage' ? 'file_read' : 'file_list';
		const wireName = pluginToolName(packageId, localName);
		db.prepare('UPDATE agent_run_tools SET tool_name=?,identity_json=? WHERE id=?').run(
			wireName,
			JSON.stringify(parentIdentity(localName)),
			parentId,
		);
		db.prepare('UPDATE agent_run_children SET tools_json=?').run(JSON.stringify([wireName]));
		db.prepare('UPDATE agent_run_tools SET tool_name=?,identity_json=?,arguments_json=? WHERE id=?').run(
			name,
			JSON.stringify({ kind: 'host', operation: name }),
			JSON.stringify(
				name === 'remote.readTextPage'
					? { operation: name, connectionId: 11, path: '/fixture.txt', offset: 0, maxBytes: 1024 }
					: { operation: name, connectionId: 11, path: '/', after: '' },
			),
			operationId,
		);
	};

	db.prepare("INSERT INTO agent_tool_children VALUES(?,?,?,'sdk:read','plugin_tool',?,1,?,1)").run(
		operationId,
		parentId,
		parentHash,
		packageId,
		instanceId,
	);

	const variants = [
		[
			'forged Host identity',
			() =>
				db
					.prepare('UPDATE agent_run_tools SET identity_json=? WHERE id=?')
					.run(JSON.stringify({ kind: 'host', operation: 'remote.listPage' }), operationId),
			false,
			false,
		],
		[
			'wrong Host version',
			() => db.prepare("UPDATE agent_run_tools SET tool_version='2' WHERE id=?").run(operationId),
			false,
			false,
		],
		[
			'missing target binding',
			() => db.prepare('UPDATE agent_run_tools SET target_id=NULL,target_version=NULL').run(),
			false,
			false,
		],
		[
			'forged parent name',
			() =>
				db
					.prepare('UPDATE agent_run_tools SET tool_name=? WHERE id=?')
					.run(pluginToolName(packageId, 'undeclared'), parentId),
			false,
			false,
		],
		[
			'forged parent version',
			() =>
				db
					.prepare('UPDATE agent_run_tools SET tool_version=? WHERE id=?')
					.run(packageId + '@' + manifest.version + '#' + 'f'.repeat(64), parentId),
			false,
			false,
		],
		[
			'forged parent hash',
			() => db.prepare('UPDATE agent_tool_children SET parent_hash=?').run('f'.repeat(64)),
			false,
			false,
		],
		['no relation', () => db.prepare('DELETE FROM agent_tool_children').run(), false, false],
	];
	// Snapshot provenance remains valid after completed parents and ordinary runtime retention.
	db.prepare("UPDATE agent_run_tools SET state='completed',result_text='{}'").run();
	db.prepare('DELETE FROM agent_plugin_runtime_instances').run();

	const snapshot = () =>
		new Map(
			[
				'agent_run_tools',
				'agent_tool_children',
				'agent_plugin_versions',
				'agent_plugin_legacy_versions',
				'agent_plugin_runtime_instances',
			].map((table) => [table, db.prepare('SELECT * FROM ' + table).all()]),
		);

	for (const name of ['remote.readTextPage', 'remote.listPage']) {
		selectOperation(name);
		assert.doesNotThrow(
			() => validateSnapshotToolChildren(snapshot()),
			'historical readonly primitive retains immutable provenance: ' + name,
		);
	}
	selectOperation('remote.readTextPage');
	for (const [name, mutate] of variants) {
		db.exec('SAVEPOINT snapshot_variant');
		try {
			mutate();
			assert.throws(() => validateSnapshotToolChildren(snapshot()), SnapshotFailure, 'snapshot rejects ' + name);
		} finally {
			db.exec('ROLLBACK TO snapshot_variant');
			db.exec('RELEASE snapshot_variant');
		}
	}
	assert.doesNotThrow(() => validateSnapshotToolChildren(snapshot()));
});
