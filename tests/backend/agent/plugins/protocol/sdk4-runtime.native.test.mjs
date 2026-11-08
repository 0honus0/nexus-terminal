import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NativePluginBackendRuntime } from '../../../../../packages/backend/dist/modules/agent/plugins/adapters/runtime/plugin-backend-runtime.js';
import { PluginCallableRefusal } from '../../../../../packages/backend/dist/modules/agent/plugins/storage/plugin-runtime.js';
import { NodeModuleRuntime } from '../../../../../packages/backend/dist/platform/isolation/adapters/node-module-runtime.js';

await test('SDK4 isolation publishes registrations, preserves typed refusal, and releases with no capabilities', async (t) => {
	const root = process.env.NEXUS_AGENT_ACCEPTANCE_ROOT ?? tmpdir();
	const directory = await mkdtemp(join(root, 'isolated-sdk4-'));
	const modules = new NodeModuleRuntime(directory);
	await modules.recover();
	const sdk = await readFile(
		new URL('../../../../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url),
	);
	const source = Buffer.from(`import { definePlugin } from './sdk.mjs';
export default definePlugin((plugin) => plugin.register({ kind: 'app', key: 'test.refusal.run', contract: 'test.refusal', apiVersion: 1,
summary: 'Refusal test', instructions: '', inputSchemaJson: '{"type":"object"}', resultSchemaJson: '{"type":"object"}', capabilities: [], tags: [], execution: 'managed' },
async (_input, context) => { await context.run.describe(); return { kind: 'complete', outputs: [] }; }));`);
	const appId = randomUUID();
	const instance = await new NativePluginBackendRuntime(modules).open({
		appId,
		instanceId: appId,
		generation: randomUUID(),
		definitionId: 'test.refusal',
		version: '1.0.0',
		packageHash: 'a'.repeat(64),
		publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		configurationRevision: 0,
		entry: 'main.mjs',
		files: [
			{ path: 'main.mjs', bytes: source, sha256: createHash('sha256').update(source).digest('hex') },
			{ path: 'sdk.mjs', bytes: sdk, sha256: createHash('sha256').update(sdk).digest('hex') },
		],
	});
	t.after(() => instance.close());
	assert.equal((await instance.activate())[0].key, 'test.refusal.run');
	const runId = randomUUID();
	const input = {
		key: 'test.refusal.run',
		argumentsJson: '{}',
		scope: { kind: 'run', runId, operationId: null, deadlineUnixMs: Date.now() + 60000 },
	};
	await assert.rejects(
		instance.invokeCallable(input, new AbortController().signal, 60000, async () => ({
			ok: false,
			code: 'forbidden',
		})),
		(error) => error instanceof PluginCallableRefusal && error.code === 'forbidden',
	);
	assert.equal(await instance.health(), true, 'A typed refusal must leave the incarnation usable');
	await instance.releaseResources(runId, Date.now() + 60000);
	assert.equal(await instance.health(), true);
});
