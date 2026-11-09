import { test, expect } from 'vitest';
import { readAgentPluginManifest } from '../../../../packages/shared/src/agent/plugins/http-codec.ts';
import { readAgentPluginCatalogIndex } from '../../../../packages/shared/src/agent/plugins/repository-http-codec.ts';
import {
	readAgentPluginEnablePlan,
	readAgentPluginEnableRequest,
} from '../../../../packages/shared/src/agent/plugins/onboarding-codec.ts';

const manifest = {
	schemaVersion: 4,
	id: 'example.ui',
	version: '1.0.0',
	displayName: 'UI',
	compatibility: { host: { minVersion: '1.0.0', maxVersion: '1.99.99' }, backendSdk: null, frontendSdk: 4 },
	capabilities: [],
	intents: [],
	frontendEntry: 'frontend/index.html',
	backendEntry: null,
	contributions: {
		app: null,
		tools: false,
		services: false,
		ui: { contract: 'example.ui', apiVersion: 1 },
		settings: null,
		skills: [],
	},
	dependencies: [],
	namespaces: [],
};
const publisherKeyId = 'ed25519:' + 'a'.repeat(64);
const entry = {
	packageId: manifest.id,
	version: manifest.version,
	compatibility: manifest.compatibility,
	contributionKinds: ['ui'],
	displayName: 'UI',
	description: 'Chat interface',
	packageUrl: 'https://example.test/ui.tar',
	sha256: 'b'.repeat(64),
	sizeBytes: 1,
	publisherKeyId,
};

for (const value of [undefined, false, true]) {
	test(`requiredOnEnable is optional opt-in metadata, preserving ${value}`, () => {
		const signed = structuredClone(manifest);
		const catalogEntry = structuredClone(entry);
		if (value !== undefined) {
			signed.requiredOnEnable = value;
			catalogEntry.requiredOnEnable = value;
		}
		expect(readAgentPluginManifest(signed).requiredOnEnable).toBe(value);
		expect(
			readAgentPluginCatalogIndex({
				schemaVersion: 2,
				publishers: [{ keyId: publisherKeyId, label: 'Test', publicKeyPem: 'test key' }],
				packages: [catalogEntry],
			}).packages[0].requiredOnEnable,
		).toBe(value);
	});
}

test('required flags cannot be strings, numbers, or null', () => {
	for (const requiredOnEnable of ['true', 1, null])
		expect(() => readAgentPluginManifest({ ...manifest, requiredOnEnable })).toThrow();
});

test('an empty or incomplete enable plan cannot claim readiness', () => {
	expect(() => readAgentPluginEnablePlan({ packages: [], bindings: [], ready: true })).toThrow();
	const installation = { ...entry, status: 'installed', revision: 1, createdAt: 1, updatedAt: 1 };
	delete installation.description;
	delete installation.packageUrl;
	delete installation.sha256;
	delete installation.sizeBytes;
	delete installation.compatibility;
	delete installation.contributionKinds;
	delete installation.displayName;
	installation.packageHash = 'b'.repeat(64);
	expect(() =>
		readAgentPluginEnablePlan({
			packages: [{ kind: 'installed', installation, manifest: { ...manifest, requiredOnEnable: false } }],
			bindings: [],
			ready: true,
		}),
	).toThrow();
});

test('enable requests reject duplicated packages, bindings and normal-market grant escalation', () => {
	const installed = {
		kind: 'installed',
		expectedRevision: 1,
		package: { packageId: 'example.ui', version: '1.0.0', packageHash: 'b'.repeat(64), publisherKeyId },
	};
	expect(() => readAgentPluginEnableRequest({ packages: [installed, installed], bindings: [] })).toThrow();
	expect(readAgentPluginEnableRequest({ packages: [installed], bindings: [] }).packages).toHaveLength(1);
});
