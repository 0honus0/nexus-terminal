import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../../support/fixtures';

for (const [name, file, pattern] of [
	[
		'model outcomes, streamed prefixes and immutable instructions',
		'backend-next-agent-flow.integration.mjs',
		'Agent flow model outcomes',
	],
	[
		'signed plugin hooks, isolated tool RPC and approvals',
		'backend-next-agent-flow.integration.mjs',
		'Agent signed contribution',
	],
	[
		'parallel scheduling, exclusive barriers and cancellation drain',
		'backend-next-agent-scheduling.integration.mjs',
		'Agent',
	],
]) {
	test('Agent execution: ' + name, async () => {
		test.setTimeout(240_000);
		const result = await promisify(execFile)(
			process.execPath,
			[
				'--test',
				'--test-reporter=tap',
				'--test-name-pattern=' + pattern,
				path.resolve(__dirname, '../../../backend/http/' + file),
			],
			{ timeout: 210_000, maxBuffer: 4 * 1024 * 1024 },
		);
		expect(result.stdout).toMatch(/# fail 0(?:\r?\n|$)/);
		expect(result.stdout).toMatch(/# pass [1-9]\d*(?:\r?\n|$)/);
		expect(result.stdout).not.toMatch(/# cancelled [1-9]/);
	});
}
