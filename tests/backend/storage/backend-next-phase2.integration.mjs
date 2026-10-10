import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../../../packages/backend-next/dist/bootstrap/create-app.js';
import { SqliteRuntime } from '../../../packages/backend-next/dist/platform/storage/sqlite/sqlite-runtime.js';
import { initializeSchema } from '../../../packages/backend-next/dist/platform/storage/sqlite/schema.js';
import { targetMigrations } from '../../../packages/backend-next/dist/modules/targets/migrations.js';
import { applicationMigrations } from '../../../packages/backend-next/dist/bootstrap/schema.js';
import { SqliteAccountStorage } from '../../../packages/backend-next/dist/modules/access/accounts/adapters/sqlite/account-sql.js';
import { SqliteSessionStorage } from '../../../packages/backend-next/dist/modules/access/sessions/adapters/sqlite/session-sql.js';
import { SessionModel } from '../../../packages/backend-next/dist/modules/access/sessions/model/session-model.js';
import {
	nextLoginFailure,
	mayAttemptLogin,
} from '../../../packages/backend-next/dist/modules/access/sessions/login-failure-rules.js';
const root = await mkdtemp(join(tmpdir(), 'nexus-phase2-'));
const key = randomBytes(32);

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
		rdpRemoteApp: null,
		rdpRemoteAppDirectory: null,
		rdpRemoteAppArguments: null,
	};
}

