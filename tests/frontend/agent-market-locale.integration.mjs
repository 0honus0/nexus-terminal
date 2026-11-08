import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAgentPluginCatalogEntry } from '../../packages/shared/dist/agent/plugins/repository-http-codec.js';
import { fromPluginCatalogEntry } from '../../packages/frontend/src/features/agent/plugins/model/plugin-mapper.ts';
import { localizeCatalogEntry } from '../../packages/frontend/src/features/agent/plugins/model/plugin-market-rules.ts';

const original = {
	packageId: 'third.party',
	version: '1.0.0',
	compatibility: { host: { minVersion: '1.0.0', maxVersion: '1.99.99' }, backendSdk: 4, frontendSdk: null },
	contributionKinds: ['tools'],
	displayName: 'Original title',
	description: 'Original description',
	packageUrl: 'https://example.test/package.tar',
	sha256: 'a'.repeat(64),
	sizeBytes: 1024,
	publisherKeyId: 'ed25519:' + 'b'.repeat(64),
	compatible: true,
	compatibilityReason: null,
};
const localizations = [
	{ locale: 'zh-cn', displayName: '翻译标题', description: '浏览器说明' },
	{ locale: 'ja', displayName: '名前', description: '説明' },
];

await test('Plugin catalog translations follow exact locale and language fallbacks without changing identity', () => {
	const wire = readAgentPluginCatalogEntry({ ...original, localizations });
	assert.equal(wire.localizations[0].locale, 'zh-CN');
	const entry = fromPluginCatalogEntry(wire);
	for (const locale of ['zh-CN', 'zh-HK']) {
		assert.deepEqual(localizeCatalogEntry(entry, locale), { displayName: '翻译标题', description: '浏览器说明' });
	}
	assert.deepEqual(localizeCatalogEntry(entry, 'ja-JP'), { displayName: '名前', description: '説明' });
	assert.deepEqual(localizeCatalogEntry(entry, 'fr-FR'), {
		displayName: original.displayName,
		description: original.description,
	});
	assert.deepEqual(localizeCatalogEntry(fromPluginCatalogEntry(readAgentPluginCatalogEntry(original)), 'zh-CN'), {
		displayName: original.displayName,
		description: original.description,
	});
	assert.equal(entry.definitionId, original.packageId);
	assert.equal(entry.sha256, original.sha256);
	assert.notEqual(entry.localizations, wire.localizations);
	const exact = {
		...entry,
		localizations: [
			...entry.localizations,
			{ locale: 'zh-HK', displayName: 'Exact', description: 'Exact description' },
		],
	};
	assert.equal(localizeCatalogEntry(exact, 'zh-HK').displayName, 'Exact');
});

await test('Plugin catalog locale decoding rejects duplicate canonical tags, malformed tags and nested extra fields', () => {
	for (const translations of [
		[localizations[0], { ...localizations[0], locale: 'zh-CN' }],
		[{ ...localizations[0], locale: 'not a locale' }],
		[{ ...localizations[0], url: 'https://untrusted.test/' }],
		[{ locale: 'en-US', displayName: 'missing description' }],
		null,
	]) {
		assert.throws(() => readAgentPluginCatalogEntry({ ...original, localizations: translations }));
	}
});
