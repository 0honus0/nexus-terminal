import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openAgentExecution } from '../../runs/support/agent-execution-fixture.mjs';
import { openSshd, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import { PluginInstanceModel } from '../../../../../packages/backend/dist/modules/agent/plugins/model/plugin-instance-model.js';
import { SqlitePluginInstanceStorage } from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/sqlite/plugin-instance-sql.js';
import { AgentFailure } from '../../../../../packages/backend/dist/modules/agent/agent-failure.js';
import { SqliteFailure } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-errors.js';

function gate() {
	let resolve;
	const promise = new Promise((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const refused = (code) => (error) => error instanceof AgentFailure && error.code === code;

async function configurationFixture(t) {
	const directory = await mkdtemp(
		join(process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir(), 'nexus-plugin-config-races-'),
	);
	const sshd = await openSshd(directory);
	t.after(() => sshd.close());
	const f = await openAgentExecution(directory, sshd);
	t.after(() => f.close());
	let storage;
	let principal;
	const read = SqlitePluginInstanceStorage.prototype.read;
	const capture = t.mock.method(SqlitePluginInstanceStorage.prototype, 'read', function (...args) {
		storage = this;
		principal = args[0];
		return read.apply(this, args);
	});
	const path = '/api/v1/agent/plugins/apps/' + f.appId + '/instances/' + f.appId + '/configuration';
	const source = expectStatus(await f.api('GET', path), 200);
	capture.mock.restore();
	assert.ok(storage && principal.kind === 'manual');
	const model = new PluginInstanceModel(storage, { digest: () => principal.digest });
	const caller = { kind: 'manual', actor: { userId: principal.userId, token: 'fixture-owned-session' } };

	const command = (instructions = 'Original exact intent') => ({
		operationKey: randomUUID(),
		expectedPackageRevision: source.packageRevision,
		expectedRevision: source.configuration.revision,
		schemaRevision: source.settings.schemaRevision,
		documentJson: JSON.stringify({ instructions, compactionMode: 'balanced' }),
	});

	return { f, model, storage, caller, source, command, appId: f.appId };
}

await test(
	'Integration races: configuration rechecks the original session after a real SQLite queue',
	{ timeout: 60000 },
	async (t) => {
		const f = await configurationFixture(t);
		const locked = gate();
		const release = gate();
		t.after(() => release.resolve());
		const before = await f.storage.db.one('SELECT COUNT(*) AS count FROM agent_plugin_configuration_mutations');
		const blocker = f.storage.db.transaction(async (tx) => {
			locked.resolve();
			await release.promise;
			await tx.run('UPDATE access_sessions SET expires_at=0 WHERE user_id=?', [f.caller.actor.userId]);
		});
		await locked.promise;
		const task = f.model.write(f.caller, f.appId, f.appId, f.command());
		const rejected = assert.rejects(task, refused('unauthenticated'));
		await tick();
		release.resolve();
		await blocker;
		await rejected;
		const current = await f.storage.db.one('SELECT configuration_revision FROM agent_plugin_instances WHERE id=?', [
			f.appId,
		]);
		assert.equal(current.configuration_revision, f.source.configuration.revision);
		const after = await f.storage.db.one('SELECT COUNT(*) AS count FROM agent_plugin_configuration_mutations');
		assert.equal(after.count, before.count, 'A queued unauthorized write publishes no intent receipt or settings');
	},
);

await test(
	'Integration races: unknown configuration commit recovers the original durable intent without repeating the mutation',
	{ timeout: 60000 },
	async (t) => {
		const f = await configurationFixture(t);
		const command = f.command();
		const original = f.storage.write.bind(f.storage);
		const failure = new SqliteFailure('commit_unknown');
		let committed;
		const injected = t.mock.method(f.storage, 'write', async (...args) => {
			committed = await original(...args);
			throw failure;
		});
		await assert.rejects(
			f.model.write(f.caller, f.appId, f.appId, command),
			(error) => refused('operation_unknown')(error) && error.cause === failure,
		);
		injected.mock.restore();
		const recovered = await f.model.write(f.caller, f.appId, f.appId, command);
		assert.equal(recovered.configuration.revision, committed.configuration.revision);
		assert.equal(recovered.configuration.documentJson, command.documentJson);
		await assert.rejects(
			f.model.write(f.caller, f.appId, f.appId, {
				...command,
				documentJson: JSON.stringify({ instructions: 'Different intent', compactionMode: 'balanced' }),
			}),
			refused('idempotency_conflict'),
		);
		const current = await f.model.read(f.caller, f.appId, f.appId);
		assert.equal(current.configuration.revision, f.source.configuration.revision + 1);
		const count = await f.storage.db.one(
			'SELECT COUNT(*) AS count FROM agent_plugin_configuration_mutations WHERE operation_key=?',
			[command.operationKey],
		);
		assert.equal(count.count, 1);
	},
);

await test(
	'Integration races: independent configuration CAS commits once, exact receipts survive disabling and restart',
	{ timeout: 60000 },
	async (t) => {
		const f = await configurationFixture(t);
		const commands = [f.command('First competing intent'), f.command('Second competing intent')];
		const results = await Promise.allSettled(
			commands.map((command) => f.model.write(f.caller, f.appId, f.appId, command)),
		);
		assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
		assert.equal(
			results.filter((result) => result.status === 'rejected' && refused('version_conflict')(result.reason))
				.length,
			1,
		);
		const index = results.findIndex((result) => result.status === 'fulfilled');
		const original = results[index].value;
		const base = '/api/v1/agent/apps/' + f.appId;
		const app = expectStatus(await f.f.api('GET', base), 200);
		expectStatus(await f.f.api('PATCH', base, { expectedVersion: app.version, enabled: false }), 200);
		await f.f.restart();
		const path = '/api/v1/agent/plugins/apps/' + f.appId + '/instances/' + f.appId + '/configuration';
		const replay = expectStatus(await f.f.api('PUT', path, commands[index]), 200);
		assert.equal(replay.configuration.revision, original.configuration.revision);
		assert.equal(replay.configuration.documentJson, original.configuration.documentJson);
		assert.equal(
			expectStatus(await f.f.api('GET', path), 200).configuration.documentJson,
			original.configuration.documentJson,
		);
	},
);
