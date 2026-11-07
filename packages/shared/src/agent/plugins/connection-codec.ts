import { agentInteger, agentRecord, isAgentRecord, InvalidAgentPayload, readAgentId } from '../http-codec.js';
import { readAgentPluginConnector } from './connection.js';
import type { AgentPluginConnectionView, AgentPluginConnectionWrite } from './connection.js';

export function readAgentPluginConnectionView(input: unknown): AgentPluginConnectionView {
	const row = agentRecord(input, ['instanceId', 'revision', 'connector', 'hasCredential']);
	if (typeof row.hasCredential !== 'boolean') {
		throw new InvalidAgentPayload();
	}
	return {
		instanceId: readAgentId(row.instanceId),
		revision: agentInteger(row.revision),
		connector: readAgentPluginConnector(row.connector),
		hasCredential: row.hasCredential,
	};
}

export function readAgentPluginConnectionWrite(input: unknown): AgentPluginConnectionWrite {
	const row = agentRecord(input, ['expectedRevision', 'connector', 'credential']);
	if (!isAgentRecord(row.credential)) {
		throw new InvalidAgentPayload();
	}
	const credential = agentRecord(
		row.credential,
		row.credential.action === 'replace' ? ['action', 'value'] : ['action'],
	);
	if (credential.action === 'replace') {
		if (typeof credential.value !== 'string' || !credential.value || /[\r\n]/u.test(credential.value)) {
			throw new InvalidAgentPayload();
		}
		return {
			expectedRevision: agentInteger(row.expectedRevision),
			connector: readAgentPluginConnector(row.connector),
			credential: { action: 'replace', value: credential.value },
		};
	}
	if ((credential.action !== 'keep' && credential.action !== 'clear') || credential.value !== undefined) {
		throw new InvalidAgentPayload();
	}
	return {
		expectedRevision: agentInteger(row.expectedRevision),
		connector: readAgentPluginConnector(row.connector),
		credential: { action: credential.action },
	};
}
