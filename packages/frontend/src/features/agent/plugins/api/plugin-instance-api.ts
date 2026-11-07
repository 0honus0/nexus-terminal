import { agentRecord, readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginConfigurationView,
	readAgentPluginConfigurationWrite,
	readAgentPluginInstanceCreate,
	readAgentPluginInstanceSettings,
	readAgentPluginInstanceView,
	readAgentPluginInstanceUpdate,
} from '@nexus-terminal/shared/agent/plugins/settings-codec';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { requestAgentManagement } from '../../api/management-request';
import {
	fromPluginConfiguration,
	fromPluginInstance,
	fromPluginInstanceSettings,
} from '../model/plugin-instance-mapper';
import type {
	PluginInstance,
	PluginConfiguration,
	PluginInstanceSettings,
	PluginConfigurationWrite,
	PluginInstanceUpdate,
} from '../model/plugin-instance-types';

const budgets = { maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES, maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES };

function path(appId: string, instanceId?: string): string {
	return (
		'/plugins/apps/' +
		encodeURIComponent(readAgentId(appId)) +
		'/instances' +
		(instanceId === undefined ? '' : '/' + encodeURIComponent(readAgentId(instanceId)))
	);
}

export async function listPluginInstances(appId: string, signal?: AbortSignal): Promise<PluginInstance[]> {
	return (
		await requestAgentManagement({
			...budgets,
			method: 'GET',
			path: path(appId),
			signal,

			decode(value) {
				const row = agentRecord(value, ['instances']);
				if (!Array.isArray(row.instances)) {
					throw new InvalidAgentPayload();
				}
				const instances = row.instances.map(readAgentPluginInstanceView);
				if (
					instances.some((instance) => instance.appId !== appId) ||
					new Set(instances.map((item) => item.id)).size !== instances.length
				) {
					throw new InvalidAgentPayload();
				}
				return instances;
			},
		})
	).map(fromPluginInstance);
}

export async function createPluginInstance(
	appId: string,
	packageId: string,
	name: string,
	signal?: AbortSignal,
): Promise<PluginInstance> {
	return fromPluginInstance(
		await requestAgentManagement({
			...budgets,
			method: 'POST',
			path: path(appId),
			signal,

			input: () => readAgentPluginInstanceCreate({ packageId, name }),

			decode: (value) => readAgentPluginInstanceView(agentRecord(value, ['instance']).instance),
		}),
	);
}

export async function updatePluginInstance(
	appId: string,
	instanceId: string,
	command: PluginInstanceUpdate,
	signal?: AbortSignal,
): Promise<PluginInstance> {
	return fromPluginInstance(
		await requestAgentManagement({
			...budgets,
			method: 'PUT',
			path: path(appId, instanceId),
			signal,

			input: () =>
				readAgentPluginInstanceUpdate({
					expectedRevision: command.expectedRevision,
					name: command.name,
					selected: command.selected,
					enabled: command.enabled,
				}),

			decode: (value) => readAgentPluginInstanceView(agentRecord(value, ['instance']).instance),
		}),
	);
}

export async function readPluginInstanceSettings(
	appId: string,
	instanceId: string,
	signal?: AbortSignal,
): Promise<PluginInstanceSettings> {
	const result = await requestAgentManagement({
		...budgets,
		method: 'GET',
		path: path(appId, instanceId) + '/configuration',
		signal,
		decode: readAgentPluginInstanceSettings,
	});
	if (result.instance.appId !== appId || result.instance.id !== instanceId) {
		throw new InvalidAgentPayload();
	}
	return fromPluginInstanceSettings(result);
}

export async function writePluginConfiguration(
	appId: string,
	instanceId: string,
	command: PluginConfigurationWrite,
	signal?: AbortSignal,
): Promise<PluginConfiguration> {
	const result = await requestAgentManagement({
		...budgets,
		method: 'PUT',
		path: path(appId, instanceId) + '/configuration',
		signal,

		input: () =>
			readAgentPluginConfigurationWrite({
				operationKey: command.operationKey,
				expectedPackageRevision: command.expectedPackageRevision,
				expectedRevision: command.expectedRevision,
				schemaRevision: command.schemaRevision,
				documentJson: command.documentJson,
			}),

		decode(value) {
			const row = agentRecord(value, ['configuration', 'changed']);
			if (typeof row.changed !== 'boolean') {
				throw new InvalidAgentPayload();
			}
			const configuration = readAgentPluginConfigurationView(row.configuration);
			if (configuration.instanceId !== instanceId || configuration.schemaRevision !== command.schemaRevision) {
				throw new InvalidAgentPayload();
			}
			return configuration;
		},
	});
	return fromPluginConfiguration(result);
}
