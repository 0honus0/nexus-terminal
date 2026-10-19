import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openPlugins } from './plugin-management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';
import { processIdentity } from '../../../packages/backend/dist/platform/isolation/adapters/module-recovery.js';
import { ModuleRuntimeFailure } from '../../../packages/backend/dist/platform/isolation/module-runtime.js';

const base = '/api/v1/agent/plugins/installations/';

async function children(f) {
	const root = f.database + '.modules';
	return Promise.all(
		(await readdir(root)).map(async (name) => {
			const journal = JSON.parse(await readFile(join(root, name, '.nexus-process.json'), 'utf8'));
			assert.equal(journal.parent.pid, process.pid);
			assert.deepEqual(await processIdentity(journal.child.pid), journal.child);
			assert.ok(
				(await readFile('/proc/' + journal.child.pid + '/cmdline', 'utf8'))
					.split('\0')
					.includes(join(root, name, '.nexus-runtime.mjs')),
			);
			return journal.child;
		}),
	);
}

function failures(error) {
	const found = new Set();
	const pending = [error];
	for (const value of pending) {
		if (found.has(value)) continue;
		found.add(value);
		if (value instanceof AggregateError) pending.push(...value.errors);
		if (value instanceof Error && value.cause) pending.push(value.cause);
	}
	return [...found];
}

async function restartFailed(f, minimum) {
	await f.restart((close) =>
		assert.rejects(close, (error) => {
			assert.ok(error instanceof AggregateError);
			assert.ok(
				failures(error).filter(
					(value) =>
						value instanceof ModuleRuntimeFailure &&
						value.kind === 'execution_unknown' &&
						value.cause === undefined,
				).length >= minimum,
			);
			return true;
		}),
	);
}

await test(
	'B10 publisher revocation preserves independent child failures and drains healthy siblings',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const db = new DatabaseSync(f.database, { readOnly: true });
		t.after(() => db.close());
		const plugins = [];
		for (const [name, backend] of [
			['quiesce-failure', 'export function quiesce() { throw new Error("private-quiesce-sentinel"); }'],
			['dispose-failure', 'export function dispose() { throw new Error("private-dispose-sentinel"); }'],
			['healthy-sibling', 'export function health() { return true; }'],
		])
			plugins.push(await f.install(name, { backend }));
		const original = await children(f);
		assert.equal(original.length, 3);

		const current = (plugin) =>
			db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);

		let unknown;
		await t.test('revocation commits before failed retirement and exposes only a safe unknown code', async () => {
			const result = await f.api('DELETE', '/api/v1/agent/plugins/publishers/' + f.publisher.keyId, {
				expectedVersion: f.publisher.version,
			});
			assert.deepEqual(expectStatus(result, 503), { code: 'operation_unknown' });
			assert.notEqual(
				db.prepare('SELECT revoked_at FROM agent_plugin_publishers WHERE key_id=?').get(f.publisher.keyId)
					.revoked_at,
				null,
			);
			assert.equal(current(plugins[0]).state, 'unknown');
			assert.equal(current(plugins[1]).state, 'unknown');
			assert.equal(current(plugins[2]).state, 'closed');
			unknown = plugins.slice(0, 2).map(current);
		});
		await t.test(
			'one failed lifecycle never skips other original children or materialized directory cleanup',
			async () => {
				for (const child of original) assert.equal(await processIdentity(child.pid), null);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			},
		);
		await t.test(
			'shutdown keeps both independent technical failures and restart preserves original unknown evidence',
			async () => {
				await restartFailed(f, 2);
				assert.deepEqual(plugins.slice(0, 2).map(current), unknown);
				assert.equal(current(plugins[2]).state, 'closed');
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			},
		);
		await t.test(
			'revoked publisher stays revoked and neither content nor a new runtime is silently restored',
			async () => {
				for (const plugin of plugins)
					expectStatus(await f.api('GET', base + plugin.appId + '/data/never-written'), 403);
				const publisher = expectStatus(await f.api('GET', '/api/v1/agent/plugins/publishers'), 200).items.find(
					(value) => value.keyId === f.publisher.keyId,
				);
				assert.notEqual(publisher.revokedAt, null);
				assert.deepEqual(plugins.slice(0, 2).map(current), unknown);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			},
		);
		await t.test('repeated revocation respects retained fences without disabling management recovery', async () => {
			const publisher = expectStatus(await f.api('GET', '/api/v1/agent/plugins/publishers'), 200).items.find(
				(value) => value.keyId === f.publisher.keyId,
			);
			assert.deepEqual(
				expectStatus(
					await f.api('DELETE', '/api/v1/agent/plugins/publishers/' + f.publisher.keyId, {
						expectedVersion: publisher.version,
					}),
					503,
				),
				{ code: 'operation_unknown' },
			);
			expectStatus(await f.api('GET', '/api/v1/agent/plugins/publishers'), 200);
			assert.deepEqual(plugins.slice(0, 2).map(current), unknown);
			const item = unknown[0];
			const acknowledged = expectStatus(
				await f.api('POST', base + plugins[0].appId + '/runtime/acknowledge', {
					expectedRevision: plugins[0].installation.revision,
					instanceId: item.instance_id,
					instanceRevision: item.revision,
					confirmed: true,
				}),
				200,
			);
			assert.equal(acknowledged.state, 'closed');
			assert.equal(acknowledged.unknownAt, item.unknown_at);
			assert.deepEqual(await readdir(f.database + '.modules'), []);
		});
	},
);

