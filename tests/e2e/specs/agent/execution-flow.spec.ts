import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../../support/fixtures';

for (const [name, file, pattern] of [
	['Docker targeted batch reads and lifecycle', 'http/backend-next-docker.integration.mjs', 'B10'],
	[
		'Browser per-session isolation and combined observations',
		'http/backend-next-agent-browser.integration.mjs',
		'B10',
	],
	['Browser resource cancellation and cleanup', 'storage/backend-next-browser-lifecycle.integration.mjs', 'Browser'],
	['file batches, UTF-8 paging and cursor integrity', 'http/backend-next-agent-files.integration.mjs', 'B10 Agent'],
	[
		'live Job output, yielding and mutation admission',
		'http/backend-next-agent-shell-yield.integration.mjs',
		'Shell yield',
	],
	[
		'collaboration authorization and event-driven joins',
		'http/backend-next-agent-collaboration.integration.mjs',
		'B10',
	],
	['ordered SQLite migrations, rollback and data preservation', 'storage/backend-next-phase2.integration.mjs', ''],
	[
		'resource expiration, confirmation and exact-session cleanup',
		'http/backend-next-agent-resources.integration.mjs',
		'Resource lifecycle:',
	],
	[
		'model outcomes, streamed prefixes and immutable instructions',
		'http/backend-next-agent-flow.integration.mjs',
		'Agent flow model outcomes',
	],
	[
		'signed plugin hooks, isolated tool RPC and approvals',
		'http/backend-next-agent-flow.integration.mjs',
		'Agent signed contribution',
	],
	[
		'parallel scheduling, exclusive barriers and cancellation drain',
		'http/backend-next-agent-scheduling.integration.mjs',
		'Agent',
	],
	[
		'file delivery streams, source failures and compound authorization',
		'remote/backend-next-file-delivery.integration.mjs',
		'File delivery',
	],
	[
		'Run resource reuse, concurrent isolation and lifecycle cleanup',
		'remote/backend-next-machine-reuse.integration.mjs',
		'Agent reuse:',
	],
]) {
	test('Agent execution: ' + name, async ({}, testInfo) => {
		test.setTimeout(240_000);
		const result = await promisify(execFile)(
			process.execPath,
			[
				'--test',
				'--test-reporter=tap',
				...(pattern ? ['--test-name-pattern=' + pattern] : []),
				path.resolve(__dirname, '../../../backend/' + file),
			],
			{ timeout: 210_000, maxBuffer: 4 * 1024 * 1024 },
		).catch(async (error: unknown) => {
			if (error instanceof Error) {
				const stdout = 'stdout' in error ? error.stdout : null;
				const stderr = 'stderr' in error ? error.stderr : null;
				if (typeof stdout === 'string') {
					await testInfo.attach('backend-test-stdout', { body: stdout, contentType: 'text/plain' });
					console.error(stdout);
				}
				if (typeof stderr === 'string') {
					await testInfo.attach('backend-test-stderr', { body: stderr, contentType: 'text/plain' });
					console.error(stderr);
				}
			}
			throw error;
		});
		expect(result.stdout).toMatch(/# fail 0(?:\r?\n|$)/);
		expect(result.stdout).toMatch(/# pass [1-9]\d*(?:\r?\n|$)/);
		expect(result.stdout).not.toMatch(/# cancelled [1-9]/);
	});
}
