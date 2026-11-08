import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('../support/suspended-log-enospc-worker.mjs', import.meta.url));

await test('Isolated finite filesystem preserves confirmed suspended history', async (parent) => {
	// A namespace root cannot traverse a private home holding the toolchain.
	// Copy the exact binary once for this group's actual lifecycle.
	const runtime = await mkdtemp(join(tmpdir(), 'nexus-log-enospc-runtime-'));
	parent.after(() => rm(runtime, { recursive: true, force: true }));
	await copyFile(process.execPath, join(runtime, 'node'));

	for (const scenario of ['append', 'replace', 'trim', 'replace-cleanup', 'trim-cleanup']) {
		await parent.test(
			'A real isolated finite filesystem rejects suspended log ' + scenario + ' without losing confirmed history',
			async (t) => {
				const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-log-enospc-'));
				try {
					const volume = join(directory, 'volume');
					await mkdir(volume);
					await mkdir(join(directory, 'runtime/adapters'), { recursive: true });
					// The user namespace cannot traverse the user's private home. Copy the
					// exact built owner and its error dependency; no product code is rewritten.
					await copyFile(worker, join(directory, 'worker.mjs'));
					for (const name of ['adapters/local-suspended-log.js', 'terminal-errors.js']) {
						await copyFile(
							new URL(
								'../../../../../../packages/backend/dist/platform/terminal/' + name,
								import.meta.url,
							),
							join(directory, 'runtime', name),
						);
					}
					await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
					const { stdout } = await execute(
						'unshare',
						[
							'--user',
							'--map-root-user',
							'--mount',
							'--fork',
							'--kill-child=SIGKILL',
							join(runtime, 'node'),
							join(directory, 'worker.mjs'),
							volume,
							scenario,
						],
						{ cwd: directory, timeout: 20000, maxBuffer: 64 * 1024 },
					);
					const result = JSON.parse(stdout);
					assert.equal(result.scenario, scenario);
					assert.equal(result.code, 'ENOSPC');
					assert.equal(result.cleanupCalls, scenario.endsWith('-cleanup') ? 1 : 0);
					assert.equal(result.pinnedBytes, scenario.startsWith('trim') ? 100 * 1024 * 1024 : 26);
					t.diagnostic(JSON.stringify(result));
				} finally {
					await rm(directory, { recursive: true, force: true });
				}
			},
		);
	}
});
