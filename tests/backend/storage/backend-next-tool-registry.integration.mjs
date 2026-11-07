import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { RegistryModel } from '../../../packages/backend/dist/modules/agent/plugins/registry/model/registry-model.js';
import { hostOperationDefinition } from '../../../packages/backend/dist/modules/agent/tools/host-operation-rules.js';
import { AgentFailure } from '../../../packages/backend/dist/modules/agent/agent-failure.js';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '../../../packages/shared/dist/agent/plugins/values.js';

const query = { kind: 'tool', contract: null, apiVersion: null, cursor: null };

const failure = (code) => (error) => error instanceof AgentFailure && error.code === code;

function fixture() {
	const errors = [];
	const registry = new RegistryModel((error) => errors.push(error));
	const provider = {
		userId: 1,
		appId: randomUUID(),
		instanceId: randomUUID(),
		generation: randomUUID(),
		configurationRevision: 0,
		packageRevision: 1,
		package: {
			packageId: 'fixture.catalog',
			version: '1.0.0',
			packageHash: 'a'.repeat(64),
			publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		},
		namespaces: ['fixture.catalog'],
		appEntry: null,
		tools: true,
		services: false,
		capabilities: ['plugin.invoke', 'browser.read', 'artifacts.write', 'host.inspect', 'file.read'],
	};
	const caller = {
		userId: provider.userId,
		appId: provider.appId,
		ownerId: randomUUID(),
		visibleInstanceIds: [provider.instanceId],
		visibleToolInstanceIds: [provider.instanceId],
		visibleToolKeys: null,
		capabilities: ['plugin.invoke', 'browser.read', 'host.inspect', 'file.read'],
	};

	const definition = (name, capabilities = ['plugin.invoke'], summary = name) => ({
		kind: 'tool',
		key: 'fixture.catalog.' + name,
		contract: 'fixture.catalog.tools',
		apiVersion: 1,
		summary,
		instructions: 'Use the exact schema and the independent Host permission checks.',
		inputSchemaJson: '{"type":"object","properties":{},"additionalProperties":false}',
		resultSchemaJson: '{"type":"object"}',
		capabilities,
		tags: [],
		execution: 'managed',
	});

	return { registry, provider, caller, definition, errors };
}

await test('Tool registry: optional screenshot does not hide readable evidence or grant artifact authority', () => {
	const f = fixture();
	f.registry.publish(
		f.provider,
		[
			f.definition('browser_evidence', ['plugin.invoke', 'browser.read']),
			f.definition('screenshot_only', ['plugin.invoke', 'browser.read', 'artifacts.write']),
		],
		null,
	);
	assert.deepEqual(
		f.registry.discover(f.caller, query).entries.map((entry) => entry.key),
		['fixture.catalog.browser_evidence'],
	);
	assert.equal(
		f.registry.discover({ ...f.caller, capabilities: [...f.caller.capabilities, 'artifacts.write'] }, query).entries
			.length,
		2,
	);
	assert.equal(f.registry.discover({ ...f.caller, capabilities: ['browser.read'] }, query).entries.length, 0);
	const screenshot = hostOperationDefinition('browser.screenshot');
	assert.equal(screenshot.capability, 'browser.read');
	assert.deepEqual(screenshot.requirements.capabilities, ['artifacts.write']);
});

await test('Tool registry: target selection stays with the native effect and inherited tool keys are exact', () => {
	const f = fixture();
	f.registry.publish(
		f.provider,
		[f.definition('optional_target'), f.definition('target_only', ['file.read']), f.definition('compute')],
		null,
	);
	const entries = f.registry.discover(f.caller, query).entries;
	assert.equal(entries.length, 3, 'Registry metadata does not invent or bypass native target selection');
	assert.equal(hostOperationDefinition('remote.inspect').requirements.targets, true);
	assert.equal(hostOperationDefinition('diagnostics.host').requirements.targets, false);
	const selected = { ...f.caller, visibleToolKeys: ['fixture.catalog.target_only'] };
	assert.deepEqual(
		f.registry.discover(selected, query).entries.map((entry) => entry.key),
		['fixture.catalog.target_only'],
	);
	assert.deepEqual(f.registry.discover({ ...selected, visibleToolKeys: ['target_only'] }, query).entries, []);
	assert.deepEqual(f.registry.discover({ ...selected, visibleToolInstanceIds: [] }, query).entries, []);
});

await test('Tool registry: selected bindings keep immutable definitions separate from current exposure', () => {
	const f = fixture();
	const values = [f.definition('evidence', ['file.read']), f.definition('compute')];
	f.registry.publish(f.provider, values, null);
	const page = f.registry.discover(f.caller, query);
	const compute = page.entries.find((entry) => entry.key.endsWith('.compute'));
	const bound = f.registry.bind(f.caller, compute.id);
	values[1].instructions = 'mutated caller-owned definition';
	const description = f.registry.describe(f.caller, compute.id);
	assert.notEqual(description.definition.instructions, values[1].instructions);
	description.definition.instructions = 'mutated returned description';
	assert.notEqual(
		f.registry.describe(f.caller, compute.id).definition.instructions,
		description.definition.instructions,
	);
	assert.equal(
		f.registry.resolve({ ...f.caller, visibleToolKeys: [compute.key] }, bound.id, '{}').definition.key,
		compute.key,
	);
	assert.equal(f.registry.discover(f.caller, query).entries.length, 2);
	assert.throws(() => f.registry.bind(f.caller, 'f'.repeat(64)), failure('not_found'));
	assert.throws(() => f.registry.resolve(f.caller, 'f'.repeat(64), '{}'), failure('version_conflict'));
});