await test(
	'B10 failed uninstall retains draining and unknown until explicit original-instance recovery',
	{ timeout: 60000 },
	async (t) => {
		const f = await openPlugins(t);
		const db = new DatabaseSync(f.database, { readOnly: true });
		t.after(() => db.close());
		const plugin = await f.install('failed-uninstall', {
			backend: 'export function dispose() { throw new Error("private-remove-sentinel"); }',
		});
		const path = base + plugin.appId;
		const original = expectStatus(await f.api('GET', path + '/runtime'), 200);
		const identities = await children(f);

		const current = () =>
			db.prepare('SELECT * FROM agent_plugin_runtime_instances WHERE app_id=?').get(plugin.appId);

		const installation = () =>
			db.prepare('SELECT * FROM agent_plugin_installations WHERE app_id=?').get(plugin.appId);

		let unknown;
		await t.test('failed disposal does not publish removed or undo already committed draining', async () => {
			assert.deepEqual(
				expectStatus(await f.api('DELETE', path, { expectedRevision: plugin.installation.revision }), 503),
				{ code: 'operation_unknown' },
			);
			assert.equal(installation().status, 'draining');
			assert.equal(current().state, 'unknown');
			assert.equal(current().instance_id, original.instanceId);
			assert.notEqual(current().unknown_at, null);
			assert.equal(current().acknowledged_at, null);
			unknown = current();
			for (const child of identities) assert.equal(await processIdentity(child.pid), null);
			assert.deepEqual(await readdir(f.database + '.modules'), []);
		});
		await t.test(
			'failed shutdown and new bootstrap retain draining without automatically replaying removal',
			async () => {
				await restartFailed(f, 1);
				assert.equal(installation().status, 'draining');
				assert.deepEqual(current(), unknown);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			},
		);
		await t.test('another remove attempt cannot bypass the original unknown fence', async () => {
			assert.deepEqual(
				expectStatus(await f.api('DELETE', path, { expectedRevision: installation().revision }), 503),
				{ code: 'operation_unknown' },
			);
			assert.equal(installation().status, 'draining');
			assert.deepEqual(current(), unknown);
		});
		await t.test(
			'explicit matching acknowledgement permits a new remove request without rewriting unknown history',
			async () => {
				const input = {
					expectedRevision: installation().revision,
					instanceId: original.instanceId,
					instanceRevision: original.revision,
					confirmed: true,
				};
				const acknowledged = expectStatus(await f.api('POST', path + '/runtime/acknowledge', input), 200);
				assert.equal(acknowledged.state, 'closed');
				assert.equal(acknowledged.unknownAt, unknown.unknown_at);
				assert.notEqual(acknowledged.acknowledgedAt, null);
				const removed = expectStatus(
					await f.api('DELETE', path, { expectedRevision: installation().revision }),
					200,
				);
				assert.equal(removed.status, 'removed');
				assert.equal(current().instance_id, original.instanceId);
				assert.equal(current().unknown_at, unknown.unknown_at);
				assert.equal(current().acknowledged_at, acknowledged.acknowledgedAt);
				assert.deepEqual(await readdir(f.database + '.modules'), []);
			},
		);
	},
);
