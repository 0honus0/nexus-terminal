import assert from 'node:assert/strict';
import { test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { InvalidAgentPayload } from '../../../../../packages/shared/src/agent/http-codec.ts';
import { readAgentPluginManifest } from '../../../../../packages/shared/src/agent/plugins/http-codec.ts';
import { readAgentPluginRegistration } from '../../../../../packages/shared/src/agent/plugins/registry-codec.ts';
import { RegistryModel } from '../../../../../packages/backend/src/modules/agent/plugins/registry/model/registry-model.ts';
import { AgentFailure } from '../../../../../packages/backend/src/modules/agent/agent-failure.ts';

test('Agent modular: signed namespace bounds and dynamic schemas reject inconsistent declarations', () => {
	const manifest = {
		schemaVersion: 4,
		id: 'test.schema',
		version: '1.0.0',
		displayName: 'Schema contract',
		compatibility: { host: { minVersion: '1.0.0', maxVersion: '1.99.99' }, backendSdk: 4, frontendSdk: null },
		capabilities: ['plugin.invoke'],
		intents: [],
		frontendEntry: null,
		backendEntry: 'backend/index.mjs',
		dependencies: [],
		namespaces: ['test.schema'],
		contributions: { app: null, tools: true, services: false, ui: null, settings: null, skills: [] },
	};
	assert.deepEqual(readAgentPluginManifest(manifest), manifest);
	for (const change of [
		(value) => {
			value.schemaVersion = 3;
		},
		(value) => {
			value.sdkVersion = '4';
		},
		(value) => {
			value.compatibility.backendSdk = 3;
		},
		(value) => {
			value.backendEntry = null;
			value.compatibility.backendSdk = null;
		},
		(value) => {
			value.contributions.tools = [];
		},
		(value) => {
			value.contributions.tools = [{ name: 'fixture_status' }];
		},
	]) {
		const invalid = structuredClone(manifest);
		change(invalid);
		assert.throws(() => readAgentPluginManifest(invalid), InvalidAgentPayload);
	}
	const schema = {
		type: 'object',
		properties: { request: { type: 'string', enum: ['status'] } },
		required: ['request'],
		additionalProperties: false,
	};
	const registration = {
		kind: 'tool',
		key: 'test.schema.status',
		contract: 'test.schema',
		apiVersion: 1,
		summary: 'Inspect fixture status',
		instructions: '',
		inputSchemaJson: JSON.stringify(schema),
		resultSchemaJson: '{"type":"object"}',
		capabilities: ['plugin.invoke'],
		tags: [],
		execution: 'managed',
	};
	assert.deepEqual(readAgentPluginRegistration(registration), registration);
	const registry = new RegistryModel((error) => {
		throw error;
	});
	const provider = {
		userId: 1,
		appId: randomUUID(),
		instanceId: randomUUID(),
		generation: randomUUID(),
		configurationRevision: 0,
		packageRevision: 1,
		package: {
			packageId: manifest.id,
			version: manifest.version,
			packageHash: 'a'.repeat(64),
			publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		},
		namespaces: manifest.namespaces,
		appEntry: null,
		tools: true,
		services: false,
		capabilities: manifest.capabilities,
	};
	registry.publish(provider, [registration], null);

	const invalid = (error) =>
		error instanceof AgentFailure && ['invalid_input', 'capability_undeclared'].includes(error.code);

	for (const definition of [
		{ ...registration, contract: 'outside.namespace' },
		{ ...registration, capabilities: ['shell.execute'] },
		...[
			{ ...schema, required: ['missing'] },
			{ ...schema, properties: { request: { $ref: 'https://example.invalid/schema' } } },
			{ ...schema, required: ['request', 'request'] },
			{ ...schema, properties: { request: { type: 'string', enum: ['status', 'status'] } } },
			{ ...schema, properties: { request: { type: 'string', unknownKeyword: true } } },
		].map((value) => ({ ...registration, inputSchemaJson: JSON.stringify(value) })),
	])
		assert.throws(() => registry.publish(provider, [definition], provider.generation), invalid);
	assert.throws(() => registry.publish(provider, [registration, registration], provider.generation), invalid);
	const caller = {
		userId: provider.userId,
		appId: provider.appId,
		ownerId: randomUUID(),
		visibleInstanceIds: [provider.instanceId],
		visibleToolInstanceIds: [provider.instanceId],
		visibleToolKeys: null,
		capabilities: ['plugin.invoke'],
	};
	const entry = registry.discover(caller, { kind: 'tool', contract: null, apiVersion: null, cursor: null })
		.entries[0];
	const bound = registry.bind(caller, entry.id);
	assert.equal(registry.resolve(caller, bound.id, '{"request":"status"}').definition.key, registration.key);
	for (const input of ['{"request":"other"}', '{"extra":true}', '[]', 'null'])
		assert.throws(() => registry.resolve(caller, bound.id, input), invalid);
});
