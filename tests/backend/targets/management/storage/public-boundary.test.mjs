import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';

const forbidden = 'NEVER_EXPOSE_INTERNAL_FIELD';

function withoutInternal(value) {
	assert.equal(JSON.stringify(value).includes(forbidden), false, 'internal fields must never escape');
}

const connection = {
	id: 3,
	version: 4,
	createdAt: 10,
	updatedAt: 11,
	lastConnectedAt: 12,
	name: 'host',
	type: 'SSH',
	host: 'host.local',
	port: 22,
	username: 'alice',
	route: 'direct',
	proxyId: null,
	notes: null,
	tagIds: [1, 2],
	jumpIds: [5],
	futureInternalField: forbidden,
	encryptedPassword: forbidden,
};

test('Targets public facade keeps SQLite records private and explicitly exposes authorized trusted credentials', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const folder = await mkdtemp(join(artifactRoot, 'nexus-boundary-'));
	let app;
	t.onTestFinished(async () => {
		if (app) await app.close();
	});
	app = await createApp(join(folder, 'boundary.db'), { encryptionKey: randomBytes(32) });
	const tagCreated = await app.targets.tags.create('tag');
	const proxyCreated = await app.targets.proxies.create({
		name: 'proxy',
		type: 'HTTP',
		host: 'proxy.local',
		port: 8080,
		username: null,
		password: 'stored',
	});
	const keyCreated = await app.targets.sshKeys.create({ name: 'key', privateKey: 'private' });
	const host = await app.targets.create({
		...connection,
		id: undefined,
		version: undefined,
		createdAt: undefined,
		updatedAt: undefined,
		tagIds: [tagCreated.id],
		jumpIds: [],
		route: 'proxy',
		proxyId: proxyCreated.id,
	});
	const status = await app.targets.credentials.set(host.id, host.version, {
		kind: 'ssh_key',
		sshKeyId: keyCreated.id,
	});
	assert.deepEqual(status, { status: 'updated' });
	for (const result of [
		host,
		await app.targets.get(host.id),
		...(await app.targets.list()),
		proxyCreated,
		await app.targets.proxies.get(proxyCreated.id),
		...(await app.targets.proxies.list()),
		tagCreated,
		await app.targets.tags.get(tagCreated.id),
		...(await app.targets.tags.list()),
		keyCreated,
		await app.targets.sshKeys.get(keyCreated.id),
		...(await app.targets.sshKeys.list()),
	])
		withoutInternal(result);
	const resolved = await app.trustedSshTargets.resolveStored({ targetId: host.id });
	assert.equal(resolved.authentication.privateKey, 'private');
	assert.equal(Object.isFrozen(resolved), true);
	assert.ok(!('encryptedPrivateKey' in resolved.authentication));
	await app.close();
	app = null;
});
