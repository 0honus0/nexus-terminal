import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openManagement } from './management-fixture.mjs';
import { expectStatus } from '../remote/openssh-fixture.mjs';

export async function openPlugins(t) {
	const directory = await mkdtemp(join(tmpdir(), 'nexus-b10-plugin-contract-'));
	let f;
	t.after(async () => {
		const failures = [];
		for (const close of [() => f?.close(), () => rm(directory, { recursive: true, force: true })]) {
			try {
				await close();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length) {
			throw new AggregateError(failures, 'Plugin fixture cleanup failed');
		}
	});
	f = await openManagement(directory);
	const { privateKey, publicKey } = generateKeyPairSync('ed25519');
	const keyPath = join(directory, 'key.pem');
	await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
	const publisher = expectStatus(
		await f.api('POST', '/api/v1/agent/plugins/publishers', {
			label: 'isolated contract signer',
			publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
		}),
		200,
	);
	const source = expectStatus(await f.api('POST', '/api/v1/agent/apps', { name: 'package source' }), 201);

	async function upload(appId, bytes, name = 'plugin.tar') {
		const base = '/api/v1/agent/apps/' + appId + '/artifacts';
		let artifact = expectStatus(
			await f.api('POST', base, {
				name,
				mediaType: 'application/octet-stream',
				declaredBytes: bytes.length,
			}),
			201,
		).artifact;
		artifact = expectStatus(
			await f.api('PUT', base + '/' + artifact.id + '/content', bytes, {
				'Content-Type': 'application/octet-stream',
				'If-Match': '"' + artifact.version + '"',
			}),
			200,
		).artifact;
		return artifact;
	}

	async function build(label, options = {}) {
		const sourcePath = join(directory, randomUUID());
		await mkdir(join(sourcePath, 'frontend'), { recursive: true });
		await writeFile(
			join(sourcePath, 'manifest.json'),
			JSON.stringify({
				schemaVersion: 1,
				id: options.definitionId ?? 'isolated.b10-' + label,
				version: options.version ?? '1.0.0',
				displayName: label,
				sdkVersion: '1',
				capabilities: options.capabilities ?? [],
				intents: options.intents ?? [],
				frontendEntry: 'frontend/index.html',
				backendEntry: options.backend ? 'backend/main.mjs' : null,
			}),
		);
		await writeFile(
			join(sourcePath, 'frontend/index.html'),
			'<!doctype html><title>plugin</title><script type="module" src="./client.mjs"></script>',
		);
		await writeFile(
			join(sourcePath, 'frontend/client.mjs'),
			`import { connectNexusPlugin } from '/sdk/frontend-v1.mjs';
window.connectTask = connectNexusPlugin().then((sdk) => { window.sdk = sdk; return true; });
window.connectTask.catch((error) => { window.connectionError = error.message; });`,
		);
		if (options.backend) {
			await mkdir(join(sourcePath, 'backend'));
			await writeFile(join(sourcePath, 'backend/main.mjs'), options.backend);
		}
		const archivePath = join(directory, randomUUID() + '.tar');
		execFileSync(
			process.execPath,
			[
				fileURLToPath(new URL('../../e2e/fixtures/agent/build-plugin-package.mjs', import.meta.url)),
				sourcePath,
				archivePath,
				keyPath,
			],
			{ stdio: 'pipe' },
		);
		return readFile(archivePath);
	}

	async function install(label, options = {}) {
		const artifact = await upload(source.id, await build(label, options));
		let stage = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/stage', {
				artifactAppId: source.id,
				artifactId: artifact.id,
				expectedVersion: artifact.version,
			}),
			200,
		);
		stage = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/verify', { stageId: stage.id, expectedVersion: stage.version }),
			200,
		);
		const installation = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/install', { stageId: stage.id, expectedVersion: stage.version }),
			200,
		);
		const appPath = '/api/v1/agent/apps/' + installation.appId;

		async function enabled(value) {
			const app = expectStatus(await f.api('GET', appPath), 200);
			return expectStatus(await f.api('PATCH', appPath, { expectedVersion: app.version, enabled: value }), 200);
		}

		async function grants(capabilities) {
			const current = expectStatus(await f.api('GET', appPath + '/grants'), 200);
			return expectStatus(
				await f.api('PUT', appPath + '/grants', {
					expectedPolicyRevision: current.policyRevision,
					grants: capabilities.map((capability) => ({ capability, scope: { kind: 'global' } })),
				}),
				200,
			);
		}

		if (options.enabled !== false) {
			await enabled(true);
		}
		return { installation, appId: installation.appId, appPath, enabled, grants };
	}

	return { ...f, build, publisher, install, upload };
}
