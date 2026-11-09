import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Read exact development archives; installation still performs production signature validation. */
export async function loadCandidatePackages(directory) {
	const origin = JSON.parse(await readFile(join(directory, 'validation-origin.json'), 'utf8'));
	const catalog = JSON.parse(await readFile(join(directory, 'catalog.json'), 'utf8'));
	assert.equal(origin.official, false, 'Candidates must use a development signing key');
	const packages = [];
	for (const source of origin.sourceVersions) {
		const version = `${source.version}-dev.${origin.stagingGeneration}`;
		const entry = catalog.packages.find((item) => item.packageId === source.packageId && item.version === version);
		assert.ok(entry, 'Missing exact candidate: ' + source.packageId);
		assert.equal(entry.publisherKeyId, origin.publisherKeyId);
		const publisher = catalog.publishers.find((item) => item.keyId === entry.publisherKeyId);
		assert.ok(publisher);
		assert.match(entry.packageId, /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u);
		assert.match(version, /^[a-zA-Z0-9.+-]+$/u);
		const packageName = `${entry.packageId}-${version}.tar`;
		const bytes = await readFile(join(directory, packageName));
		assert.equal(bytes.length, entry.sizeBytes);
		assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
		packages.push({
			bytes,
			packageName,
			description: entry.description,
			localizations: entry.localizations,
			metadata: {
				packageId: entry.packageId,
				version,
				compatibility: entry.compatibility,
				contributionKinds: entry.contributionKinds,
				requiredOnEnable: entry.requiredOnEnable,
				displayName: entry.displayName,
				publisherKeyId: entry.publisherKeyId,
				publicKeyPem: publisher.publicKeyPem,
				sha256: entry.sha256,
				sizeBytes: entry.sizeBytes,
			},
		});
	}
	assert.equal(new Set(packages.map(({ metadata }) => metadata.packageId)).size, packages.length);
	assert.ok(packages.length > 0, 'Candidate set must not be empty');
	return { packages, origin };
}
