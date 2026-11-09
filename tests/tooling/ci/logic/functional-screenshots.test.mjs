import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'vitest';

const execute = promisify(execFile);

for (const fail of [false, true]) {
	test(`manual screenshots preserve earlier artifacts and ${fail ? 'leave canonical images on failure' : 'replace canonical images after success'}`, async () => {
		const root = await mkdtemp(join(tmpdir(), 'functional-screenshots-'));
		try {
			const support = join(root, 'tests/e2e/support');
			const bin = join(root, 'tests/node_modules/.bin');
			const canonical = join(root, 'doc/imgs/e2e');
			const artifacts = join(root, 'artifacts');
			for (const directory of [support, bin, canonical, join(artifacts, 'previous-failure')]) {
				await mkdir(directory, { recursive: true });
			}
			const script = join(support, 'run-functional-screenshots.mjs');
			await copyFile(new URL('../../../e2e/support/run-functional-screenshots.mjs', import.meta.url), script);
			await writeFile(join(canonical, 'old.png'), 'original image');
			await writeFile(join(canonical, 'README.md'), 'keep documentation');
			await writeFile(join(artifacts, 'previous-failure/trace.zip'), 'previous evidence');
			await writeFile(
				join(bin, 'playwright'),
				`#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync(path.join(process.env.NEXUS_TEST_ARTIFACT_DIR, 'report.json'), 'current report');
fs.writeFileSync(path.join(process.env.E2E_SCREENSHOT_OUTPUT_DIR, 'current.png'), 'current screenshot');
process.exit(process.env.SCREENSHOT_FAILURE === '1' ? 7 : 0);
`,
				{ mode: 0o755 },
			);
			let status = 0;
			try {
				await execute(process.execPath, [script], {
					env: { ...process.env, NEXUS_TEST_ARTIFACT_DIR: artifacts, SCREENSHOT_FAILURE: fail ? '1' : '0' },
				});
			} catch (error) {
				status = error.code;
			}
			assert.equal(status, fail ? 7 : 0);
			assert.equal(await readFile(join(artifacts, 'previous-failure/trace.zip'), 'utf8'), 'previous evidence');
			const runs = (await readdir(artifacts)).filter((name) => name.startsWith('run-'));
			assert.equal(runs.length, 1);
			assert.equal(await readFile(join(artifacts, runs[0], 'report.json'), 'utf8'), 'current report');
			assert.equal(
				await readFile(join(artifacts, runs[0], 'screenshots/current.png'), 'utf8'),
				'current screenshot',
			);
			assert.equal(await readFile(join(canonical, 'README.md'), 'utf8'), 'keep documentation');
			assert.deepEqual((await readdir(canonical)).sort(), ['README.md', fail ? 'old.png' : 'current.png']);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
}
