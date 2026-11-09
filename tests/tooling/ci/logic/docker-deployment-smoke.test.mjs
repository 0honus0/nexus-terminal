import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'vitest';

const execute = promisify(execFile);
const script = new URL('../../../../scripts/e2e/docker-deployment-smoke.sh', import.meta.url).pathname;

for (const failure of ['none', 'up', 'exec', 'down']) {
	test(`deployment smoke isolates its database and preserves evidence on ${failure}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'deployment-smoke-'));
		try {
			const bin = join(root, 'bin');
			const artifacts = join(root, 'artifacts');
			const calls = join(root, 'calls.jsonl');
			await mkdir(bin);
			await writeFile(
				join(bin, 'docker'),
				`#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const operation = args.find((arg) => ['config', 'up', 'exec', 'down', 'ps', 'logs'].includes(arg));
fs.appendFileSync(process.env.SMOKE_CALLS, JSON.stringify({ operation, data: process.env.NEXUS_DATA_DIR, image: process.env.NEXUS_IMAGE_REPOSITORY, profiles: process.env.COMPOSE_PROFILES }) + '\\n');
if (operation === 'config') console.log('frontend\\nbackend');
if (operation === 'up') fs.writeFileSync(path.join(process.env.NEXUS_DATA_DIR, 'nexus-terminal.db'), 'failure evidence');
if (operation === 'exec') process.stdin.resume();
if (operation === 'logs') console.log('retained container diagnostics');
if (operation === process.env.SMOKE_FAILURE) process.exit(42);
`,
				{ mode: 0o755 },
			);
			let result;
			let status = 0;
			try {
				result = await execute('bash', [script, 'fixture/nexus:smoke'], {
					env: {
						...process.env,
						PATH: bin + ':' + process.env.PATH,
						NEXUS_TEST_ARTIFACT_DIR: artifacts,
						NEXUS_DATA_DIR: join(root, 'external-data-do-not-touch'),
						NEXUS_IMAGE_REPOSITORY: 'external-image',
						COMPOSE_PROFILES: 'external-profile',
						SMOKE_CALLS: calls,
						SMOKE_FAILURE: failure,
					},
				});
			} catch (error) {
				status = error.code;
				result = error;
			}
			assert.equal(status, failure === 'none' ? 0 : 42, result.stderr);
			const commands = (await readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
			const workspace = join(commands[0].data, '..');
			assert.ok(workspace.startsWith(artifacts + '/work.'));
			assert.ok(commands.every((command) => command.image === 'fixture/nexus' && command.profiles === undefined));
			assert.ok(commands.some((command) => command.operation === 'down'));
			const report = await readFile(join(artifacts, 'diagnostics/result.txt'), 'utf8');
			assert.ok(report.includes(`cleanup_status=${failure === 'down' ? 42 : 0}`));
			if (failure === 'none') {
				assert.deepEqual(await readdir(artifacts), ['diagnostics']);
			} else {
				assert.equal(await readFile(join(workspace, 'data/nexus-terminal.db'), 'utf8'), 'failure evidence');
				assert.equal(
					await readFile(join(artifacts, 'diagnostics/compose.log'), 'utf8'),
					'retained container diagnostics\n',
				);
				assert.ok(result.stderr.includes('retained workspace:'));
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
