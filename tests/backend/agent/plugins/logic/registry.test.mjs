import assert from 'node:assert/strict';
import { test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RegistryModel } from '../../../../../packages/backend/src/modules/agent/plugins/registry/model/registry-model.ts';
import { AgentFailure } from '../../../../../packages/backend/src/modules/agent/agent-failure.ts';

const object = JSON.stringify({
	type: 'object',
	properties: { value: { type: 'string' } },
	required: ['value'],
	additionalProperties: false,
});
const query = { kind: null, contract: null, apiVersion: null, cursor: null };

const refused = (code) => (error) => error instanceof AgentFailure && error.code === code;

function fixture() {
	const failures = [];
	const registry = new RegistryModel((error) => failures.push(error));
	const provider = {
		userId: 1,
		appId: randomUUID(),
		instanceId: randomUUID(),
		generation: randomUUID(),
		configurationRevision: 0,
		packageRevision: 1,
		package: {
			packageId: 'fixture.dynamic',
			version: '1.0.0',
			packageHash: 'a'.repeat(64),
			publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		},
		namespaces: ['fixture.dynamic'],
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
		visibleToolInstanceIds: [provider.instanceId],
		visibleToolKeys: null,
		capabilities: ['file.read'],
	};

	const definition = (key = 'read', kind = 'service', extra = {}) => ({
		kind,
		key: 'fixture.dynamic.' + key,
		contract: 'fixture.dynamic.values',
		apiVersion: 1,
		summary: 'Read values',
		instructions: 'Exact detailed schema and usage',
		inputSchemaJson: object,
		resultSchemaJson: object,
		capabilities: ['file.read'],
		tags: [],
		execution: 'managed',
		...extra,
	});

	return { registry, provider, caller, definition, failures };
}

await test('SDK4 registry: dynamic service and tool declarations use exact scope, schema and caller-owned binding', () => {
	const { registry, provider, caller, definition } = fixture();
	registry.publish(provider, [definition(), definition('tool', 'tool')], null);
	const page = registry.discover(caller, query);
	assert.equal(page.entries.length, 2);
	assert.equal(
		registry.discover({ ...caller, visibleToolInstanceIds: [] }, query).entries.length,
		1,
		'internal dependency services stay callable without exposing their tools',
	);
	const service = page.entries.find((entry) => entry.kind === 'service');
	assert.equal(service.instructions, undefined, 'discovery carries summaries only');
	const detail = registry.describe(caller, service.id);
	assert.equal(detail.definition.instructions, 'Exact detailed schema and usage');
	const binding = registry.bind(caller, service.id);
	const resolved = registry.resolve(caller, binding.id, ' { "value": "ok" } ');
	assert.equal(resolved.argumentsJson, '{"value":"ok"}');
	assert.equal(resolved.validateResult('{"value":"returned"}'), '{"value":"returned"}');
	for (const input of ['{}', '{"value":2}', '{"value":"ok","extra":true}', '[1]', 'bad'])
		assert.throws(() => registry.resolve(caller, binding.id, input), refused('invalid_input'));
	assert.throws(() => resolved.validateResult('{"value":true}'), refused('invalid_input'));
	assert.throws(
		() => registry.resolve({ ...caller, ownerId: randomUUID() }, binding.id, '{"value":"ok"}'),
		refused('version_conflict'),
	);
	assert.throws(
		() => registry.resolve({ ...caller, capabilities: [] }, binding.id, '{"value":"ok"}'),
		refused('version_conflict'),
	);
	registry.release(caller);
	assert.throws(() => registry.resolve(caller, binding.id, '{"value":"ok"}'), refused('version_conflict'));
});

await test('SDK4 registry: replacement is atomic, stale disposer and generation cannot remove current contributions', () => {
	const { registry, provider, caller, definition } = fixture();
	const dispose = registry.publish(provider, [definition()], null);
	const original = registry.discover(caller, query);
	const binding = registry.bind(caller, original.entries[0].id);
	assert.throws(
		() =>
			registry.publish(
				{ ...provider, generation: randomUUID() },
				[definition(), definition('broken', 'service', { inputSchemaJson: '{"type":"nonsense"}' })],
				provider.generation,
			),
		refused('invalid_input'),
	);
	assert.deepEqual(registry.discover(caller, query), original);
	const next = { ...provider, generation: randomUUID(), configurationRevision: 1 };
	registry.publish(next, [definition('replacement')], provider.generation);
	dispose();
	assert.equal(registry.discover(caller, query).entries[0].key, 'fixture.dynamic.replacement');
	assert.throws(
		() => registry.providerOf(caller, provider.instanceId, provider.generation),
		refused('version_conflict'),
	);
	assert.throws(() => registry.resolve(caller, binding.id, '{"value":"ok"}'), refused('version_conflict'));
	assert.throws(
		() => registry.discover(caller, { ...query, cursor: original.revision + ':' + original.entries[0].id }),
		refused('version_conflict'),
	);
});

