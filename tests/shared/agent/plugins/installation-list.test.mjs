import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { readAgentPluginInstallationList } from '../../../../packages/shared/src/agent/plugins/http-codec.ts';

function installation(status = 'installed') {
	return {
		appId: randomUUID(),
		definitionId: 'example.app',
		version: '1.0.0',
		packageHash: 'a'.repeat(64),
		publisherKeyId: 'ed25519:' + 'b'.repeat(64),
		status,
		revision: 1,
		createdAt: 100,
		updatedAt: 100,
	};
}

test('one package can have multiple distinct App installations and retained owners', () => {
	const first = installation();
	const second = installation('removed');
	const list = { items: [first, second], retainedAppIds: [second.appId] };
	expect(readAgentPluginInstallationList(list)).toEqual(list);
	expect(() => readAgentPluginInstallationList({ items: [first, first], retainedAppIds: [] })).toThrow();
	expect(() => readAgentPluginInstallationList({ items: [first], retainedAppIds: [second.appId] })).toThrow();
	expect(() => readAgentPluginInstallationList({ ...list, retainedAppIds: [second.appId, second.appId] })).toThrow();
});
