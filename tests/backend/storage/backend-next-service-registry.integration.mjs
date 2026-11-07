import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { RegistryModel } from '../../../packages/backend/dist/modules/agent/plugins/registry/model/registry-model.js';

const query = { kind: 'service', contract: 'fixture.values', apiVersion: 1, cursor: null };
const empty = JSON.stringify({ type: 'object', properties: {}, required: [], additionalProperties: false });
const result = JSON.stringify({
	oneOf: [
		{ type: 'null' },
		{ type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
	],
});

const refused = (code) => (error) => error instanceof AgentFailure && error.code === code;

function fixture() {
	const registry = new RegistryModel((error) => {
		throw error;
	});
	const provider = {
		userId: 7,
		appId: randomUUID(),
		instanceId: randomUUID(),
		generation: randomUUID(),
		configurationRevision: 0,
		packageRevision: 3,
		package: {
			packageId: 'fixture.provider',
			version: '1.0.0',
			packageHash: 'a'.repeat(64),
			publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		},
		namespaces: ['fixture'],
		appEntry: null,
		tools: true,
		services: true,
		capabilities: ['file.read', 'file.write'],
	};
	const caller = {
		userId: provider.userId,
		appId: provider.appId,
		ownerId: randomUUID(),
		visibleInstanceIds: [provider.instanceId],
		visibleToolInstanceIds: [],
		visibleToolKeys: [],
		capabilities: ['file.read'],
	};

	const method = (key = 'read', extra = {}) => ({
		kind: 'service',
		key,
		contract: query.contract,
		apiVersion: 1,
		summary: 'Read values',
		instructions: 'Read the selected provider only.',
		inputSchemaJson: empty,
		resultSchemaJson: result,
		capabilities: ['file.read'],
		tags: [],
		execution: 'managed',
		...extra,
	});

	return { registry, provider, caller, method };
}

await test('Service registry: dynamic services route independently of the App selected tool set', () => {
	const { registry, provider, caller, method } = fixture();
	registry.publish(provider, [method(), method('model_tool', { kind: 'tool' })], null);
	const page = registry.discover(caller, query);
	assert.equal(page.entries.length, 1);
	assert.equal(registry.discover(caller, { ...query, kind: 'tool' }).entries.length, 0);
	const binding = registry.bind(caller, page.entries[0].id);
	const resolved = registry.resolve(caller, binding.id, ' { } ');
	assert.deepEqual(resolved.provider.package, provider.package);
	assert.equal(resolved.provider.packageRevision, 3);
	assert.equal(resolved.binding.configurationRevision, 0);
	assert.equal(resolved.argumentsJson, '{}');
	assert.equal(resolved.validateResult(' null '), 'null');
	assert.equal(resolved.validateResult('{ "text": "ok" }'), '{"text":"ok"}');
});

await test('Service registry: exact caller scope, visibility, contract and method remain mandatory', () => {
	const { registry, provider, caller, method } = fixture();
	registry.publish(provider, [method()], null);
	const entry = registry.discover(caller, query).entries[0];
	const binding = registry.bind(caller, entry.id);
	for (const changed of [
		{ ownerId: randomUUID() },
		{ appId: randomUUID() },
		{ userId: 8 },
		{ visibleInstanceIds: [] },
		{ capabilities: [] },
	]) {
		assert.throws(() => registry.resolve({ ...caller, ...changed }, binding.id, '{}'), refused('version_conflict'));
	}
	for (const changed of [{ contract: 'foreign.values' }, { apiVersion: 2 }]) {
		assert.deepEqual(registry.discover(caller, { ...query, ...changed }).entries, []);
	}
	assert.throws(() => registry.bind(caller, randomUUID()), refused('not_found'));
	assert.throws(() => registry.describe(caller, 'unsigned'), refused('not_found'));
	registry.release({ ...caller, ownerId: randomUUID() });
	assert.equal(registry.resolve(caller, binding.id, '{}').provider.instanceId, provider.instanceId);
	registry.release(caller);
	assert.throws(() => registry.resolve(caller, binding.id, '{}'), refused('version_conflict'));
});

await test('Service registry: strict input and nullable result schemas reject malformed values', () => {
	const { registry, provider, caller, method } = fixture();
	registry.publish(provider, [method()], null);
	const binding = registry.bind(caller, registry.discover(caller, query).entries[0].id);
	for (const input of ['{"extra":1}', '{', 'null', '[]']) {
		assert.throws(() => registry.resolve(caller, binding.id, input), refused('invalid_input'));
	}
	const resolved = registry.resolve(caller, binding.id, '{}');
	for (const output of ['{"text":"ok","extra":1}', '{"text":1}', '{', 'false']) {
		assert.throws(() => resolved.validateResult(output), refused('invalid_input'));
	}
	assert.equal(resolved.validateResult('null'), 'null');
	assert.equal(registry.validateResult(caller, binding.id, '{"text":"ok"}'), '{"text":"ok"}');
});

await test('Service registry: source and projected mutations cannot change accepted schemas or package identity', () => {
	const { registry, provider, caller, method } = fixture();
	const declaration = method();
	registry.publish(provider, [declaration], null);
	const entry = registry.discover(caller, query).entries[0];
	const binding = registry.bind(caller, entry.id);
	const resolved = registry.resolve(caller, binding.id, '{}');
	provider.package.packageHash = 'b'.repeat(64);
	provider.capabilities.push('shell.execute');
	declaration.capabilities.push('shell.execute');
	declaration.inputSchemaJson = '{"type":"null"}';
	resolved.provider.package.packageHash = 'c'.repeat(64);
	resolved.definition.capabilities.push('shell.execute');
	resolved.definition.resultSchemaJson = '{"type":"boolean"}';
	resolved.binding.instanceId = randomUUID();
	const description = registry.describe(caller, entry.id);
	description.entry.package.packageHash = 'd'.repeat(64);
	description.definition.capabilities.push('shell.execute');
	const actual = registry.resolve(caller, binding.id, '{}');
	assert.equal(actual.provider.package.packageHash, 'a'.repeat(64));
	assert.deepEqual(actual.definition.capabilities, ['file.read']);
	assert.equal(actual.definition.inputSchemaJson, empty);
	assert.equal(actual.definition.resultSchemaJson, result);
	assert.equal(actual.validateResult('null'), 'null');
	assert.throws(() => actual.validateResult('true'), refused('invalid_input'));
});

await test('Service registry: settings and Child callers cannot hide a write or raw I/O capability behind read labels', () => {
	const { registry, provider, caller, method } = fixture();
	registry.publish(provider, [method(), method('read_with_write', { capabilities: ['file.write'] })], null);
	assert.deepEqual(
		registry.discover(caller, query).entries.map((entry) => entry.key),
		['read'],
	);
	const writable = { ...caller, capabilities: ['file.read', 'file.write'] };
	const write = registry.discover(writable, query).entries.find((entry) => entry.key === 'read_with_write');
	const binding = registry.bind(writable, write.id);
	assert.throws(() => registry.resolve(caller, binding.id, '{}'), refused('version_conflict'));
	const other = { ...provider, instanceId: randomUUID(), generation: randomUUID() };
	assert.throws(
		() => registry.publish(other, [method('forged_read', { capabilities: ['shell.execute'] })], null),
		refused('capability_undeclared'),
	);
	assert.equal(registry.discover({ ...writable, visibleInstanceIds: [other.instanceId] }, query).entries.length, 0);
});

await test('Service registry: large dynamic catalogs publish without static dependency-order or depth constraints', () => {
	const { registry, provider, caller, method } = fixture();
	const declarations = Array.from({ length: 1200 }, (_, index) => method('read_' + index));
	registry.publish(provider, declarations, null);
	const all = [];
	let cursor = null;
	do {
		const page = registry.discover(caller, { ...query, cursor });
		assert.ok(page.entries.length > 0);
		all.push(...page.entries);
		cursor = page.nextCursor;
	} while (cursor !== null);
	assert.equal(all.length, declarations.length);
	assert.equal(new Set(all.map((entry) => entry.id)).size, declarations.length);
	for (const entry of all) {
		const binding = registry.bind(caller, entry.id);
		assert.equal(registry.resolve(caller, binding.id, '{}').definition.key, entry.key);
	}
	registry.release(caller);
});
