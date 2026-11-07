import type { AgentPluginConnector } from '@nexus-terminal/shared/agent/plugins/connection';
import {
	readAgentPluginConnectionView,
	readAgentPluginConnectionWrite,
} from '@nexus-terminal/shared/agent/plugins/connection-codec';
import { readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import {
	AGENT_PLUGIN_MAX_BODY_BYTES,
	AGENT_PLUGIN_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { requestAgentManagement } from '../../api/management-request';
import type { PluginConnector, PluginConnection, PluginConnectionWrite } from '../model/plugin-connection-types';

function connector(value: PluginConnector | AgentPluginConnector): PluginConnector {
	if (value.kind === 'http') {
		return {
			kind: value.kind,
			endpoint: value.endpoint,
			privateAuthorities: value.privateAuthorities.map((authority) => authority),
		};
	}
	if (value.kind === 'remoteProcess') {
		return {
			kind: value.kind,
			connectionId: value.connectionId,
			argv: value.argv.map((arg) => arg),
			cwd: value.cwd,
		};
	}
	return { kind: 'none' };
}

function path(appId: string, instanceId: string): string {
	return (
		'/plugins/apps/' +
		encodeURIComponent(readAgentId(appId)) +
		'/instances/' +
		encodeURIComponent(readAgentId(instanceId)) +
		'/connection'
	);
}

async function request(
	appId: string,
	instanceId: string,
	command: PluginConnectionWrite | null,
	signal: AbortSignal,
): Promise<PluginConnection> {
	const value = await requestAgentManagement({
		method: command === null ? 'GET' : 'PUT',
		path: path(appId, instanceId),
		signal,
		maxRequestBytes: AGENT_PLUGIN_MAX_BODY_BYTES,
		maxResponseBytes: AGENT_PLUGIN_MAX_RESPONSE_BYTES,
		input:
			command === null
				? undefined
				: () =>
						readAgentPluginConnectionWrite({
							expectedRevision: command.expectedRevision,
							connector: connector(command.connector),
							credential:
								command.credential.action === 'replace'
									? { action: 'replace', value: command.credential.value }
									: { action: command.credential.action },
						}),
		decode: readAgentPluginConnectionView,
	});
	if (value.instanceId !== instanceId) {
		throw new InvalidAgentPayload();
	}
	return {
		instanceId: value.instanceId,
		revision: value.revision,
		connector: connector(value.connector),
		hasCredential: value.hasCredential,
	};
}

export function readPluginConnection(
	appId: string,
	instanceId: string,
	signal: AbortSignal,
): Promise<PluginConnection> {
	return request(appId, instanceId, null, signal);
}

export function writePluginConnection(
	appId: string,
	instanceId: string,
	command: PluginConnectionWrite,
	signal: AbortSignal,
): Promise<PluginConnection> {
	return request(appId, instanceId, command, signal);
}
