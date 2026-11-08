import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../../../../packages/backend/dist/bootstrap/create-app.js';
import { SqliteRuntime } from '../../../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';

function metadata(name, route = 'direct', proxyId = null, jumpIds = []) {
	return {
		name,
		type: 'SSH',
		host: 'localhost',
		port: 22,
		username: 'tester',
		route,
		proxyId,
		jumpIds,
		tagIds: [],
		notes: null,
	};
}

test('Target credentials remain encrypted while fingerprints track machine dependencies and reference writes stay atomic', async (t) => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const root = await mkdtemp(join(artifactRoot, 'nexus-owner-'));
	const dbPath = join(root, 'targets.db');
	const app = await createApp(dbPath, { encryptionKey: randomBytes(32) });
	t.onTestFinished(() => app.close());
	const proxy = await app.targets.proxies.create({
		name: 'office',
		host: 'proxy.local',
		type: 'SOCKS5',
		port: 1080,
		username: 'proxy-user',
		password: 'SECRET_PROXY',
	});
	assert.equal('password' in proxy, false);
	const tag = await app.targets.tags.create('ops');
	const sshKey = await app.targets.sshKeys.create({
		name: 'agent',
		privateKey: 'SECRET_PRIVATE_KEY',
		passphrase: 'SECRET_PASSPHRASE',
	});
	assert.equal('privateKey' in sshKey, false);
	const host = await app.targets.create({ ...metadata('primary', 'proxy', proxy.id), tagIds: [tag.id] });
	assert.equal(
		(await app.targets.credentials.set(host.id, host.version, { kind: 'ssh_key', sshKeyId: sshKey.id })).status,
		'updated',
	);
	const initial = await app.trustedSshTargets.resolveStored({ targetId: host.id });
	assert.equal(initial.authentication.privateKey, 'SECRET_PRIVATE_KEY');
	assert.equal(initial.proxy.password, 'SECRET_PROXY');
	assert.equal(initial.jumps.length, 0);
	const f1 = await app.trustedSshTargets.fingerprintStored(host.id);
	assert.equal(f1, initial.fingerprint);
	// Notes/tags and display labels are not machine configuration dependencies.
	const afterCredential = await app.targets.get(host.id);
	const edited = await app.targets.update(host.id, afterCredential.version, { notes: 'display only' });
	assert.equal(edited.status, 'updated');
	const extraTag = await app.targets.tags.create('display-only');
	const retagged = await app.targets.setTags(host.id, edited.value.version, [tag.id, extraTag.id]);
	assert.equal(retagged.status, 'updated');
	assert.equal(await app.trustedSshTargets.fingerprintStored(host.id), f1);
	await assert.rejects(
		() => app.targets.sshKeys.delete(sshKey.id),
		(error) => error.code === 'reference_in_use',
	);
	await assert.rejects(
		() => app.targets.proxies.delete(proxy.id),
		(error) => error.code === 'reference_in_use',
	);
	const changedKey = await app.targets.sshKeys.update(sshKey.id, sshKey.version, {
		privateKey: 'SECRET_PRIVATE_KEY_2',
	});
	assert.equal(changedKey.status, 'updated');
	const f2 = await app.trustedSshTargets.fingerprintStored(host.id);
	assert.notEqual(f1, f2);
	const changedProxy = await app.targets.proxies.update(proxy.id, proxy.version, { password: 'SECRET_PROXY_2' });
	assert.equal(changedProxy.status, 'updated');
	assert.notEqual(f2, await app.trustedSshTargets.fingerprintStored(host.id));
	const afterPassword = await app.trustedSshTargets.fingerprintStored(host.id);
	const renamedProxy = await app.targets.proxies.update(proxy.id, changedProxy.value.version, { name: 'office-2' });
	assert.equal(renamedProxy.status, 'updated');
	assert.equal(await app.trustedSshTargets.fingerprintStored(host.id), afterPassword);
	const jump = await app.targets.create(metadata('jump', 'jump', null, [host.id]));
	await app.targets.credentials.set(jump.id, jump.version, { kind: 'password', password: 'SECRET_CONNECTION' });
	const resolved = await app.trustedSshTargets.resolveStored({ targetId: jump.id });
	assert.equal(resolved.jumps.length, 1);
	assert.equal(resolved.authentication.password, 'SECRET_CONNECTION');
	const beforeCycle = await app.targets.get(host.id);
	await assert.rejects(
		() => app.targets.update(host.id, beforeCycle.version, { route: 'jump', proxyId: null, jumpIds: [jump.id] }),
		(error) => error.code === 'invalid_input',
	);
	assert.deepEqual(
		await app.targets.get(host.id),
		beforeCycle,
		'graph rejection must roll back metadata and version',
	);
	const copy = await app.targets.clone(jump.id, 'jump-copy');
	assert.equal(
		(await app.trustedSshTargets.resolveStored({ targetId: copy.id })).authentication.password,
		'SECRET_CONNECTION',
	);
	assert.equal((await app.targets.tags.rename(tag.id, tag.version, 'ops-next')).status, 'updated');
	const beforeTagDelete = await app.targets.get(host.id);
	assert.equal(await app.targets.tags.delete(tag.id), true);
	const afterTagDelete = await app.targets.get(host.id);
	assert.equal(afterTagDelete.tagIds.includes(tag.id), false);
	assert.equal(afterTagDelete.version, beforeTagDelete.version + 1);

	await app.close();
	const db = SqliteRuntime.open(dbPath);
	t.onTestFinished(() => db.close());
	const creds = await db.all('SELECT encrypted_password FROM proxy_credentials');
	assert.ok(creds[0].encrypted_password.startsWith('v1.'));
	assert.equal(creds[0].encrypted_password.includes('SECRET_PROXY'), false);
	const keyRows = await db.all('SELECT encrypted_private_key FROM ssh_keys');
	assert.equal(keyRows[0].encrypted_private_key.includes('SECRET_PRIVATE_KEY'), false);
});
