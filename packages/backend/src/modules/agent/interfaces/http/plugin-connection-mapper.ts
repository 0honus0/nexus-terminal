import type {
	AgentPluginConnectionView,
	AgentPluginConnectionWrite,
	AgentPluginConnector,
} from '@nexus-terminal/shared/agent/plugins/connection';
import type {
	PluginConnection,
	PluginConnectionWrite,
	PluginConnector,
} from '../../plugins/model/plugin-connection-types.js';

function fromConnector(value: AgentPluginConnector): PluginConnector {
	if (value.kind === 'http') {
		return {
			kind: value.kind,
			endpoint: value.endpoint,
			privateAuthorities: value.privateAuthorities.map((item) => item),
		};
	}
	if (value.kind === 'remoteProcess') {
		return {
			kind: value.kind,
			connectionId: value.connectionId,
			argv: value.argv.map((item) => item),
			cwd: value.cwd,
		};
	}
	return { kind: 'none' };
}

export function fromPluginConnectionWrite(value: AgentPluginConnectionWrite): PluginConnectionWrite {
	return {
		expectedRevision: value.expectedRevision,
		connector: fromConnector(value.connector),
		credential:
			value.credential.action === 'replace'
				? { action: 'replace', value: value.credential.value }
				: { action: value.credential.action },
	};
}

export function toPluginConnection(value: PluginConnection): AgentPluginConnectionView {
	const connector: AgentPluginConnector =
		value.connector.kind === 'http'
			? {
					kind: value.connector.kind,
					endpoint: value.connector.endpoint,
					privateAuthorities: value.connector.privateAuthorities.map((item) => item),
				}
			: value.connector.kind === 'remoteProcess'
				? {
						kind: value.connector.kind,
						connectionId: value.connector.connectionId,
						argv: value.connector.argv.map((item) => item),
						cwd: value.connector.cwd,
					}
				: { kind: 'none' };
	return { instanceId: value.instanceId, revision: value.revision, connector, hasCredential: value.hasCredential };
}
