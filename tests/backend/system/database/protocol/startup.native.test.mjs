import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';
import { readAccessNeedsSetup } from '../../../../../packages/shared/dist/access/http.js';

async function openDatabase(t) {
	const root = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(root, { recursive: true });
	const directory = await mkdtemp(join(root, 'schema-startup-'));
	const started = performance.now();
	const f = await openManagement(directory);
	const timing = { setupMs: performance.now() - started, executeMs: null, drainMs: null };
	const executing = performance.now();
	t.after(async () => {
		timing.executeMs = performance.now() - executing;
		const draining = performance.now();
		try {
			await f.close();
		} finally {
			timing.drainMs = performance.now() - draining;
			await writeFile(join(directory, 'timings.json'), JSON.stringify(timing, null, 2));
		}
	});
	return { ...f, directory };
}

test('Current schema initializes a clean database through the normal application startup', async (t) => {
	const f = await openDatabase(t);
	assert.equal(
		readAccessNeedsSetup(expectStatus(await f.api('GET', '/api/v1/auth/needs-setup'), 200)).needsSetup,
		false,
	);
});
