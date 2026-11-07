import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAgentPluginManifest } from '../../packages/shared/dist/agent/plugins/http-codec.js';

/** Reconstruct the original signed upstream archive without changing its package identity. */
export async function buildPinnedPluginPackage(directory, packageId) {
	const source = fileURLToPath(new URL('../e2e/fixtures/agent/plugin-source/' + packageId, import.meta.url));
	const provenanceName = {
		'nexus.agent': 'agent-app-provenance.json',
		'nexus.tools.remote': 'remote-tools-provenance.json',
		'nexus.tools.browser': 'browser-tools-provenance.json',
		'nexus.tools.integrations': 'integrations-tools-provenance.json',
		'nexus.tools.agent': 'agent-tools-provenance.json',
		'nexus.ui.chat': 'ui-chat-provenance.json',
		'nexus.services.mcp': 'mcp-service-provenance.json',
		'nexus.services.acp': 'acp-service-provenance.json',
	}[packageId];
	assert.ok(provenanceName, 'Pinned package must have recorded upstream provenance');
	const provenance = JSON.parse(
		await readFile(new URL('../e2e/fixtures/agent/' + provenanceName, import.meta.url), 'utf8'),
	);
	assert.equal(provenance.packageId, packageId);

	const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

	assert.equal(sha256(JSON.stringify(provenance.sourceFiles)), provenance.sourceFilesSha256);
	const prefix = 'plugins/' + packageId + '/';
	const expected = new Map(
		provenance.sourceFiles
			.filter(({ path }) => path.startsWith(prefix))
			.map(({ path, sha256 }) => [path.slice(prefix.length), sha256]),
	);
	assert.equal(expected.size, provenance.sourceFiles.length, 'Pinned hashes must be unique and package scoped');
	const visited = new Set();

	async function verify(directory, relative = '') {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = relative + entry.name;
			if (entry.isDirectory()) {
				await verify(join(directory, entry.name), path + '/');
				continue;
			}
			assert.ok(entry.isFile(), 'Pinned runtime input must be a regular file: ' + path);
			assert.ok(expected.has(path), 'Pinned runtime input lacks upstream hash: ' + path);
			assert.equal(
				sha256(await readFile(join(directory, entry.name))),
				expected.get(path),
				'Pinned upstream input changed: ' + path,
			);
			visited.add(path);
		}
	}

	await verify(source);
	for (const path of expected.keys()) {
		assert.ok(visited.has(path), 'Pinned upstream input is missing: ' + path);
	}
	assert.ok(visited.has('manifest.json'));
	const manifestBytes = await readFile(join(source, 'manifest.json'));
	const manifest = readAgentPluginManifest(JSON.parse(manifestBytes.toString('utf8')));
	assert.equal(manifest.id, packageId);
	assert.equal(manifest.schemaVersion, 4, 'Current fixtures require a separately pinned schema 4 build');
	if (packageId === 'nexus.agent') {
		assert.equal(manifest.compatibility.backendSdk, 4);
		assert.equal(manifest.contributions.app.entry, 'nexus.agent.run');
	}
	const upstream = provenance.upstreamSignedPackage;
	assert.equal(manifest.version, upstream.version);
	assert.deepEqual(manifest.compatibility, upstream.compatibility);
	const { publisher } = upstream;
	const publicKey = createPublicKey(publisher.publicKeyPem);
	assert.equal(publicKey.asymmetricKeyType, 'ed25519');
	assert.equal(publisher.keyId, 'ed25519:' + sha256(publicKey.export({ type: 'spki', format: 'der' })));
	assert.equal(publisher.keyId, upstream.publisherKeyId);
	const fileListBytes = await readFile(join(source, 'files.json'));
	const fileList = JSON.parse(fileListBytes.toString('utf8'));
	assert.equal(fileList.schemaVersion, 1);
	assert.equal(fileList.publisherKeyId, publisher.keyId);
	const payloadPaths = new Set(
		[...visited].filter((path) => !['manifest.json', 'files.json', 'signature.ed25519'].includes(path)),
	);
	for (const file of fileList.files) {
		assert.ok(payloadPaths.delete(file.path), 'Signed file list must match each pinned payload exactly once');
		const bytes = await readFile(join(source, file.path));
		assert.equal(bytes.length, file.sizeBytes);
		assert.equal(sha256(bytes), file.sha256);
	}
	assert.equal(payloadPaths.size, 0, 'Every pinned payload must be in the original signed file list');
	assert.ok(
		verifySignature(
			null,
			Buffer.concat([
				Buffer.from('NEXUS_AGENT_PLUGIN_V4\0', 'utf8'),
				manifestBytes,
				Buffer.from([0]),
				fileListBytes,
			]),
			publicKey,
			await readFile(join(source, 'signature.ed25519')),
		),
		'Pinned upstream signature must be valid',
	);
	await mkdir(directory, { recursive: true });
	const output = join(directory, packageId + '.tar');
	execFileSync('tar', [
		'--sort=name',
		'--mtime=@0',
		'--owner=0',
		'--group=0',
		'--numeric-owner',
		'--format=ustar',
		'-cf',
		output,
		'-C',
		source,
		'.',
	]);
	const bytes = await readFile(output);
	assert.equal(
		sha256(bytes),
		upstream.sha256,
		'Pinned archive must exactly reproduce the independently signed input',
	);
	assert.equal(bytes.length, upstream.sizeBytes);
	const metadata = {
		packageId: manifest.id,
		version: manifest.version,
		compatibility: manifest.compatibility,
		contributionKinds: [
			...(manifest.contributions.app ? ['app'] : []),
			...(manifest.contributions.tools ? ['tools'] : []),
			...(manifest.contributions.ui ? ['ui'] : []),
			...(manifest.contributions.services ? ['services'] : []),
			...(manifest.contributions.settings ? ['settings'] : []),
			...(manifest.contributions.skills.length ? ['skills'] : []),
		],
		displayName: manifest.displayName,
		publisherKeyId: publisher.keyId,
		publicKeyPem: publisher.publicKeyPem,
		sha256: upstream.sha256,
		sizeBytes: upstream.sizeBytes,
		output,
	};
	return { metadata, bytes };
}

export function packageDependency(metadata) {
	return {
		packageId: metadata.packageId,
		publisherKeyId: metadata.publisherKeyId,
		minVersion: metadata.version,
		maxVersion: metadata.version,
	};
}

/** Copy the real bundled App; callers explicitly choose its entry and namespaces. */
export async function pinnedExecutionFixture() {
	const source = fileURLToPath(new URL('../e2e/fixtures/agent/plugin-source/nexus.agent/', import.meta.url));
	const manifest = readAgentPluginManifest(JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8')));
	assert.equal(manifest.schemaVersion, 4);

	async function assets(directory, prefix) {
		const files = [];
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = prefix + entry.name;
			if (entry.isDirectory()) files.push(...(await assets(join(directory, entry.name), path + '/')));
			else files.push(path);
		}
		return files;
	}

	return {
		backend: await readFile(join(source, manifest.backendEntry), 'utf8'),
		namespaces: manifest.namespaces,
		contribution: manifest.contributions,
		assets: Object.fromEntries(
			await Promise.all(
				[
					'docs/settings.md',
					...(await assets(join(source, 'frontend'), 'frontend/')),
					...manifest.contributions.skills.map((entry) => entry.path),
				].map(async (path) => [path, await readFile(join(source, path))]),
			),
		),
	};
}
