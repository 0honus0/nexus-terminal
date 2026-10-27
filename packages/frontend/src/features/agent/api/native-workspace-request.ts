import { readAgentAppPath } from '@nexus-terminal/shared/agent/scope/http-codec';
import {
	readAgentWorkspaceRequest,
	readAgentWorkspaceResponse,
} from '@nexus-terminal/shared/agent/scope/workspace-http-codec';
import type { AgentWorkspaceRequest, AgentWorkspaceResult } from '@nexus-terminal/shared/agent/scope/workspace-http';
import { AGENT_WORKSPACE_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import type { NativeThreadScope } from '../model/native-thread-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

export async function requestNativeWorkspace(
	scope: NativeThreadScope,
	request: AgentWorkspaceRequest,
	signal?: AbortSignal,
	apiBase: '/api/v1/agent' | '/__next/api/v1/agent' = '/api/v1/agent',
): Promise<AgentWorkspaceResult> {
	let appId: string;
	let validated: AgentWorkspaceRequest;
	try {
		appId = readAgentAppPath({ appId: scope.appId }).appId;
		validated = readAgentWorkspaceRequest(request);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const response = await requestAgentManagement({
		method: 'POST',
		apiBase,
		path: '/apps/' + encodeURIComponent(appId) + '/workspace',
		maxRequestBytes: AGENT_WORKSPACE_MAX_RESPONSE_BYTES,
		maxResponseBytes: AGENT_WORKSPACE_MAX_RESPONSE_BYTES,

		input: () => validated,

		decode: (value) => readAgentWorkspaceResponse(value, appId, validated),

		signal,
	});
	return response.result;
}
