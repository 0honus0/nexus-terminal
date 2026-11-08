import assert from 'node:assert/strict';
import { test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeHostArtifact, verifyHostArtifact } from '../../../../scripts/e2e/host-test-artifact.mjs';

// Actual files prove that missing, mixed and modified builds fail before plugin code runs.
test('Host artifact binds exact source, runtime and every delivered build file', async () => {
	const root = await mkdtemp(join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'host-artifact-'));
	const revision = 'a'.repeat(40);
	for (const path of ['backend/dist', 'backend/dist-plugin-sdk', 'shared/dist', 'frontend/dist']) {
		await mkdir(join(root, 'packages', path), { recursive: true });
		await writeFile(join(root, 'packages', path, 'entry.mjs'), 'export const value = "exact";\n');
	}
	const manifest = await writeHostArtifact({ root, revision });
	assert.equal(manifest.files.length, 4);
	assert.deepEqual(await verifyHostArtifact({ root, revision }), manifest);
	await assert.rejects(verifyHostArtifact({ root, revision: 'b'.repeat(40) }), /revisions differ/);
	await writeFile(join(root, 'packages/shared/dist/entry.mjs'), 'export const value = "changed";\n');
	await assert.rejects(verifyHostArtifact({ root, revision }), /content differs/);
	await writeFile(join(root, 'packages/shared/dist/entry.mjs'), 'export const value = "exact";\n');
	await writeFile(join(root, 'packages/backend/dist/unexpected.mjs'), 'extra module');
	await assert.rejects(verifyHostArtifact({ root, revision }), /content differs/);
	await rm(join(root, 'packages/backend/dist/unexpected.mjs'));
	await rm(join(root, 'packages/frontend/dist/entry.mjs'));
	await assert.rejects(verifyHostArtifact({ root, revision }), /Empty Host build/);
	await writeFile(join(root, 'packages/frontend/dist/entry.mjs'), 'export const value = "exact";\n');
	await writeFile(
		join(root, 'packages/host-test-artifact.json'),
		JSON.stringify({ ...manifest, node: 'other-runtime' }),
	);
	await assert.rejects(verifyHostArtifact({ root, revision }), /Node versions differ/);
});
