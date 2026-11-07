import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '../../../support/fixtures';

for (const [title, file] of [
	[
		'signed sandbox validates MessagePort identity, subscriptions and actual storage CAS',
		'backend/http/backend-next-plugin-browser.integration.mjs',
	],
	[
		'settings Surface preserves named refusals and uncertain mutation fences',
		'frontend/plugin-host-bridge.integration.mjs',
	],
	[
		'host execution editor preserves unknown-write and identity-revocation fences',
		'frontend/agent-execution.integration.mjs',
	],
	[
		'host Provider editor preserves credentials, original CAS and uncertain writes',
		'frontend/agent-provider.integration.mjs',
	],
	[
		'host registry refresh recovers by read without replaying uncertain writes',
		'frontend/agent-registry.integration.mjs',
	],
]) {
	test('SDK4 ' + title, async ({}, testInfo) => {
		test.setTimeout(120_000);
		const result = await promisify(execFile)(
			process.execPath,
			['--test', '--test-reporter=tap', path.resolve(__dirname, '../../../../' + file)],
			{ timeout: 90_000, maxBuffer: 4 * 1024 * 1024 },
		).catch(async (error: unknown) => {
			if (error instanceof Error) {
				for (const field of ['stdout', 'stderr'] as const) {
					const output: unknown = field in error ? error[field] : null;
					if (typeof output === 'string') {
						await testInfo.attach('sandbox-' + field, { body: output, contentType: 'text/plain' });
						console.error(output);
					}
				}
			}
			throw error;
		});
		expect(result.stdout).toMatch(/# fail 0(?:\r?\n|$)/);
		expect(result.stdout).toMatch(/# pass [1-9]\d*(?:\r?\n|$)/);
		expect(result.stdout).not.toMatch(/# cancelled [1-9]/);
	});
}
