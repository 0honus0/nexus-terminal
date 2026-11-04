import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import {
	readAgentPluginDataPurge,
	readAgentPluginDataPurgeView,
} from '@nexus-terminal/shared/agent/plugins/http-codec';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import type { PluginDataPurge } from '../model/plugin-types';
import { fromPluginDataPurge } from '../model/plugin-mapper';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

function path(appId: string): string {
	try {
		return '/plugins/installations/' + encodeURIComponent(readAgentId(appId));
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

export async function purgePluginData(
	appId: string,
	revision: number,
	operationId: string,
	signal?: AbortSignal,
): Promise<PluginDataPurge> {
	const value = await requestAgentManagement({
		method: 'POST',
		path: path(appId) + '/delete-data',
		maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		signal,

		input: () => readAgentPluginDataPurge({ expectedRevision: revision, operationId }),

		decode(value) {
			const result = readAgentPluginDataPurgeView(value);
			if (result.revision !== revision + 1) {
				throw new Error('Plugin data purge confirmation mismatch');
			}
			return result;
		},
	});
	return fromPluginDataPurge(value);
}
