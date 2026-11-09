import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { currentOperation } from '../../../../../packages/backend/dist/modules/agent/operations/adapters/sqlite/current-operation-sql.js';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, until } from '../../../../support/protocols/openssh-fixture.mjs';
import { findFixtureTool } from '../../../../support/package-tool-catalog.mjs';

await test(
	'Readonly tool participant: SDK4 Child effects retain exact live dispatch authority',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(
			join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'readonly-authority-'),
		);
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd, {
			signal: t.signal,
			discover: 'collaboration_delegate file_read file_list',
			plugin: { selectedRootIds: ['nexus.tools.remote', 'nexus.tools.agent'], uiPackageId: null },
		});
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