await test('SDK4 registry: undeclared namespaces, kinds and capability escalation refuse complete publication', () => {
	const { registry, provider, caller, definition } = fixture();
	for (const value of [
		definition('read', 'service', { contract: 'foreign.contract' }),
		definition('read', 'service', { capabilities: ['shell.execute'] }),
		definition('read', 'app'),
	])
		assert.throws(
			() => registry.publish(provider, [definition(), value], null),
			(error) => error instanceof AgentFailure,
		);
	assert.deepEqual(registry.discover(caller, query).entries, []);
	registry.publish(provider, [definition('write', 'tool', { capabilities: ['file.write'] })], null);
	assert.deepEqual(
		registry.discover(caller, query).entries,
		[],
		'ancestor capability restriction applies to self-registered tools too',
	);
	assert.equal(registry.discover({ ...caller, capabilities: ['file.write'] }, query).entries.length, 1);
	assert.deepEqual(registry.discover({ ...caller, appId: randomUUID() }, query).entries, []);
	assert.deepEqual(registry.discover({ ...caller, userId: 2 }, query).entries, []);
});

await test('SDK4 registry: same package multiple instances remain independent and explicit provider filters never select a global default', () => {
	const { registry, provider, caller, definition } = fixture();
	registry.publish(provider, [definition()], null);
	const second = { ...provider, instanceId: randomUUID(), generation: randomUUID() };
	const stop = registry.publish(second, [definition()], null);
	const both = { ...caller, visibleInstanceIds: [provider.instanceId, second.instanceId] };
	const page = registry.discover(both, { ...query, contract: 'fixture.dynamic.values', apiVersion: 1 });
	assert.equal(page.entries.length, 2);
	assert.notEqual(page.entries[0].id, page.entries[1].id);
	const secondEntry = page.entries.find((entry) => entry.instanceId === second.instanceId);
	const binding = registry.bind(both, secondEntry.id);
	assert.equal(registry.resolve(both, binding.id, '{"value":"second"}').provider.instanceId, second.instanceId);
	stop();
	assert.throws(() => registry.resolve(both, binding.id, '{"value":"second"}'), refused('version_conflict'));
	assert.equal(registry.discover(both, query).entries.length, 1);
	assert.equal(registry.discover(both, { ...query, apiVersion: 2 }).entries.length, 0);
});

await test('SDK4 registry: events use schema, exact generation, snapshot source and cancellable event-driven waits', async () => {
	const { registry, provider, caller, definition, failures } = fixture();
	const event = {
		kind: 'event',
		key: 'fixture.dynamic.changed',
		contract: 'fixture.dynamic.events',
		apiVersion: 1,
		summary: 'Changed',
		payloadSchemaJson: object,
		source: { kind: 'snapshot', callableKey: 'fixture.dynamic.read' },
	};
	assert.throws(() => registry.publish(provider, [event], null), refused('invalid_input'));
	const stop = registry.publish(provider, [definition(), event], null);
	const entry = registry.discover(caller, { ...query, kind: 'event' }).entries[0];
	const wait = registry.waitEvent(caller, entry.id, 0, new AbortController().signal);
	const sent = registry.publishEvent(provider, {
		key: event.key,
		cursor: 'source:1',
		payloadJson: '{"value":"first"}',
	});
	assert.deepEqual(await wait, sent);
	assert.deepEqual(
		await registry.waitEvent(caller, entry.id, 0, new AbortController().signal),
		sent,
		'subscribe-before-snapshot closes the notification race',
	);
	assert.throws(
		() => registry.publishEvent(provider, { key: event.key, cursor: null, payloadJson: '{}' }),
		refused('invalid_input'),
	);
	const cancelled = new AbortController();
	const pending = registry.waitEvent(caller, entry.id, 1, cancelled.signal);
	cancelled.abort();
	await assert.rejects(pending, refused('provider_unavailable'));
	const removed = registry.waitEvent(caller, entry.id, 1, new AbortController().signal);
	stop();
	await assert.rejects(removed, refused('not_found'));
	assert.throws(
		() => registry.publishEvent(provider, { key: event.key, cursor: null, payloadJson: '{"value":"late"}' }),
		refused('version_conflict'),
	);
	assert.deepEqual(failures, []);
});

await test('SDK4 registry: unchanged definitions cannot bypass a reduced provider capability set', () => {
	const { registry, provider, caller, definition } = fixture();
	registry.publish(provider, [definition()], null);
	const original = registry.discover(caller, query);
	assert.throws(
		() => registry.publish({ ...provider, capabilities: [] }, [definition()], provider.generation),
		refused('capability_undeclared'),
	);
	assert.deepEqual(registry.discover(caller, query), original, 'a refused replacement remains atomic');
});
