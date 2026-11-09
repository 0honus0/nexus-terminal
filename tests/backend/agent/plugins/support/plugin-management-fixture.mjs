import { createTestAgentApp } from '../../runs/support/native-agent-fixture.mjs';
import { buildNativePluginPackage } from '../../../../support/native-plugin-package.mjs';
import { pinnedExecutionFixture } from '../../../../support/pinned-plugin-package.mjs';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openManagement } from '../../../../support/http/management-fixture.mjs';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

export async function openPlugins(registerClose) {
	const directory = await mkdtemp(
		join(process.env.NEXUS_TEST_ARTIFACT_DIR ?? tmpdir(), 'nexus-b10-plugin-contract-'),
	);
	let f;
	registerClose(async () => {
		const failures = [];
		for (const close of [() => f?.close()]) {
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
	const source = await createTestAgentApp(f.api, directory, 'package source', {
		signingKeyPath: keyPath,
		deterministic: true,
		selectedRootIds: [],
	});

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
		const id = options.definitionId ?? 'isolated.b10-' + label;
		const frontend = options.frontend !== false;
		const execution = options.modelApp ? await pinnedExecutionFixture() : {};
		const contributions = options.contributions ?? {
			app: execution.contribution?.app ?? {
				entry: id + '.run',
				uiContract: frontend ? id + '.ui' : null,
				uiApiVersion: frontend ? 1 : null,
			},
			tools: false,
			services: false,
			ui: frontend ? { contract: execution.contribution?.app?.uiContract ?? id + '.ui', apiVersion: 1 } : null,
			settings: execution.contribution?.settings ?? null,
			skills: execution.contribution?.skills ?? [],
		};
		const assets = { ...execution.assets };
		if (frontend) {
			assets['frontend/index.html'] =
				options.frontendMarkup ??
				'<!doctype html><title>plugin</title><script type="module" src="./client.mjs"></script>';
			assets['frontend/client.mjs'] = `import { connectNexusPlugin } from '/sdk/frontend-v4.mjs';
window.connectTask = connectNexusPlugin().then((sdk) => { window.sdk = sdk; return true; });
window.connectTask.catch((error) => { window.connectionError = error.message; });`;
		}
		for (const [name, bytes] of Object.entries(options.assets ?? {})) {
			assets['frontend/assets/' + name] = bytes;
		}
		const built = await buildNativePluginPackage(join(directory, randomUUID()), label, keyPath, {
			...execution,
			packageId: id,
			version: options.version ?? '1.0.0',
			requiredOnEnable: options.requiredOnEnable,
			contribution: contributions,
			capabilities: options.capabilities ?? ['plugin.invoke'],
			dependencies: options.dependencies ?? [],
			intents: options.intents ?? [],
			namespaces: options.namespaces ?? execution.namespaces ?? [id],
			frontendEntry: frontend ? 'frontend/index.html' : null,
			backend: options.backend ?? execution.backend,
			backendAssets: options.backendAssets,
			assets,
		});
		return built.bytes;
	}

	async function stage(label, options = {}) {
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
		return stage;
	}

	async function install(label, options = {}) {
		const verified = await stage(label, options);
		expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/packages/install', {
				stageId: verified.id,
				expectedVersion: verified.version,
			}),
			200,
		);
		const { binding } = expectStatus(
			await f.api('POST', '/api/v1/agent/plugins/apps/compose', {
				packageId: verified.manifest.id,
				selectedRootIds: options.selectedRootIds ?? [],
				uiPackageId: options.uiPackageId ?? (options.frontend === false ? null : verified.manifest.id),
			}),
			200,
		);
		const installation = expectStatus(await f.api('GET', '/api/v1/agent/plugins/installations'), 200).items.find(
			(item) => item.appId === binding.appId,
		);
		if (!installation) throw new Error('Expected App installation is missing');
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
		return { installation, stage: verified, appId: installation.appId, appPath, enabled, grants };
	}

	return {
		...f,
		directory,
		source,
		build,
		stage,
		publisher,
		install,
		upload,

		async packageInstallation(packageId) {
			const installation = expectStatus(
				await f.api('GET', '/api/v1/agent/plugins/packages'),
				200,
			).installations.find((item) => item.packageId === packageId);
			if (!installation) throw new Error('Expected package installation is missing');
			return installation;
		},
	};
}

/** Stop the package-upload App after the last upload when a test observes only plugin children. */
export async function stopPackageSource(f) {
	const path = '/api/v1/agent/apps/' + f.source.id;
	const app = expectStatus(await f.api('GET', path), 200);
	expectStatus(await f.api('PATCH', path, { expectedVersion: app.version, enabled: false }), 200);
}
