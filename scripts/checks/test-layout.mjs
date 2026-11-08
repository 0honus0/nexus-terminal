import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const migration = JSON.parse(await readFile(resolve(root, 'tests/cases/migration.json'), 'utf8'));
const sources = new Set();
const pluginRoot = process.env.NEXUS_TEST_PLUGIN_SOURCE_ROOT;
let externalTargets = 0;

async function verifyExternalOwners(record) {
	for (const external of record.externalTargets ?? []) {
		assert.equal(external.repository, '0honus0/nexus-agent-plugins', 'Unknown test responsibility repository');
		assert.ok(external.targets.length > 0, 'Missing external replacement owner: ' + record.source);
		for (const target of external.targets) {
			assert.ok(
				typeof target === 'string' &&
					((target.startsWith('plugins/') && target.includes('/tests/')) ||
						target.startsWith('tests/interoperability/') ||
						target.startsWith('tests/e2e/')),
			);
			assert.ok(!target.split('/').includes('..'), 'Replacement must stay in its plugin repository');
			if (pluginRoot) await access(resolve(pluginRoot, target));
			externalTargets++;
		}
	}
}

for (const record of migration.files) {
	assert.ok(!sources.has(record.source), 'Duplicate migration source: ' + record.source);
	sources.add(record.source);
	assert.match(record.sourceSha256, /^[a-f0-9]{64}$/u);
	assert.ok(
		record.targets.length > 0 || record.externalTargets?.length > 0,
		'Missing replacement owner: ' + record.source,
	);
	for (const target of record.targets) {
		await access(resolve(root, target));
	}
	await verifyExternalOwners(record);
}
for (const scenario of migration.unwrappedScenarios) {
	const targets = scenario.targets ?? (scenario.target ? [scenario.target] : []);
	assert.ok(
		targets.length > 0 || scenario.externalTargets?.length > 0,
		'Missing unwrapped scenario: ' + scenario.name,
	);
	for (const target of targets) {
		await access(resolve(root, target));
	}
	await verifyExternalOwners(scenario);
}
for (const asset of migration.assets) {
	assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/u);
	assert.ok(asset.targets.length > 0 || asset.externalTargets?.length > 0, 'Missing fixture owner: ' + asset.source);
	for (const target of asset.targets) {
		await access(resolve(root, target));
	}
	await verifyExternalOwners(asset);
}
console.log('Test migration sources and replacement owners verified: ' + sources.size);
if (externalTargets) {
	console.log(
		'Plugin replacement owners: ' + externalTargets + (pluginRoot ? ' verified' : ' (source root not supplied)'),
	);
}
