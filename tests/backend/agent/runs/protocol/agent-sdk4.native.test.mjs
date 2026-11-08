import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { createTestAgentApp } from '../support/native-agent-fixture.mjs';
import { openAgentExecution } from '../support/agent-execution-fixture.mjs';
import { openSshd, until, expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readAgentThreadToolsResponse,
	readAgentToolCallDetails,
} from '../../../../../packages/shared/dist/agent/tools/http-codec.js';
import { InvalidAgentPayload } from '../../../../../packages/shared/dist/agent/http-codec.js';

const artifactRoot = process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir();

await test('SDK4 App executes without Provider and replays the same create intent', { timeout: 60000 }, async (t) => {
	const directory = await mkdtemp(join(artifactRoot, 'deterministic-'));
	const f = await openManagement(directory);
	t.after(() => f.close());
	const app = await createTestAgentApp(f.api, directory, 'Deterministic App', {
		deterministic: true,
		selectedRootIds: [],
	});
	const base = '/api/v1/agent/apps/' + app.id;
	const grants = expectStatus(await f.api('GET', base + '/grants'), 200);
	expectStatus(
		await f.api('PUT', base + '/grants', {
			expectedPolicyRevision: grants.policyRevision,
			grants: [{ capability: 'plugin.invoke', scope: { kind: 'global' } }],
		}),
		200,
	);
	const settings = expectStatus(await f.api('GET', '/api/v1/agent/execution-settings'), 200).settings;
	expectStatus(
		await f.api('PUT', '/api/v1/agent/execution-settings', {
			expectedVersion: settings.version,
			enabled: true,
			limits: settings.limits,
		}),
		200,
	);
	const thread = expectStatus(await f.api('POST', base + '/threads', { title: 'No Provider' }), 201);
	const path = base + '/threads/' + thread.id + '/runs';
	const input = { prompt: 'No model required', approvalMode: 'ask', connectionIds: [], inputJson: '{"marker":42}' };
	const headers = { 'Idempotency-Key': randomUUID() };
	const created = expectStatus(await f.api('POST', path, input, headers), 201);
	const run = await until(
		async () => expectStatus(await f.api('GET', base + '/runs/' + created.run.id), 200),
		(r) => ['completed', 'failed', 'cancelled'].includes(r.status),
		'App completes',
	);
	assert.equal(run.status, 'completed', JSON.stringify(run));
	const replay = expectStatus(await f.api('POST', path, input, headers), 200);
	assert.equal(replay.status, 'replayed');
	assert.equal(replay.run.id, run.id);
});

for (const protocol of ['chat-completions', 'responses']) {
	await test('SDK4 bundled App performs a real ' + protocol + ' model Operation', { timeout: 60000 }, async (t) => {
		const directory = await mkdtemp(join(artifactRoot, 'model-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd, { protocol });
		t.after(() => f.close());
		const run = await f.start('SDK4 model', () => ({ text: 'Real App answer' }));
		const final = await until(
			async () => expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200),
			(r) => ['completed', 'failed', 'cancelled'].includes(r.status),
			'Model App settles',
		);
		assert.equal(final.status, 'completed', JSON.stringify(final));
		assert.ok(f.calls.length >= 1);
	});
}

await test(
	'SDK4 discovers a tool, executes remote I/O, and persists exact Operation bindings',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(artifactRoot, 'tool-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd);
		t.after(() => f.close());
		const path = join(directory, 'source.txt');
		await writeFile(path, 'SDK4 remote file evidence');
		const run = await f.start('SDK4 remote read', (results) => {
			if (results.length === 0) {
				return { name: 'file_read', input: { connectionId: f.connectionId, paths: [path] } };
			}
			assert.match(JSON.stringify(results[0]), /SDK4 remote file evidence/);
			return { text: 'Remote read complete' };
		});
		const final = await until(
			async () => expectStatus(await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id), 200),
			(r) => !['running', 'pending'].includes(r.status),
			'Tool App settles',
		);
		assert.equal(final.status, 'completed', JSON.stringify(final));
		assert.equal(await readFile(path, 'utf8'), 'SDK4 remote file evidence');
		const listed = expectStatus(
			await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/threads/' + run.threadId + '/tools?limit=10'),
			200,
		);
		const page = readAgentThreadToolsResponse(listed, f.appId, null, 10);
		const tool = page.items.find(
			(item) =>
				item.identity.kind === 'plugin' &&
				item.identity.packageId === 'nexus.tools.remote' &&
				item.identity.name === 'nexus.tools.remote.file_read',
		);
		assert.ok(tool, JSON.stringify(page));
		assert.equal(tool.state, 'completed');
		assert.equal(tool.effects.length, 1);
		assert.equal('resultText' in tool, false);
		const details = expectStatus(
			await f.api('GET', '/api/v1/agent/apps/' + f.appId + '/runs/' + run.id + '/tools/' + tool.id),
			200,
		);
		const toolPath = { appId: f.appId, runId: run.id, toolId: tool.id };
		assert.deepEqual(readAgentToolCallDetails(details, toolPath).tool, tool);
		for (const changed of [
			{ ...tool, identity: undefined },
			{ ...tool, effects: [...tool.effects, ...tool.effects] },
			{ ...tool, outputArtifactIds: [randomUUID(), randomUUID()].fill(tool.id) },
		]) {
			assert.throws(
				() => readAgentThreadToolsResponse({ items: [changed], nextCursor: null }, f.appId, null, 10),
				InvalidAgentPayload,
			);
			assert.throws(() => readAgentToolCallDetails({ ...details, tool: changed }, toolPath), InvalidAgentPayload);
		}
	},
);

