import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST_HARNESS_API_VERSION } from '../../tests/support/plugins/artifact-contract.mjs';

const directories = [
	'packages/backend/dist',
	'packages/backend/dist-plugin-sdk',
	'packages/shared/dist',
	'packages/frontend/dist',
];

async function fingerprint(root) {
	const files = [];

	async function visit(directory) {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else {
				assert.ok(entry.isFile(), 'Host builds must contain only regular files: ' + path);
				files.push({
					path: relative(root, path).split('\\').join('/'),
					sha256: createHash('sha256')
						.update(await readFile(path))
						.digest('hex'),
				});
			}
		}
	}

	for (const directory of directories) {
		const before = files.length;
		await visit(join(root, directory));
		assert.ok(files.length > before, 'Empty Host build: ' + directory);
	}
	return files;
}

export async function writeHostArtifact({ root, revision }) {
	assert.match(revision, /^[a-f0-9]{40}$/);
	const manifest = {
		schemaVersion: 1,
		revision,
		harnessApiVersion: HOST_HARNESS_API_VERSION,
		node: process.versions.node,
		files: await fingerprint(root),
	};
	await writeFile(join(root, 'packages/host-test-artifact.json'), JSON.stringify(manifest, null, 2) + '\n');
	return manifest;
}

export async function verifyHostArtifact({ root, revision }) {
	const manifest = JSON.parse(await readFile(join(root, 'packages/host-test-artifact.json'), 'utf8'));
	assert.equal(manifest.schemaVersion, 1, 'Unsupported Host build artifact');
	assert.equal(manifest.revision, revision, 'Host source and build revisions differ');
	assert.equal(manifest.harnessApiVersion, HOST_HARNESS_API_VERSION, 'Host harness contract differs');
	assert.equal(manifest.node, process.versions.node, 'Host build and test Node versions differ');
	assert.deepEqual(manifest.files, await fingerprint(root), 'Host build content differs from the immutable artifact');
	return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	const [command, revision] = process.argv.slice(2);
	const root = resolve(import.meta.dirname, '../..');
	if (command === 'write') await writeHostArtifact({ root, revision });
	else if (command === 'verify') await verifyHostArtifact({ root, revision });
	else throw new Error('Usage: node scripts/e2e/host-test-artifact.mjs <write|verify> <source-sha>');
}
