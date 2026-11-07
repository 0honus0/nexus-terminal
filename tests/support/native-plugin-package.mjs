import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_CAPABILITIES } from '../../packages/shared/dist/agent/governance/values.js';

/** Signed native-surface fixture; no host declaration or test-only product API. */
export async function buildNativePluginPackage(directory, name, signingKeyPath, extension = {}) {
	const id = extension.packageId ?? 'test.native-' + randomUUID();
	const version = extension.version ?? '1.0.0';
	const source = join(directory, extension.version ? id + '-' + version : id);
	await mkdir(source, { recursive: true });
	const keyPath = signingKeyPath ?? join(source, 'publisher.pem');
	if (!signingKeyPath) {
		const { privateKey } = generateKeyPairSync('ed25519');
		await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
	}
	// Keep the signing key outside the package source.
	const content = join(source, 'content');
	await mkdir(content);
	if (extension.sourcePackage) {
		await cp(extension.sourcePackage, content, { recursive: true });
		const manifest = JSON.parse(await readFile(join(content, 'manifest.json'), 'utf8'));
		manifest.id = id;
		manifest.version = version;
		manifest.displayName = name;
		manifest.dependencies = extension.dependencies ?? [];
		manifest.contributions.skills = manifest.contributions.skills.map((skill) => ({
			id: id + '.' + skill.path.split('/')[1],
			path: skill.path,
		}));
		await writeFile(join(content, 'manifest.json'), JSON.stringify(manifest));
		await Promise.all(['files.json', 'signature.ed25519'].map((name) => rm(join(content, name))));
		const output = join(source, 'plugin.tar');
		const metadata = JSON.parse(
			execFileSync(
				process.execPath,
				[
					fileURLToPath(new URL('../e2e/fixtures/agent/build-plugin-package.mjs', import.meta.url)),
					content,
					output,
					keyPath,
				],
				{ encoding: 'utf8' },
			),
		);
		return { metadata, bytes: await readFile(output), signingKeyPath: keyPath };
	}
	const contribution = structuredClone(
		extension.contribution ?? {
			app: { entry: id + '.run', uiContract: null, uiApiVersion: null },
			tools: false,
			services: false,
			ui: null,
			settings: null,
			skills: extension.skill ? [{ id: 'flow', path: 'skills/flow/SKILL.md' }] : [],
		},
	);
	const defaultBackend = `import { definePlugin } from './sdk.mjs';
export default definePlugin((plugin) => plugin.register({ kind: 'app', key: ${JSON.stringify(contribution.app?.entry ?? id + '.run')},
contract: ${JSON.stringify(id)}, apiVersion: 1, summary: 'Deterministic test App', instructions: 'Complete the submitted task without a model.',
inputSchemaJson: '{"type":"object"}', resultSchemaJson: '{"type":"object"}', capabilities: [], tags: [], execution: 'managed' },
async (input, context) => {
 const info = await context.run.describe();
 const text = JSON.stringify({ prompt: info.prompt, input });
 await context.run.append({ key: 'answer', index: 0, text });
 return { kind: 'complete', outputs: [await context.content.put('output', text, 'text/plain')] };
}));`;
	const backend = extension.backend ?? (contribution.app !== null ? defaultBackend : null);
	contribution.skills = contribution.skills.map((entry) => ({ ...entry, id: id + '.' + entry.path.split('/')[1] }));
	await writeFile(
		join(content, 'manifest.json'),
		JSON.stringify({
			schemaVersion: 4,
			id,
			version,
			displayName: name,
			compatibility: {
				host: { minVersion: '1.0.0', maxVersion: '1.99.99' },
				backendSdk: backend ? 4 : null,
				frontendSdk: contribution.settings?.frontendEntry || extension.frontendEntry ? 4 : null,
			},
			dependencies: extension.dependencies ?? [],
			contributions: contribution,
			capabilities: [...(extension.capabilities ?? AGENT_CAPABILITIES)],
			intents: [],
			frontendEntry: extension.frontendEntry ?? null,
			backendEntry: backend ? 'backend/index.mjs' : null,
			namespaces: extension.namespaces ?? [id],
		}),
	);
	for (const [name, bytes] of Object.entries(extension.assets ?? {})) {
		if (name.startsWith('/') || name.split('/').some((part) => !part || part === '..' || part === '.')) {
			throw new Error('Invalid fixture asset');
		}
		await mkdir(join(content, name, '..'), { recursive: true });
		await writeFile(join(content, name), bytes);
	}
	if (extension.settingsFrontend) {
		await mkdir(join(content, 'settings'), { recursive: true });
		await writeFile(join(content, 'settings/index.html'), extension.settingsFrontend);
	}
	if (backend) {
		await mkdir(join(content, 'backend'));
		await writeFile(join(content, 'backend', 'index.mjs'), backend);
		if (backend === defaultBackend) {
			await writeFile(
				join(content, 'backend', 'sdk.mjs'),
				await readFile(new URL('../../packages/backend/dist-plugin-sdk/backend-v4.mjs', import.meta.url)),
			);
		}
		for (const [name, bytes] of Object.entries(extension.backendAssets ?? {})) {
			if (!/^[a-zA-Z0-9._-]+\.mjs$/u.test(name) || name === 'index.mjs')
				throw new Error('Invalid fixture backend asset');
			await writeFile(join(content, 'backend', name), bytes);
		}
		if (extension.executionProvenance) {
			await writeFile(join(content, 'fixture-provenance.json'), JSON.stringify(extension.executionProvenance));
		}
	}
	if (extension.skill) {
		await mkdir(join(content, 'skills', 'flow'), { recursive: true });
		await writeFile(join(content, 'skills', 'flow', 'SKILL.md'), extension.skill);
	}
	const output = join(source, 'plugin.tar');
	const metadata = JSON.parse(
		execFileSync(
			process.execPath,
			[
				fileURLToPath(new URL('../e2e/fixtures/agent/build-plugin-package.mjs', import.meta.url)),
				content,
				output,
				keyPath,
			],
			{ encoding: 'utf8' },
		),
	);
	return { metadata, bytes: await readFile(output), signingKeyPath: keyPath };
}
