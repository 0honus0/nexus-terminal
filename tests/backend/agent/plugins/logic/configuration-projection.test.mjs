import { test, expect } from 'vitest';
import { toPluginInstanceSettings } from '../../../../../packages/backend/src/modules/agent/interfaces/plugin/plugin-configuration-mapper.ts';

test.each([
	['App authorization ceiling', true, false, false, ['service.transport.http', 'service.transport.process'], []],
	['HTTP service', false, true, false, ['service.transport.http'], ['http']],
	['process service', false, true, false, ['service.transport.process'], ['remoteProcess']],
	['App also providing services', true, true, false, ['service.transport.http'], ['http']],
	['tool using transport directly', false, false, true, ['service.transport.http'], ['http']],
	['App also providing direct tools', true, false, true, ['service.transport.http'], ['http']],
	['service without transport rights', false, true, false, [], []],
])(
	'%s projects its own connection controls independently of delegated App rights',
	(_name, app, services, tools, capabilities, expected) => {
		const source = {
			instance: {
				id: 'instance',
				appId: 'app',
				packageId: 'example.plugin',
				name: 'Example',
				selected: true,
				enabled: true,
				revision: 1,
				createdAt: 1,
				updatedAt: 1,
			},
			configuration: {
				instanceId: 'instance',
				packageId: 'example.plugin',
				revision: 1,
				schemaRevision: 1,
				documentJson: '{}',
			},
			packageRevision: 1,
			manifest: {
				capabilities,
				contributions: {
					app: app ? { entry: 'example.plugin.run', uiContract: null, uiApiVersion: null } : null,
					services,
					tools,
					settings: null,
				},
			},
		};
		expect(toPluginInstanceSettings(source).connectionKinds).toEqual(expected);
	},
);
