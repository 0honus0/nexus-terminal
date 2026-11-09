import { expect, test } from 'vitest';
import { mergePluginCatalogs } from '../../../../packages/frontend/src/features/agent/plugins/model/plugin-market-rules.ts';

function source(url, publisher, versions = ['1.0.0']) {
	return {
		source: url,
		catalog: {
			repositoryUrl: url ?? 'https://official.test/catalog.json',
			publishers: [],
			packages: versions.map((version) => ({
				definitionId: 'example.tools',
				publisherKeyId: publisher,
				version,
				sha256: publisher + version,
				compatible: true,
			})),
		},
	};
}

test('same plugin and version across sources has one card and distinct exact source choices', () => {
	const sources = [source(null, 'official'), source('https://third.test/catalog.json', 'third')];
	const [group] = mergePluginCatalogs(sources, [], [], new Map());
	expect(group.options).toHaveLength(2);
	expect(new Set(group.options.map((option) => option.key)).size).toBe(2);
	expect(group.selected.source).toBeNull();
	const selected = new Map([[group.id, group.options[1].key]]);
	const [changed] = mergePluginCatalogs(sources, [], [], selected);
	expect(changed.selected.source).toBe('https://third.test/catalog.json');
	expect(changed.selected.entry.publisherKeyId).toBe('third');
	expect(changed.selected.entry.sha256).toBe('third1.0.0');
	expect(mergePluginCatalogs(sources, [], [], selected)).toHaveLength(1);
});

test('installed publisher stays selected even when a newer official alternative exists', () => {
	const sources = [
		source(null, 'official', ['9.0.0']),
		source('https://third.test/catalog.json', 'third', ['1.0.0', '2.0.0']),
	];
	const [group] = mergePluginCatalogs(
		sources,
		[{ packageId: 'example.tools', publisherKeyId: 'third', status: 'installed' }],
		[],
		new Map(),
	);
	expect(group.selected.entry.publisherKeyId).toBe('third');
	expect(group.selected.entry.version).toBe('2.0.0');
});

test('removed sources invalidate explicit choices and prereleases still require consent', () => {
	const sources = [source(null, 'official'), source('https://third.test/catalog.json', 'third', ['2.0.0-beta.1'])];
	const [group] = mergePluginCatalogs(sources, [], [], new Map());
	const preview = group.options.find((option) => option.source !== null);
	const explicit = new Map([[group.id, preview.key]]);
	expect(mergePluginCatalogs(sources, [], [], explicit)[0].needsVersionChoice).toBe(false);
	expect(mergePluginCatalogs([sources[0]], [], [], explicit)[0].selected.source).toBeNull();
	expect(mergePluginCatalogs([sources[1]], [], [], new Map())[0].needsVersionChoice).toBe(true);
});

test('dependency compatibility and signer remain part of recommendation, without deleting alternatives', () => {
	const sources = [source(null, 'official', ['1.0.0', '2.0.0'])];
	const requirements = [
		{ packageId: 'example.tools', publisherKeyId: 'official', minVersion: '1.0.0', maxVersion: '1.0.0' },
	];
	const [group] = mergePluginCatalogs(sources, [], requirements, new Map());
	expect(group.selected.entry.version).toBe('1.0.0');
	expect(group.options).toHaveLength(2);
});
