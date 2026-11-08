import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';

const make = (name, { route = 'direct', proxyId = null, tagIds = [], jumpIds = [] } = {}) => ({
	name,
	type: 'SSH',
	host: 'localhost',
	port: 22,
	username: 'test',
	route,
	proxyId,
	notes: null,
	tagIds,
	jumpIds,
});

test('Targets SQLite transactions preserve isolation, CAS, references, partial import results and restart', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const root = await mkdtemp(join(artifactRoot, 'nexus-storage-integration-'));
	const owned = [];
	t.onTestFinished(async () => {
		const outcomes = await Promise.allSettled(owned.map((app) => Promise.resolve().then(() => app.close())));
		const failures = outcomes.flatMap((outcome) => (outcome.status === 'rejected' ? [outcome.reason] : []));
		if (failures.length) throw new AggregateError(failures, 'Target persistence fixture did not drain');
	});
	let app;
	app = await createApp(join(root, 'one.db'));
	owned.push(app);
	await assert.rejects(
		() => createApp(join(root, 'one.db')),
		(error) => error.kind === 'unavailable',
	);
	const second = await createApp(join(root, 'two.db'));
	owned.push(second);
	assert.equal((await second.targets.list()).length, 0);
	await second.close();
	const a = await app.targets.create(make('first'));
	assert.equal((await app.targets.get(a.id)).name, 'first');
	assert.equal((await app.targets.list()).length, 1);
	const updated = await app.targets.update(a.id, 1, { name: 'changed' });
	assert.equal(updated.status, 'updated');
	assert.equal(updated.value.version, 2);
	assert.equal((await app.targets.update(a.id, 1, { name: 'stale' })).status, 'version_conflict');
	assert.equal((await app.targets.update(999, 1, { name: 'missing' })).status, 'not_found');
	const clone = await app.targets.clone(a.id, 'copy');
	assert.equal(clone.name, 'copy');
	assert.notEqual(clone.id, a.id);
	const injection = await app.targets.create(make("Robert'); DROP TABLE connections;--"));
	assert.equal((await app.targets.get(injection.id)).name, "Robert'); DROP TABLE connections;--");
	const [firstImportResult] = await app.targets.importMany([
		{
			connection: make('imported', { route: 'proxy' }),
			inlineProxy: { name: 'shared-proxy', type: 'SOCKS5', host: '127.0.0.1', port: 1080, username: null },
			tagNames: ['production'],
		},
	]);
	assert.equal(firstImportResult.status, 'ok');
	const firstImport = await app.targets.get(firstImportResult.id);
	assert.equal(firstImport.route, 'proxy');
	assert.ok(firstImport.proxyId > 0);
	assert.equal(firstImport.tagIds.length, 1);
	const jump = await app.targets.create(make('jump', { route: 'jump', jumpIds: [a.id] }));
	await assert.rejects(
		() => app.targets.delete(a.id),
		(error) => error.code === 'reference_in_use',
	);
	await assert.rejects(
		() => app.targets.update(a.id, 2, { type: 'RDP' }),
		(error) => error.code === 'reference_in_use',
	);
	const [invalidImport] = await app.targets.importMany([
		{
			connection: make('invalid', { route: 'proxy', tagIds: [999999] }),
			inlineProxy: { name: 'orphan-proxy', type: 'HTTP', host: '127.0.0.1', port: 8888, username: null },
		},
	]);
	assert.equal(invalidImport.status, 'error');
	assert.equal((await app.targets.list()).filter((c) => c.name === 'invalid').length, 0);
	const outcomes = await app.targets.importMany([
		{ connection: make('batch-okay') },
		{ connection: make('batch-bad', { tagIds: [888888] }) },
		{ connection: make('batch-okay-two') },
	]);
	assert.deepEqual(
		outcomes.map((r) => r.status),
		['ok', 'error', 'ok'],
	);
	assert.equal(await app.targets.delete(jump.id), true);
	assert.equal(await app.targets.delete(a.id), true);
	await app.close();
	app = undefined;
	const reopened = await createApp(join(root, 'one.db'));
	owned.push(reopened);
	assert.ok((await reopened.targets.get(firstImport.id)).tagIds.length);
	await reopened.close();
});
