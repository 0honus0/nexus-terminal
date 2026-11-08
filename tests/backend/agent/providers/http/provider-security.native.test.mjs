import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readAgentProviderView,
	readAgentProviderTestResponse,
} from '../../../../../packages/shared/dist/agent/providers/http-codec.js';

await test('Provider source rejection preserves current state and image policy rejection never retries', async (t) => {
	const calls = new Map();
	const failures = [];
	const server = createServer((request, response) => {
		const work = (async () => {
			assert.equal(request.url, '/v1/images/generations');
			assert.equal(request.headers.authorization, 'Bearer private-test-key');
			const chunks = [];
			for await (const bytes of request) chunks.push(bytes);
			const { model } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			calls.set(model, (calls.get(model) ?? 0) + 1);
			response.writeHead(400, { 'Content-Type': 'application/json' });
			response.end(
				JSON.stringify({
					error: {
						code: model === 'image-moderation' ? 'moderation_blocked' : 'content_policy_violation',
						message: 'E2E_PRIVATE_VENDOR_BODY',
						type: 'invalid_request_error',
					},
				}),
			);
		})();
		work.catch((error) => {
			failures.push(error);
			response.destroy();
		});
	});
	t.after(async () => {
		await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		if (failures.length) throw new AggregateError(failures, 'Provider protocol peer failed');
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'provider-security-'));
	const host = await openManagement(directory);
	t.after(() => host.close());
	for (const modelId of ['image-moderation', 'image-policy']) {
		await t.test(modelId, async () => {
			const provider = readAgentProviderView(
				expectStatus(
					await host.api('POST', '/api/v1/agent/ai/providers', {
						kind: 'openai-compatible',
						displayName: modelId,
						baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1',
						protocol: 'images',
						models: [{ id: modelId, supportsTools: false, supportsImageGeneration: true }],
						enabled: true,
						credential: 'private-test-key',
					}),
					201,
				),
			);
			const path = '/api/v1/agent/ai/providers/' + provider.id;
			for (const headers of [
				{ Origin: 'https://cross-origin.invalid' },
				{ Origin: host.origin, 'Sec-Fetch-Site': 'cross-site' },
			]) {
				assert.deepEqual(
					expectStatus(
						await host.api(
							'PATCH',
							path,
							{
								expectedVersion: provider.version,
								displayName: 'Must not save',
							},
							headers,
						),
						403,
					),
					{ code: 'csrf_rejected' },
				);
			}
			const current = readAgentProviderView(expectStatus(await host.api('GET', path), 200));
			assert.equal(current.version, provider.version);
			assert.equal(current.displayName, provider.displayName);
			assert.equal(calls.size, modelId === 'image-moderation' ? 0 : 1);
			const result = readAgentProviderTestResponse(
				expectStatus(await host.api('POST', path + '/test', { modelId }), 200),
			);
			assert.equal(result.ok, false);
			assert.equal(result.errorCode, 'PROVIDER_CONTENT_FILTERED');
			assert.ok(!JSON.stringify(result).includes('E2E_PRIVATE_VENDOR_BODY'));
			assert.equal(calls.get(modelId), 1);
		});
	}
});