await test(
	'SDK4 approval consumes the exact effect once and persists the parent operation',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(artifactRoot, 'approval-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd);
		t.after(() => f.close());
		const path = join(directory, 'written.txt');
		const run = await f.start('SDK4 approved write', (results) =>
			results.length === 0
				? { name: 'tool_search', input: { query: 'file_write' } }
				: results.length === 1
					? {
							name: 'file_write',
							input: {
								connectionId: f.connectionId,
								items: [{ path, content: 'approved exactly once', expectedSha256: 'absent' }],
							},
						}
					: { text: 'Written' },
		);
		const approval = await f.approval(run, 'file_write');
		await assert.rejects(readFile(path), { code: 'ENOENT' });
		assert.equal(approval.operationName, 'remote.write');
		await f.approve(approval);
		await f.wait(run, 'completed');
		assert.equal(await readFile(path, 'utf8'), 'approved exactly once');
		const db = new DatabaseSync(f.database, { readOnly: true });
		try {
			const operations = db.prepare('SELECT * FROM agent_operations WHERE run_id=?').all(run.id);
			const effect = operations.find((operation) => operation.label === 'remote.write');
			assert.equal(effect.state, 'completed');
			assert.equal(effect.id, approval.operationId);
			assert.ok(operations.some((operation) => operation.id === effect.parent_id && operation.kind === 'tool'));
			assert.equal(
				db.prepare('SELECT consumed_at FROM agent_operation_approvals WHERE id=?').get(approval.id)
					.consumed_at > 0,
				true,
			);
		} finally {
			db.close();
		}
	},
);

await test('SDK4 cancellation before approval never dispatches a remote write', { timeout: 60000 }, async (t) => {
	const directory = await mkdtemp(join(artifactRoot, 'cancel-'));
	const sshd = await openSshd(directory);
	t.after(() => sshd.close());
	const f = await openAgentExecution(directory, sshd);
	t.after(() => f.close());
	const path = join(directory, 'never-written.txt');
	const run = await f.start('SDK4 cancel pending write', (results) =>
		results.length === 0
			? { name: 'tool_search', input: { query: 'file_write' } }
			: results.length === 1
				? {
						name: 'file_write',
						input: {
							connectionId: f.connectionId,
							items: [{ path, content: 'must not be written', expectedSha256: 'absent' }],
						},
					}
				: { text: 'Done' },
	);
	const approval = await f.approval(run, 'file_write');
	await f.cancel(run);
	await f.wait(run, 'cancelled');
	await assert.rejects(readFile(path), { code: 'ENOENT' });
	const stale = await f.api(
		'POST',
		'/api/v1/apps/' + f.appId + '/approvals/' + approval.id + '/resolve',
		{ decision: 'approved', operationHash: approval.operationHash, expectedVersion: approval.version },
		{ 'Idempotency-Key': randomUUID() },
	);
	assert.equal(stale.status, 409, JSON.stringify(stale.body));
});

await test(
	'SDK4 signed settings remain readable while disabled, reject stale CAS and replay exact mutation receipts',
	{ timeout: 60000 },
	async (t) => {
		const directory = await mkdtemp(join(artifactRoot, 'settings-'));
		const sshd = await openSshd(directory);
		t.after(() => sshd.close());
		const f = await openAgentExecution(directory, sshd);
		t.after(() => f.close());
		const base = '/api/v1/agent/plugins/apps/' + f.appId + '/instances';
		const instance = expectStatus(await f.api('GET', base), 200).instances.find((item) => item.id === f.appId);
		assert.ok(instance);
		const path = base + '/' + instance.id;
		const appPath = '/api/v1/agent/apps/' + f.appId;
		const app = expectStatus(await f.api('GET', appPath), 200);
		expectStatus(await f.api('PATCH', appPath, { expectedVersion: app.version, enabled: false }), 200);
		const settings = expectStatus(await f.api('GET', path + '/configuration'), 200);
		assert.ok(settings.settings.agentEditablePaths.includes('/instructions'));
		const command = {
			operationKey: randomUUID(),
			expectedPackageRevision: settings.packageRevision,
			expectedRevision: settings.configuration.revision,
			schemaRevision: settings.settings.schemaRevision,
			documentJson: JSON.stringify({ instructions: 'Use concise answers.', compactionMode: 'balanced' }),
		};
		const written = expectStatus(await f.api('PUT', path + '/configuration', command), 200);
		assert.equal(written.changed, true);
		assert.equal(JSON.parse(written.configuration.documentJson).instructions, 'Use concise answers.');
		const replay = expectStatus(await f.api('PUT', path + '/configuration', command), 200);
		assert.equal(replay.configuration.revision, written.configuration.revision);
		expectStatus(
			await f.api('PUT', path + '/configuration', {
				...command,
				operationKey: randomUUID(),
				documentJson: JSON.stringify({ instructions: 'stale', compactionMode: 'balanced' }),
			}),
			409,
		);
		const current = expectStatus(await f.api('GET', path + '/configuration'), 200);
		assert.equal(current.configuration.documentJson, written.configuration.documentJson);
	},
);
