import assert from 'node:assert/strict';
import {
	toConnectionInput,
	toConnectionPatch,
	toConnectionView,
	toConnectionMutation,
	toImportInput,
	toImportItems,
	toProxyInput,
	toProxyPatch,
	toProxyView,
	toProxyMutation,
	toTagView,
	toTagMutation,
	toSshKeyInput,
	toSshKeyPatch,
	toSshKeyView,
	toSshKeyMutation,
	toCredentialInput,
	toCredentialMutation,
	toTrustedTargetView,
} from '../../../packages/backend-next/dist/modules/targets/public-mappers.js';
import { createApp } from '../../../packages/backend-next/dist/bootstrap/create-app.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const forbidden = 'NEVER_EXPOSE_INTERNAL_FIELD';

function withoutInternal(value) {
	assert.equal(JSON.stringify(value).includes(forbidden), false, 'internal fields must never escape');
}

const connection = {
	id: 3,
	version: 4,
	createdAt: 10,
	updatedAt: 11,
	name: 'host',
	type: 'SSH',
	host: 'host.local',
	port: 22,
	username: 'alice',
	route: 'direct',
	proxyId: null,
	notes: null,
	rdpRemoteApp: null,
	rdpRemoteAppDirectory: null,
	rdpRemoteAppArguments: null,
	tagIds: [1, 2],
	jumpIds: [5],
	futureInternalField: forbidden,
	encryptedPassword: forbidden,
};
const view = toConnectionView(connection);
withoutInternal(view);
assert.notStrictEqual(view, connection);
assert.notStrictEqual(view.tagIds, connection.tagIds);
assert.notStrictEqual(view.jumpIds, connection.jumpIds);
assert.deepEqual(
	Object.keys(view).sort(),
	[
		'id',
		'version',
		'createdAt',
		'updatedAt',
		'name',
		'type',
		'host',
		'port',
		'username',
		'route',
		'proxyId',
		'notes',
		'rdpRemoteApp',
		'rdpRemoteAppDirectory',
		'rdpRemoteAppArguments',
		'tagIds',
		'jumpIds',
	].sort(),
);
const input = toConnectionInput(connection);
withoutInternal(input);
assert.notStrictEqual(input.tagIds, connection.tagIds);
const patch = toConnectionPatch({
	notes: 'changed',
	jumpIds: [9],
	encryptedPassword: forbidden,
	tagIds: [7],
});
withoutInternal(patch);
assert.deepEqual(Object.keys(patch).sort(), ['notes', 'jumpIds', 'tagIds'].sort());
assert.notStrictEqual(patch.tagIds, connection.tagIds);
for (const status of ['updated', 'not_found', 'version_conflict']) {
	const result = toConnectionMutation({ status, value: connection, privateField: forbidden });
	withoutInternal(result);
	if (status === 'updated') {
		assert.notStrictEqual(result.value, connection);
		assert.notStrictEqual(result.value.tagIds, connection.tagIds);
	}
}
const importCommand = {
	connection,
	inlineProxy: {
		name: 'proxy',
		type: 'HTTP',
		host: 'proxy.local',
		port: 8080,
		username: null,
		password: forbidden,
		encryptedPassword: forbidden,
	},
	tagNames: ['tag'],
	internal: forbidden,
};
const mappedImport = toImportInput(importCommand);
withoutInternal(mappedImport);
assert.notStrictEqual(mappedImport.connection, connection);
assert.notStrictEqual(mappedImport.connection.tagIds, connection.tagIds);
assert.notStrictEqual(mappedImport.inlineProxy, importCommand.inlineProxy);
assert.notStrictEqual(mappedImport.tagNames, importCommand.tagNames);
assert.deepEqual(
	toImportItems([
		{ status: 'ok', id: 8, leak: forbidden },
		{ status: 'error', code: 'invalid_input', leak: forbidden },
	]),
	[
		{ status: 'ok', id: 8 },
		{ status: 'error', code: 'invalid_input' },
	],
);

