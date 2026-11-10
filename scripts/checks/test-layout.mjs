import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const migration = JSON.parse(await readFile(resolve(root, 'tests/cases/migration.json'), 'utf8'));
const sources = new Set();
for (const record of migration.files) {
	assert.ok(!sources.has(record.source), 'Duplicate migration source: ' + record.source);
	sources.add(record.source);
	assert.match(record.sourceSha256, /^[a-f0-9]{64}$/u);
	assert.ok(record.targets.length > 0, 'Missing replacement owner: ' + record.source);
	for (const target of record.targets) {
		await access(resolve(root, target));
	}
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
}
for (const asset of migration.assets) {
	assert.match(asset.sourceSha256, /^[a-f0-9]{64}$/u);
	assert.ok(asset.targets.length > 0 || asset.externalTargets?.length > 0, 'Missing fixture owner: ' + asset.source);
	for (const target of asset.targets) {
		await access(resolve(root, target));
	}
}
console.log('Test migration sources and replacement owners verified: ' + sources.size);