let app;
try {
	const dbPath = join(root, 'initial-v1.db');
	let db = SqliteRuntime.open(dbPath);
	assert.equal(targetMigrations.length, 1, 'unreleased schema must be a single v1 initial install');
	await initializeSchema(db, applicationMigrations.slice(0, 1));
	assert.deepEqual(
		(await db.all('SELECT version FROM schema_version')).map((r) => r.version),
		[1],
	);
	await initializeSchema(db, applicationMigrations);
	await new SqliteAccountStorage(db).createInitialAdmin({ username: 'regression', passwordHash: 'fixture-hash' });
	await db.close();
	app = await createApp(dbPath, { encryptionKey: key });
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
		() => app.targets.create({ ...metadata('invalid-ssh'), rdpRemoteApp: 'notepad' }),
		(error) => error.code === 'invalid_input',
	);
	await assert.rejects(() => app.targets.sshKeys.delete(sshKey.id));
	await assert.rejects(() => app.targets.proxies.delete(proxy.id));
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
	const agentApp = await app.agent.createApp(1, 'regression');
	const thread = await app.agent.createThread(1, agentApp.id, 'state');
	const intent = { userId: 1, appId: agentApp.id, threadId: thread.id, prompt: 'hello', operationKey: randomUUID() };
	const createdRun = await app.agent.createRun(intent);
	assert.equal(createdRun.status, 'created');
	assert.equal((await app.agent.createRun(intent)).status, 'replayed');
	assert.equal((await app.agent.createRun({ ...intent, prompt: 'different' })).status, 'idempotency_conflict');
	assert.equal((await app.agent.createRun({ ...intent, operationKey: randomUUID() })).status, 'active_run_conflict');
	const cancelIntent = {
		userId: 1,
		appId: agentApp.id,
		runId: createdRun.run.id,
		expectedVersion: createdRun.run.version,
		operationKey: randomUUID(),
	};
	assert.equal((await app.agent.cancelRun({ ...cancelIntent, expectedVersion: 99 })).status, 'version_conflict');
	assert.equal((await app.agent.cancelRun(cancelIntent)).status, 'cancelled');
	assert.equal((await app.agent.cancelRun(cancelIntent)).status, 'replayed');
	assert.equal((await app.agent.getRun(1, agentApp.id, createdRun.run.id)).status, 'cancelled');
	assert.equal(await app.agent.getRun(2, agentApp.id, createdRun.run.id), null);
	const firstPage = await app.agent.listEvents(1, agentApp.id, createdRun.run.id, 0, 1);
	assert.equal(firstPage.items.length, 1);
	const nextPage = await app.agent.listEvents(1, agentApp.id, createdRun.run.id, firstPage.nextCursor, 1);
	assert.equal(nextPage.items.length, 1);
	assert.ok(nextPage.items[0].sequence > firstPage.nextCursor);
	const copy = await app.targets.clone(jump.id, 'jump-copy');
	assert.equal(
		(await app.trustedSshTargets.resolveStored({ targetId: copy.id })).authentication.password,
		'SECRET_CONNECTION',
	);
	assert.equal((await app.targets.tags.rename(tag.id, tag.version, 'ops-next')).status, 'updated');
	await assert.rejects(
		() => app.targets.tags.delete(tag.id),
		(error) => error.code === 'reference_in_use',
	);
	await app.close();
	app = undefined;
	db = SqliteRuntime.open(dbPath);
	const sessions = new SqliteSessionStorage(db);
	const sessionModel = new SessionModel(sessions);
	const limits = { maxAttempts: 3, windowMs: 10000, banMs: 20000 };
	await Promise.all(Array.from({ length: 3 }, () => sessionModel.recordFailedPassword('regression-source', limits)));
	assert.equal(
		(await sessions.getLoginFailure('regression-source')).attempts,
		3,
		'concurrent failures must not lose increments',
	);
	assert.equal(await sessionModel.checkLoginAdmission('regression-source'), false);
	const blocked = { attempts: 3, windowStartedAt: 0, blockedUntil: 20000 };
	assert.equal(nextLoginFailure(blocked, 15000, limits).blockedUntil, 20000, 'active ban must not extend');
	assert.equal(mayAttemptLogin(blocked, 20000), true);
	assert.deepEqual(nextLoginFailure(blocked, 20000, limits), {
		attempts: 1,
		windowStartedAt: 20000,
		blockedUntil: 0,
	});
	const versions = (await db.all('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version);
	assert.deepEqual(versions, [1, 2, 3]);
	const creds = await db.all('SELECT encrypted_password FROM proxy_credentials');
	assert.ok(creds[0].encrypted_password.startsWith('v1.'));
	assert.equal(creds[0].encrypted_password.includes('SECRET_PROXY'), false);
	const keyRows = await db.all('SELECT encrypted_private_key FROM ssh_keys');
	assert.equal(keyRows[0].encrypted_private_key.includes('SECRET_PRIVATE_KEY'), false);
	await db.close();
	// A failing synthetic v2 must roll back while preserving the published v1.
	const failPath = join(root, 'failure.db');
	db = SqliteRuntime.open(failPath);
	await assert.rejects(
		() =>
			initializeSchema(db, [
				applicationMigrations[0],
				{
					version: 2,
					signature: 'test-only-failing-migration',

					async apply(tx) {
						await tx.exec('CREATE TABLE temporary_failure(id INTEGER PRIMARY KEY)');
						throw new Error('migration interrupted');
					},
				},
			]),
		/migration interrupted/,
	);
	assert.deepEqual(
		(await db.all('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version),
		[1],
	);
	assert.equal(await db.one("SELECT name FROM sqlite_master WHERE name='temporary_failure'"), null);
	await db.close();
	const recovered = await createApp(failPath, { encryptionKey: key });
	await recovered.close();
	db = SqliteRuntime.open(failPath);
	assert.deepEqual(
		(await db.all('SELECT version FROM schema_version ORDER BY version')).map((r) => r.version),
		[1, 2, 3],
	);
	await db.close();
	// Reject the first batch's incompatible pre-release v1 instead of silently
	// treating its missing credential tables as the new v1 layout.
	const prototypePath = join(root, 'prototype-v1.db');
	db = SqliteRuntime.open(prototypePath);
	await db.exec('CREATE TABLE schema_version(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL)');
	await db.run('INSERT INTO schema_version(version,applied_at) VALUES(1,?)', [Date.now()]);
	await db.close();
	await assert.rejects(
		() => createApp(prototypePath, { encryptionKey: key }),
		/Incompatible pre-release database schema/,
	);
	console.log('Backend-next phase2 SQLite integration PASS');
} finally {
	if (app) await app.close();
	await rm(root, { recursive: true, force: true });
}
