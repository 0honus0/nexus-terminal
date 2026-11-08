import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import {
	readAgentRegistryStatus,
	readAgentRegistryResolveResponse,
} from '../../../../../packages/shared/dist/agent/providers/http-codec.js';

await test('installed Registry HTTP requires current authentication and preserves explicit empty facts', async (t) => {
	const directory = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'registry-http-'));
	const fixture = await openManagement(directory);
	t.after(() => fixture.close());
	const path = '/api/v1/agent/ai/model-registry';
	expectStatus(await fixture.anonymous('GET', path), 401);
	const status = readAgentRegistryStatus(expectStatus(await fixture.api('GET', path), 200));
	assert.equal(status.activeSource, 'unavailable');
	assert.equal(status.entryCount, 0);
	assert.equal(status.generatedAt, null);
	assert.equal(status.sourceUrl, 'https://models.dev/api.json?type=all');
	assert.equal(status.lastAttemptAt, null);
	const result = readAgentRegistryResolveResponse(
		expectStatus(await fixture.api('GET', path + '/resolve?modelId=fixture%2Fabsent'), 200),
	);
	assert.deepEqual(result, { modelId: 'fixture/absent', defaults: null });
	expectStatus(await fixture.api('POST', '/api/v1/auth/logout', {}), 200);
	expectStatus(await fixture.api('GET', path), 401);
});
