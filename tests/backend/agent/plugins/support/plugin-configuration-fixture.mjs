import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expectStatus } from '../../../../support/protocols/openssh-fixture.mjs';

export async function pluginConfiguration(api, appId, packageId) {
	const base = '/api/v1/agent/plugins/apps/' + appId + '/instances';
	const instance = expectStatus(await api('GET', base), 200).instances.find(
		(item) => item.packageId === packageId && item.selected,
	);
	assert.ok(instance, 'Selected plugin instance must exist');
	const path = base + '/' + instance.id + '/configuration';
	return { path, current: expectStatus(await api('GET', path), 200) };
}

export async function writePluginConfiguration(api, appId, packageId, document) {
	const { path, current } = await pluginConfiguration(api, appId, packageId);
	assert.ok(current.settings, 'Plugin must contribute its real configuration schema');
	return expectStatus(
		await api('PUT', path, {
			operationKey: randomUUID(),
			expectedPackageRevision: current.packageRevision,
			expectedRevision: current.configuration.revision,
			schemaRevision: current.settings.schemaRevision,
			documentJson: JSON.stringify(document),
		}),
		200,
	).configuration;
}
