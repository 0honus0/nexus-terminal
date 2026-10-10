import { agentRecord, agentInteger, agentText, readAgentId } from '../http-codec.js';
import { AGENT_SCOPE_MAX_NAME_BYTES } from './values.js';
import { AGENT_MAX_JSON_BODY_BYTES } from '../values.js';
import type {
	AgentAppPath,
	AgentCreateAppRequest,
	AgentCreateAppResponse,
	AgentCreateThreadRequest,
	AgentCreateThreadResponse,
} from './http.js';

export function readAgentAppPath(input: unknown): AgentAppPath {
	return { appId: readAgentId(agentRecord(input, ['appId']).appId) };
}

export function readAgentCreateAppRequest(input: unknown): AgentCreateAppRequest {
	return {
		name: agentText(agentRecord(input, ['name'], AGENT_MAX_JSON_BODY_BYTES).name, AGENT_SCOPE_MAX_NAME_BYTES),
	};
}

export function readAgentCreateThreadRequest(input: unknown): AgentCreateThreadRequest {
	return {
		title: agentText(agentRecord(input, ['title'], AGENT_MAX_JSON_BODY_BYTES).title, AGENT_SCOPE_MAX_NAME_BYTES),
	};
}

export function readAgentCreateAppResponse(input: unknown): AgentCreateAppResponse {
	const row = agentRecord(input, ['id', 'name', 'createdAt']);
	return {
		id: readAgentId(row.id),
		name: agentText(row.name, AGENT_SCOPE_MAX_NAME_BYTES),
		createdAt: agentInteger(row.createdAt),
	};
}

export function readAgentCreateThreadResponse(input: unknown): AgentCreateThreadResponse {
	const row = agentRecord(input, ['id', 'appId', 'title', 'createdAt']);
	return {
		id: readAgentId(row.id),
		appId: readAgentId(row.appId),
		title: agentText(row.title, AGENT_SCOPE_MAX_NAME_BYTES),
		createdAt: agentInteger(row.createdAt),
	};
}
