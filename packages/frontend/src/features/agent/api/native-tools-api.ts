import {
	readAgentThreadToolsPath,
	readAgentToolCallPath,
	readAgentToolCallDetails,
	readAgentThreadToolsQuery,
	readAgentThreadToolsResponse,
} from '@nexus-terminal/shared/agent/tools/http-codec';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_TOOL_LIST_DEFAULT_LIMIT,
	AGENT_TOOL_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/tools/values';
import { fromNativeTool } from '../model/native-run-mapper';
import type { NativeTool, NativePage, NativeToolCallDetails } from '../model/native-run-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

export async function listNativeThreadTools(
	appId: string,
	threadId: string,
	before: string | null,
	limit = AGENT_TOOL_LIST_DEFAULT_LIMIT,
	signal?: AbortSignal,
): Promise<NativePage<NativeTool, string | null>> {
	let path: ReturnType<typeof readAgentThreadToolsPath>;
	let params: URLSearchParams;
	try {
		path = readAgentThreadToolsPath({ appId, threadId });
		params = new URLSearchParams({ limit: String(limit) });
		if (before !== null) params.set('before', before);
		readAgentThreadToolsQuery(params);
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const value = await requestAgentManagement({
		method: 'GET',
		path: '/apps/' + path.appId + '/threads/' + path.threadId + '/tools?' + params,
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_TOOL_MAX_RESPONSE_BYTES,
		signal,

		decode(input) {
			return readAgentThreadToolsResponse(input, path.appId, before, limit);
		},
	});
	return { items: value.items.map(fromNativeTool), nextCursor: value.nextCursor };
}

export async function getNativeToolCallDetails(tool: NativeTool, signal: AbortSignal): Promise<NativeToolCallDetails> {
	const path = readAgentToolCallPath({ appId: tool.appId, runId: tool.runId, toolId: tool.id });
	const value = await requestAgentManagement({
		method: 'GET',
		path: '/apps/' + path.appId + '/runs/' + path.runId + '/tools/' + path.toolId,
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_TOOL_MAX_RESPONSE_BYTES,
		signal,

		decode(input) {
			const details = readAgentToolCallDetails(input, path);
			if (details.tool.revision < tool.revision) throw new InvalidAgentPayload();
			return details;
		},
	});
	return { tool: fromNativeTool(value.tool), argumentsJson: value.argumentsJson, failureCode: value.failureCode };
}
