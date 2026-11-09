import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, test } from 'vitest';
import { getRunnerImageInfo } from '../../../../scripts/e2e/runner-image-info.mjs';

const roots = [];
const execute = promisify(execFile);
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'runner-inputs-'));
	roots.push(root);
	for (const name of [
		'.node-version',
		'.dockerignore',
		'package.json',
		'pnpm-lock.yaml',
		'pnpm-workspace.yaml',
		'packages/backend/package.json',
		'packages/shared/package.json',
		'packages/frontend/package.json',
		'tests/package.json',
		'tests/fixtures/runner/Dockerfile',
		'scripts/e2e/build-runner-image.sh',
		'scripts/e2e/runner-image-info.mjs',
		'scripts/patches/nested/ssh.patch',
		'packages/frontend/vendor/rdp/sdk.tgz',
	]) {
		await mkdir(join(root, name, '..'), { recursive: true });
		await writeFile(join(root, name), 'input: ' + name);
	}
	await writeFile(join(root, '.node-version'), '26.0.0\n');
	await writeFile(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.0.0' }));
	await writeFile(
		join(root, 'tests/package.json'),
		JSON.stringify({ devDependencies: { '@playwright/test': '1.60.0' } }),
	);
	return root;
}

test('runner content identity survives weekly refresh while the cache tag changes', async () => {
	const root = await fixture();
	const week = 7 * 24 * 60 * 60 * 1000;
	const before = getRunnerImageInfo({ root, now: week - 1 });
	const after = getRunnerImageInfo({ root, now: week });
	assert.equal(before.fingerprint, after.fingerprint);
	assert.notEqual(before.tag, after.tag);
	assert.equal(before.node, '26.0.0');
	assert.equal(before.pnpm, '12.0.0');
	assert.equal(before.playwright, '1.60.0');
	assert.match(before.tag, new RegExp('^cache-0-' + before.fingerprint + '$'));
});

test('every copied input, nested patch and vendored SDK invalidates the runner cache', async () => {
	const root = await fixture();
	const original = getRunnerImageInfo({ root, now: 0 });
	for (const name of [
		'.dockerignore',
		'pnpm-lock.yaml',
		'tests/fixtures/runner/Dockerfile',
		'scripts/patches/nested/ssh.patch',
		'packages/frontend/vendor/rdp/sdk.tgz',
	]) {
		const content = await readFile(join(root, name));
		await writeFile(join(root, name), 'changed');
		assert.notEqual(getRunnerImageInfo({ root, now: 0 }).fingerprint, original.fingerprint, name);
		await writeFile(join(root, name), content);
	}
	await writeFile(join(root, 'unrelated.md'), 'documentation');
	assert.deepEqual(getRunnerImageInfo({ root, now: 0 }), original);
});

test('the real build script retains the resolved tag and publishes latest only as an alias', async () => {
	const root = await fixture();
	for (const name of ['build-runner-image.sh', 'runner-image-info.mjs']) {
		await copyFile(new URL('../../../../scripts/e2e/' + name, import.meta.url), join(root, 'scripts/e2e', name));
	}
	await mkdir(join(root, 'bin'));
	const calls = join(root, 'docker-calls.jsonl');
	await writeFile(
		join(root, 'bin/docker'),
		`#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(process.env.RUNNER_DOCKER_CALLS, JSON.stringify(process.argv.slice(2)) + '\\n');
`,
		{ mode: 0o755 },
	);
	await execute('git', ['init', '--quiet', root]);
	await execute('git', ['-C', root, 'add', '.']);
	await execute('git', [
		'-C',
		root,
		'-c',
		'user.name=Test',
		'-c',
		'user.email=test@example.invalid',
		'commit',
		'--quiet',
		'-m',
		'fixture',
	]);
	const frozenTag = getRunnerImageInfo({ root, now: 0 }).tag;
	const image = 'ghcr.io/fixture/nexus-terminal-e2e-runner';
	await execute('bash', [join(root, 'scripts/e2e/build-runner-image.sh'), '--image', image], {
		env: {
			...process.env,
			PATH: join(root, 'bin') + ':' + process.env.PATH,
			RUNNER_DOCKER_CALLS: calls,
			E2E_RUNNER_TAG: frozenTag,
		},
	});
	const commands = (await readFile(calls, 'utf8'))
		.trim()
		.split('\n')
		.map((line) => JSON.parse(line));
	assert.ok(commands[0].includes(image + ':' + frozenTag));
	assert.ok(commands[0].includes(image + ':latest'));
	assert.deepEqual(
		commands.filter((args) => args[0] === 'push'),
		[
			['push', image + ':' + frozenTag],
			['push', image + ':latest'],
		],
	);
});
