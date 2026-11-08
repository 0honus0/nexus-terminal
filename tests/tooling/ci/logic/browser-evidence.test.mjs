import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import MirroredLogReporter from '../../../e2e/support/mirrored-log-reporter.ts';

test('starting another browser run preserves previous evidence and creates a separate log owner', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'browser-evidence-'));
	const previous = process.env.NEXUS_TEST_ARTIFACT_DIR;
	process.env.NEXUS_TEST_ARTIFACT_DIR = root;
	t.onTestFinished(() => {
		if (previous === undefined) delete process.env.NEXUS_TEST_ARTIFACT_DIR;
		else process.env.NEXUS_TEST_ARTIFACT_DIR = previous;
	});
	await mkdir(join(root, 'logs'));
	await writeFile(join(root, 'logs/first-failure.log'), 'original failure evidence');
	const config = { projects: [{ testDir: join(root, 'specs') }], workers: 1 };
	const suite = { allTests: () => [] };
	new MirroredLogReporter().onBegin(config, suite);
	const first = await readdir(join(root, 'logs'));
	new MirroredLogReporter().onBegin(config, suite);
	const second = await readdir(join(root, 'logs'));
	assert.equal(await readFile(join(root, 'logs/first-failure.log'), 'utf8'), 'original failure evidence');
	assert.equal(first.filter((name) => name.startsWith('run-')).length, 1);
	assert.equal(second.filter((name) => name.startsWith('run-')).length, 2);
	assert.ok(first.every((name) => second.includes(name)));
});