await test('Tool registry: revocation between discovery, binding and invocation rejects stale authority', () => {
	const f = fixture();
	f.registry.publish(f.provider, [f.definition('evidence', ['file.read']), f.definition('compute')], null);
	const entries = f.registry.discover(f.caller, query).entries;
	const evidence = entries.find((entry) => entry.key.endsWith('.evidence'));
	const compute = entries.find((entry) => entry.key.endsWith('.compute'));
	const binding = f.registry.bind(f.caller, evidence.id);
	const revoked = { ...f.caller, capabilities: ['plugin.invoke'] };
	assert.throws(() => f.registry.bind(revoked, evidence.id), failure('not_found'));
	assert.throws(() => f.registry.resolve(revoked, binding.id, '{}'), failure('version_conflict'));
	const restricted = { ...f.caller, visibleToolKeys: [compute.key] };
	assert.throws(() => f.registry.resolve(restricted, binding.id, '{}'), failure('version_conflict'));
	assert.equal(
		f.registry.resolve(revoked, f.registry.bind(revoked, compute.id).id, '{}').definition.key,
		compute.key,
	);
	for (const change of [
		{ visibleInstanceIds: [] },
		{ userId: 2 },
		{ appId: randomUUID() },
		{ ownerId: randomUUID() },
	])
		assert.throws(
			() => f.registry.resolve({ ...f.caller, ...change }, binding.id, '{}'),
			failure('version_conflict'),
		);
});

await test('Tool registry: an immutable implementation update invalidates old selection without redirecting it', () => {
	const f = fixture();
	const definitions = [f.definition('compute')];
	const stop = f.registry.publish(f.provider, definitions, null);
	const old = f.registry.discover(f.caller, query).entries[0];
	const binding = f.registry.bind(f.caller, old.id);
	const next = {
		...f.provider,
		generation: randomUUID(),
		packageRevision: 2,
		package: { ...f.provider.package, version: '2.0.0', packageHash: 'c'.repeat(64) },
	};
	f.registry.publish(next, definitions, f.provider.generation);
	stop();
	const current = f.registry.discover(f.caller, query).entries[0];
	assert.equal(current.key, old.key);
	assert.notEqual(current.id, old.id);
	assert.equal(current.package.packageHash, 'c'.repeat(64));
	assert.throws(() => f.registry.resolve(f.caller, binding.id, '{}'), failure('version_conflict'));
	assert.throws(() => f.registry.bind(f.caller, old.id), failure('not_found'));
	assert.equal(
		f.registry.resolve(f.caller, f.registry.bind(f.caller, current.id).id, '{}').provider.generation,
		next.generation,
	);
});

await test('Tool discovery: 300 Unicode summaries page within the transport budget with exact stale-source rejection', () => {
	const f = fixture();
	f.registry.publish(
		f.provider,
		Array.from({ length: 300 }, (_, index) => f.definition('compute_' + index, [], '目录证据'.repeat(500))),
		null,
	);
	const first = f.registry.discover(f.caller, query);
	assert.ok(first.entries.length > 0 && first.entries.length < 300);
	const collected = [];
	let page = first;
	for (;;) {
		assert.ok(Buffer.byteLength(JSON.stringify(page)) <= AGENT_PLUGIN_MAX_MESSAGE_BYTES);
		assert.equal(page.revision, first.revision);
		assert.ok(page.entries.length > 0);
		collected.push(...page.entries);
		if (page.nextCursor === null) break;
		page = f.registry.discover(f.caller, { ...query, cursor: page.nextCursor });
	}
	assert.equal(collected.length, 300);
	assert.equal(new Set(collected.map((entry) => entry.id)).size, 300);
	assert.equal(new Set(collected.map((entry) => entry.key)).size, 300);
	assert.deepEqual(
		new Set(collected.map((entry) => entry.key)),
		new Set(Array.from({ length: 300 }, (_, i) => 'fixture.catalog.compute_' + i)),
	);
	f.registry.publish(
		{ ...f.provider, generation: randomUUID() },
		[f.definition('replacement')],
		f.provider.generation,
	);
	assert.throws(
		() => f.registry.discover(f.caller, { ...query, cursor: first.nextCursor }),
		failure('version_conflict'),
	);
	assert.throws(() => f.registry.discover(f.caller, { ...query, cursor: 'malformed' }), failure('version_conflict'));
	assert.deepEqual(f.errors, []);
});