const proxy = {
	id: 1,
	name: 'proxy',
	type: 'SOCKS5',
	host: 'proxy.host',
	port: 1080,
	username: null,
	version: 1,
	createdAt: 1,
	updatedAt: 2,
	encryptedPassword: forbidden,
	newSecretField: forbidden,
};
const proxyResult = toProxyView(proxy);
withoutInternal(proxyResult);
assert.notStrictEqual(proxyResult, proxy);
const proxyIn = toProxyInput({ ...proxy, password: 'supplied', newSecretField: forbidden });
withoutInternal(proxyIn);
assert.deepEqual(Object.keys(proxyIn).sort(), ['name', 'type', 'host', 'port', 'username', 'password'].sort());
const proxyChanges = toProxyPatch({ name: 'updated', password: 'supplied', extra: forbidden });
withoutInternal(proxyChanges);
assert.deepEqual(Object.keys(proxyChanges).sort(), ['name', 'password'].sort());
withoutInternal(toProxyMutation({ status: 'updated', value: proxy, extra: forbidden }));
withoutInternal(toProxyMutation({ status: 'version_conflict', extra: forbidden }));

const tag = { id: 1, name: 'tag', version: 1, createdAt: 1, updatedAt: 2, extra: forbidden };
withoutInternal(toTagView(tag));
withoutInternal(toTagMutation({ status: 'updated', value: tag, extra: forbidden }));
withoutInternal(toTagMutation({ status: 'not_found', extra: forbidden }));
const key = {
	id: 1,
	name: 'key',
	version: 1,
	createdAt: 1,
	updatedAt: 2,
	encryptedPrivateKey: forbidden,
	extra: forbidden,
};
withoutInternal(toSshKeyView(key));
withoutInternal(toSshKeyMutation({ status: 'updated', value: key, extra: forbidden }));
withoutInternal(toSshKeyMutation({ status: 'version_conflict', extra: forbidden }));
assert.deepEqual(toSshKeyInput({ name: 'new', privateKey: 'private', passphrase: null, extra: forbidden }), {
	name: 'new',
	privateKey: 'private',
	passphrase: null,
});
assert.deepEqual(toSshKeyPatch({ name: 'renamed', passphrase: null, extra: forbidden }), {
	name: 'renamed',
	passphrase: null,
});
assert.deepEqual(toCredentialInput({ kind: 'ssh_key', sshKeyId: 1, extra: forbidden }), {
	kind: 'ssh_key',
	sshKeyId: 1,
});
assert.deepEqual(toCredentialInput({ kind: 'password', password: 'value', extra: forbidden }), {
	kind: 'password',
	password: 'value',
});
assert.deepEqual(toCredentialMutation({ status: 'updated', extra: forbidden }), { status: 'updated' });
assert.deepEqual(toCredentialMutation({ status: 'not_found', extra: forbidden }), { status: 'not_found' });

const nested = {
	id: 1,
	host: 'hop',
	port: 22,
	username: 'jump',
	authentication: { kind: 'password', password: 'hop password', internal: forbidden },
	proxy: {
		type: 'SOCKS5',
		host: 'proxy',
		port: 1080,
		username: null,
		password: 'proxy password',
		internal: forbidden,
	},
	jumps: [],
	fingerprint: 'hash1',
	internal: forbidden,
};
const trusted = toTrustedTargetView({
	id: 2,
	host: 'dest',
	port: 22,
	username: 'root',
	authentication: { kind: 'ssh_key', privateKey: 'key', passphrase: null, internal: forbidden },
	proxy: null,
	jumps: [nested],
	fingerprint: 'hash2',
	internal: forbidden,
});
withoutInternal(trusted);
assert.notStrictEqual(trusted.jumps, nested.jumps);
assert.notStrictEqual(trusted.jumps[0], nested);
assert.notStrictEqual(trusted.jumps[0].proxy, nested.proxy);
assert.notStrictEqual(trusted.jumps[0].authentication, nested.authentication);
assert.equal(Object.isFrozen(trusted.jumps), true);
assert.deepEqual(
	Object.keys(trusted).sort(),
	['id', 'host', 'port', 'username', 'authentication', 'proxy', 'jumps', 'fingerprint'].sort(),
);

const folder = await mkdtemp(join(tmpdir(), 'nexus-boundary-'));
let app;
try {
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
	const resolved = await app.trustedSshTargets.resolveStored(host.id);
	assert.equal(resolved.authentication.privateKey, 'private');
	assert.equal(Object.isFrozen(resolved), true);
	assert.ok(!('encryptedPrivateKey' in resolved.authentication));
	await app.close();
	app = null;
} finally {
	if (app) await app.close();
	await rm(folder, { recursive: true, force: true });
}
console.log('Backend-next targets public boundary PASS');
