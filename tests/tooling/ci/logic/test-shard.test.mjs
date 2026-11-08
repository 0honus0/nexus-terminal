import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { expect, test } from 'vitest';

async function fixture(mode) {
	const root = await mkdtemp(join(tmpdir(), 'test-shard-'));
	for (const directory of ['scripts/e2e', 'tests/backend', 'tests/tooling', 'plugins', 'bin', 'artifacts']) {
		await mkdir(join(root, directory), { recursive: true });
	}
	for (const file of ['run-test-shard.sh', 'measure-command.sh']) {
		await copyFile(new URL('../../../../scripts/e2e/' + file, import.meta.url), join(root, 'scripts/e2e', file));
	}
	for (const file of ['one.native.test.mjs', 'two.native.test.mjs']) {
		await writeFile(join(root, 'tests/backend', file), '');
	}
	const worker = join(root, 'worker.mjs');
	await writeFile(
		worker,
		`import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.env.TEST_SHARD_ROOT;
const args = process.argv.slice(2);
const phase = args.includes('--test-concurrency=2') ? 'native'
  : args.includes('test:modules') ? 'modules'
  : args.includes('test:browser') ? 'plugin-browser'
  : args.includes('--test') ? 'interop' : 'host-browser';
const record = (event) => fs.appendFileSync(root + '/events', phase + ':' + event + '\\n');
record('start');
if (phase === 'host-browser' && process.env.NEXUS_TEST_PLUGIN_SET !== undefined) throw Error('Candidate environment leaked into generic Host tests');
if (['interop', 'plugin-browser'].includes(phase) && process.env.NEXUS_TEST_PLUGIN_SET !== 'exact-candidate') throw Error('Plugin tests lost their pinned candidate');
if (phase === 'native' || phase === 'modules') {
  process.on('SIGTERM', () => { record('terminated'); process.exit(143); });
  fs.writeFileSync(root + '/' + phase + '-ready', String(process.pid));
  const other = phase === 'native' ? 'modules' : 'native';
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(root + '/' + other + '-ready')) {
    if (Date.now() > deadline) throw Error('The other independent lane never started');
    await delay(10);
  }
  if (process.env.TEST_SHARD_MODE === 'cancel') await new Promise(() => setInterval(() => {}, 1000));
}
record('end');
if (phase === 'native' && process.env.TEST_SHARD_MODE === 'failure') process.exitCode = 7;
`,
	);
	// Keep GNU time and the measured shell intact; only replace expensive framework commands.
	await writeFile(
		join(root, 'bin/node'),
		'#!/usr/bin/env bash\nif [[ "$1" == --input-type=module ]]; then exec "$TEST_SHARD_NODE" "$@"; fi\nexec "$TEST_SHARD_NODE" "$TEST_SHARD_WORKER" "$@"\n',
		{ mode: 0o755 },
	);
	await writeFile(
		join(root, 'bin/pnpm'),
		'#!/usr/bin/env bash\nexec "$TEST_SHARD_NODE" "$TEST_SHARD_WORKER" "$@"\n',
		{
			mode: 0o755,
		},
	);
	const child = spawn('bash', [join(root, 'scripts/e2e/run-test-shard.sh'), '2', '2'], {
		env: {
			...process.env,
			PATH: join(root, 'bin') + ':' + process.env.PATH,
			TEST_SHARD_ROOT: root,
			TEST_SHARD_NODE: process.execPath,
			TEST_SHARD_WORKER: worker,
			TEST_SHARD_MODE: mode,
			NEXUS_TEST_ARTIFACT_DIR: join(root, 'artifacts'),
			NEXUS_TEST_PLUGIN_SOURCE_ROOT: join(root, 'plugins'),
			NEXUS_TEST_PLUGIN_SET: 'exact-candidate',
			NEXUS_TEST_DOCKER_NATIVE: 'excluded-docker',
			NEXUS_TEST_FINITE_FS_NATIVE: 'excluded-filesystem',
		},
		stdio: ['ignore', 'pipe', 'pipe'],
	});
	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));
	child.stderr.on('data', (chunk) => (output += chunk));
	const done = new Promise((resolve, reject) => {
		child.once('error', reject);
		child.once('close', (code, signal) => resolve({ code, signal, output }));
	});
	return { root, child, done };
}

test.each(['success', 'failure'])('independent test lanes retain every layer and the %s result', async (mode) => {
	const f = await fixture(mode);
	const result = await f.done;
	assert.equal(result.code, mode === 'failure' ? 1 : 0, result.output);
	const events = (await readFile(join(f.root, 'events'), 'utf8')).trim().split('\n');
	for (const phase of ['native', 'modules', 'host-browser', 'interop', 'plugin-browser']) {
		assert.ok(events.includes(phase + ':end'), phase);
	}
	assert.ok(events.indexOf('native:start') < events.indexOf('modules:end'));
	assert.ok(events.indexOf('modules:start') < events.indexOf('native:end'));
	assert.ok(events.indexOf('host-browser:end') < events.indexOf('plugin-browser:start'));
	const native = JSON.parse(await readFile(join(f.root, 'artifacts/metrics/native.json'), 'utf8'));
	assert.equal(native.exit_code, mode === 'failure' ? 7 : 0);
	assert.ok(native.max_process_rss_kib > 0);
});

test('cancelling a shard signals both independent process groups and waits for their exit', async () => {
	const f = await fixture('cancel');
	try {
		await assertEventually(async () => {
			await readFile(join(f.root, 'native-ready'));
			await readFile(join(f.root, 'modules-ready'));
		});
		f.child.kill('SIGTERM');
		const result = await f.done;
		assert.equal(result.code, 143, result.output);
		const events = await readFile(join(f.root, 'events'), 'utf8');
		assert.match(events, /native:terminated/);
		assert.match(events, /modules:terminated/);
		for (const phase of ['native', 'modules']) {
			const pid = Number(await readFile(join(f.root, phase + '-ready'), 'utf8'));
			await expect
				.poll(() => {
					assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
				})
				.toBeUndefined();
		}
	} finally {
		if (f.child.exitCode === null) f.child.kill('SIGTERM');
		await f.done;
	}
});

async function assertEventually(assertion) {
	await expect.poll(assertion, { timeout: 5000 }).toBeUndefined();
}

test('resource measurement preserves nonzero and signal termination status in valid JSON', async () => {
	const root = await mkdtemp(join(tmpdir(), 'test-metrics-'));
	for (const [command, status] of [
		['exit 7', 7],
		['kill -TERM $$', 143],
	]) {
		const report = join(root, String(status) + '.json');
		const result = spawnSync(
			'bash',
			[
				fileURLToPath(new URL('../../../../scripts/e2e/measure-command.sh', import.meta.url)),
				report,
				'bash',
				'-c',
				command,
			],
			{ encoding: 'utf8' },
		);
		assert.equal(result.status, status, result.stderr);
		const metrics = JSON.parse(await readFile(report, 'utf8'));
		assert.equal(metrics.exit_code, status);
		assert.ok(metrics.max_process_rss_kib > 0);
	}
});
