import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'vitest';
import { captureWebServerOutput } from '../../../support/protocols/web-server-logs.ts';

test('server output stays complete in separate files without console duplication or shell path expansion', async () => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'webserver-evidence-'));
	const logs = join(root, "logs ' $(printf injected) `printf injected` &");
	for (const status of [0, 7]) {
		const command = captureWebServerOutput(
			`sh -c 'printf "stdout sample\\n"; printf "stderr sample\\n" >&2; exit ${status}'`,
			logs,
		);
		const result = spawnSync('sh', ['-c', command], { encoding: 'utf8' });
		assert.equal(result.status, status);
		assert.equal(result.stdout, '');
		assert.equal(result.stderr, '');
	}
	const directories = await readdir(logs);
	assert.equal(directories.length, 2);
	for (const directory of directories) {
		assert.equal(await readFile(join(logs, directory, 'output.log'), 'utf8'), 'stdout sample\nstderr sample\n');
	}
});

test('server capture preserves termination signals for the framework process owner', async () => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'webserver-signal-'));
	const result = spawnSync('sh', ['-c', captureWebServerOutput("sh -c 'kill -TERM $$'", root)]);
	assert.equal(result.status, null);
	assert.equal(result.signal, 'SIGTERM');
});
