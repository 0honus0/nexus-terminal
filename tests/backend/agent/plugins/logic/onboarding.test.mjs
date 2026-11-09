import { test, expect } from 'vitest';
import {
	requiredPluginCompositions,
	requiredPluginSelection,
} from '../../../../../packages/backend/src/modules/agent/plugins/plugin-onboarding-rules.ts';
import { readAgentPluginManifest } from '../../../../../packages/shared/src/agent/plugins/http-codec.ts';

const publisherKeyId = 'ed25519:' + 'a'.repeat(64);

function manifest(id, role, contract = 'example.chat') {
	return readAgentPluginManifest({
		schemaVersion: 4,
		id,
		version: '1.0.0',
		displayName: id,
		requiredOnEnable: true,
		compatibility: {
			host: { minVersion: '1.0.0', maxVersion: '1.99.99' },
			backendSdk: role === 'ui' ? null : 4,
			frontendSdk: role === 'ui' ? 4 : null,
		},
		capabilities: [],
		intents: [],
		frontendEntry: role === 'ui' ? 'frontend/index.html' : null,
		backendEntry: role === 'ui' ? null : 'backend/index.mjs',
		contributions: {
			app: role === 'app' ? { entry: id + '.run', uiContract: contract, uiApiVersion: 1 } : null,
			tools: role === 'tools',
			services: role === 'services',
			ui: role === 'ui' ? { contract, apiVersion: 1 } : null,
			settings: null,
			skills: [],
		},
		dependencies: [],
		namespaces: role === 'ui' ? [] : [id],
	});
}

function candidate(manifest) {
	return {
		manifest,
		package: { packageId: manifest.id, version: manifest.version, publisherKeyId, packageHash: 'b'.repeat(64) },
	};
}

test('generic required contributions compose apps, roots and UI independently of names', () => {
	const manifests = [
		manifest('thirdparty.app', 'app'),
		manifest('thirdparty.ui', 'ui'),
		manifest('thirdparty.tools', 'tools'),
		manifest('thirdparty.service', 'services'),
	];
	const [composition] = requiredPluginCompositions(manifests, manifests.map(candidate), []);
	expect(composition.packageId).toBe('thirdparty.app');
	expect(composition.uiPackageId).toBe('thirdparty.ui');
	expect(composition.selectedRootIds).toEqual(['thirdparty.tools', 'thirdparty.service']);
	expect(composition.expectedPackages.map((item) => item.packageId).sort()).toEqual(
		manifests.map((item) => item.id).sort(),
	);
	expect(composition.appId).toBeNull();
});

test('existing compatible UI and optional roots survive required package association', () => {
	const app = manifest('example.app', 'app');
	const requiredUi = manifest('example.required-ui', 'ui');
	const optionalUi = manifest('example.selected-ui', 'ui');
	const binding = {
		appId: 'existing',
		executionRevision: 4,
		uiRevision: 8,
		app: candidate(app).package,
		ui: candidate(optionalUi).package,
		selectedRootIds: ['example.optional'],
		dependencies: [],
	};
	expect(requiredPluginSelection(app, [app, requiredUi], [app, requiredUi, optionalUi], binding)).toEqual({
		selectedRootIds: ['example.optional'],
		uiPackageId: optionalUi.id,
	});
});

test('missing or ambiguous UI providers reject the composition; matching contracts allow multiple distinct Apps', () => {
	const first = manifest('example.first', 'app');
	const ui = manifest('example.ui', 'ui');
	expect(() => requiredPluginCompositions([first], [candidate(first)], [])).toThrow();
	const otherUi = manifest('example.other-ui', 'ui');
	expect(() => requiredPluginCompositions([first, ui, otherUi], [first, ui, otherUi].map(candidate), [])).toThrow();
	const second = manifest('example.second', 'app', 'example.other');
	const secondUi = manifest('example.second-ui', 'ui', 'example.other');
	const required = [first, ui, second, secondUi];
	expect(requiredPluginCompositions(required, required.map(candidate), []).map((item) => item.uiPackageId)).toEqual([
		ui.id,
		secondUi.id,
	]);
});
