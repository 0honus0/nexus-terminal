import assert from 'node:assert/strict';
import { groupPluginCatalogSources } from '../../packages/frontend/src/features/agent/settings/plugin-catalog-grouping';

const catalog = (repositoryUrl: string, appId: string) =>
  ({
    repositoryUrl,
    packages: [{ appId, displayName: appId }],
  }) as any;

const groups = groupPluginCatalogSources([
  { catalog: catalog('https://github.com/acme/catalog.json', 'github.app'), official: true },
  { catalog: catalog('https://gitlab.com/acme/catalog.json', 'gitlab.app'), official: false },
  { catalog: catalog('https://plugins.example.com/acme/catalog.json', 'custom.app'), official: false },
]);

assert.equal(groups.length, 3);
assert.deepEqual(
  groups.map((group) => group.owner),
  ['github.com/acme', 'gitlab.com/acme', 'plugins.example.com/acme'],
);
assert.equal(groups[0]?.official, true);
assert.equal(groups[1]?.official, false);
assert.equal(groups[2]?.official, false);
assert.equal(groups[0]?.sourceUrl, 'https://github.com/acme/catalog.json');
assert.equal(groups[1]?.sourceUrl, 'https://gitlab.com/acme/catalog.json');
assert.equal(groups[2]?.sourceUrl, 'https://plugins.example.com/acme/catalog.json');

const sameUrlDifferentProvenance = groupPluginCatalogSources([
  { catalog: catalog('https://github.com/acme/catalog.json', 'remote.app'), official: false },
  { catalog: catalog('https://github.com/acme/catalog.json', 'official.app'), official: true },
]);

assert.equal(sameUrlDifferentProvenance.length, 2);
assert.equal(sameUrlDifferentProvenance[0]?.official, false);
assert.equal(sameUrlDifferentProvenance[1]?.official, true);
assert.equal(sameUrlDifferentProvenance[0]?.packages[0]?.official, false);
assert.equal(sameUrlDifferentProvenance[1]?.packages[0]?.official, true);
assert.notEqual(sameUrlDifferentProvenance[0]?.key, sameUrlDifferentProvenance[1]?.key);

process.stdout.write('Plugin catalog provenance grouping regression: PASS\n');
