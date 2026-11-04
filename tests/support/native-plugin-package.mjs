import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_CAPABILITIES } from '../../packages/shared/dist/agent/governance/values.js';

/** Signed native-surface fixture; no host declaration or test-only product API. */
export async function buildNativePluginPackage(directory, name, signingKeyPath, extension = {}) {
	const id = 'test.native-' + randomUUID();
	const source = join(directory, id);
	await mkdir(source, { recursive: true });
	const keyPath = signingKeyPath ?? join(source, 'publisher.pem');
	if (!signingKeyPath) {
		const { privateKey } = generateKeyPairSync('ed25519');
		await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
	}
	// Keep the signing key outside the package source.
	const content = join(source, 'content');
	await mkdir(content);
	await writeFile(
		join(content, 'manifest.json'),
		JSON.stringify({
			schemaVersion: 1,
			id,
			version: '1.0.0',
			displayName: name,
			sdkVersion: '1',
			capabilities: [...AGENT_CAPABILITIES],
			intents: [],
			frontendEntry: null,
			backendEntry: extension.backend ? 'backend.mjs' : null,
		}),
	);
	if (extension.contribution) {
		await writeFile(join(content, 'agent.json'), JSON.stringify(extension.contribution));
	}
	if (extension.backend) {
		await writeFile(join(content, 'backend.mjs'), extension.backend);
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
	return { metadata, bytes: await readFile(output) };
}
