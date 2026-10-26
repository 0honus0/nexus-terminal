import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, test } from '../../support/fixtures';

test('durable mutation claims and backup validation do not reject unrelated hosts at global capacity counts', async ({}, testInfo) => {
	test.setTimeout(120_000);
	const result = await promisify(execFile)(
		process.execPath,
		[path.resolve('tests/e2e/fixtures/remote/mutation-capacity.mjs'), testInfo.outputPath('mutation.db')],
		{ timeout: 90_000, maxBuffer: 1024 * 1024 },
	);
	expect(result.stdout).toContain(
		'Verified 4100 independent claims, snapshot integrity and endpoint conflict preservation',
	);
});
