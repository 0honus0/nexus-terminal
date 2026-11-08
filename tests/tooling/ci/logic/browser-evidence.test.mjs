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

test('same-title cases in separate browser groups retain separate logs and retries', async (t) => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'browser-evidence-'));
	const previous = process.env.NEXUS_TEST_ARTIFACT_DIR;
	process.env.NEXUS_TEST_ARTIFACT_DIR = root;
	t.onTestFinished(() => {
		if (previous === undefined) delete process.env.NEXUS_TEST_ARTIFACT_DIR;
		else process.env.NEXUS_TEST_ARTIFACT_DIR = previous;
	});
	const testDir = join(root, 'specs');

	const makeCase = (id, group) => ({
		id,
		title: 'retains the actual connection state',

		titlePath: () => ['chromium', 'connections.spec.ts', group, 'retains the actual connection state'],

		location: { file: join(testDir, 'connections.spec.ts'), line: 1 },
		parent: { project: () => ({ name: 'chromium' }) },
	});

	const desktop = makeCase('desktop-case', 'desktop');
	const mobile = makeCase('mobile-case', 'mobile');
	const reporter = new MirroredLogReporter();
	reporter.onBegin({ projects: [{ testDir }], workers: 1 }, { allTests: () => [desktop, mobile] });
	reporter.onTestBegin(desktop, { retry: 0 });
	reporter.onStdOut('original desktop failure', desktop);
	reporter.onTestBegin(mobile, { retry: 0 });
	reporter.onStdOut('mobile result', mobile);
	reporter.onTestBegin(desktop, { retry: 1 });
	reporter.onStdOut('desktop diagnostic retry', desktop);
	const [run] = await readdir(join(root, 'logs'));
	const caseRoot = join(root, 'logs', run, 'connections.spec');
	const files = await readdir(caseRoot);
	assert.equal(files.length, 3);
	const contents = await Promise.all(files.map((name) => readFile(join(caseRoot, name), 'utf8')));
	for (const marker of ['original desktop failure', 'mobile result', 'desktop diagnostic retry']) {
		assert.equal(contents.filter((content) => content.includes(marker)).length, 1);
	}
	assert.equal(contents.filter((content) => content.includes('retry: 1')).length, 1);
});
