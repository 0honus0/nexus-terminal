import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';

test('duration CLI discovers TypeScript and ESM browser specs, removes retired entries and rejects unknown receipts', async () => {
	const artifactRoot = process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir();
	await mkdir(artifactRoot, { recursive: true });
	const root = await mkdtemp(join(artifactRoot, 'duration-cli-'));
	const scriptRoot = join(root, 'scripts/e2e');
	const specsRoot = join(root, 'tests/e2e/specs');
	const inputRoot = join(root, 'timings/shard-1');
	await Promise.all([scriptRoot, specsRoot, inputRoot].map((path) => mkdir(path, { recursive: true })));
	const script = join(scriptRoot, 'update-duration-estimates.mjs');
	// Execute the unchanged CLI bytes in its real relative repository layout.
	await copyFile(new URL('../../../../scripts/e2e/update-duration-estimates.mjs', import.meta.url), script);
	await writeFile(join(specsRoot, 'normal.spec.ts'), '');
	await writeFile(join(specsRoot, 'sdk.spec.mjs'), '');
	await writeFile(join(specsRoot, 'ordinary.test.mjs'), '');
	const estimates = join(scriptRoot, 'duration-estimates.json');
	await writeFile(estimates, JSON.stringify({ version: 1, specs: { 'specs/retired.spec.ts': 50 } }));
	const observed = { version: 1, specs: { 'specs/normal.spec.ts': 1234, 'specs/sdk.spec.mjs': 5678 } };
	const receipt = join(inputRoot, 'spec-durations.json');
	await writeFile(receipt, JSON.stringify(observed));
	const result = spawnSync(process.execPath, [script, '--input', join(root, 'timings')], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /observed 2 specs/);
	assert.deepEqual(JSON.parse(await readFile(estimates, 'utf8')), observed);
	const saved = await readFile(estimates, 'utf8');
	await writeFile(receipt, JSON.stringify({ version: 1, specs: { 'specs/unknown.spec.mjs': 10 } }));
	const rejected = spawnSync(process.execPath, [script, '--input', join(root, 'timings')], { encoding: 'utf8' });
	assert.equal(rejected.status, 1);
	assert.match(rejected.stderr, /Timing artifact references unknown spec: specs\/unknown\.spec\.mjs/);
	assert.equal(await readFile(estimates, 'utf8'), saved);
});
