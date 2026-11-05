import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../../support/fixtures';

for (const [name, file, pattern] of [
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
]) {
	test('Agent execution: ' + name, async ({}, testInfo) => {
		test.setTimeout(240_000);
		const result = await promisify(execFile)(
			process.execPath,
			[
				'--test',
				'--test-reporter=tap',
				'--test-name-pattern=' + pattern,
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
