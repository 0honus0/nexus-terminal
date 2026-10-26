import {
	readAgentRunStepPath,
	readAgentRunStepResponse,
	readAgentRunStepEventsResponse,
	readAgentRunEventsQuery,
} from '@nexus-terminal/shared/agent/runs/http-codec';
import {
	readAgentThreadToolsPath,
	readAgentThreadToolsQuery,
	readAgentThreadToolsResponse,
	readAgentToolPath,
	readAgentToolResponse,
	readAgentToolEventsResponse,
	readAgentToolEventsQuery,
} from '@nexus-terminal/shared/agent/tools/http-codec';
import { AGENT_MAX_JSON_BODY_BYTES, AGENT_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_TOOL_LIST_DEFAULT_LIMIT,
	AGENT_TOOL_MAX_RESPONSE_BYTES,
} from '@nexus-terminal/shared/agent/tools/values';
import { fromNativeStep, fromNativeStepEvent, fromNativeTool, fromNativeToolEvent } from '../model/native-run-mapper';
import type { NativeStep, NativeStepEvent, NativeTool, NativeToolEvent, NativePage } from '../model/native-run-types';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';

function stepPath(appId: string, runId: string, stepIndex: number): string {
	try {
		const path = readAgentRunStepPath({ appId, runId, stepIndex: String(stepIndex) });
		return '/apps/' + path.appId + '/runs/' + path.runId + '/steps/' + path.stepIndex;
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

function toolPath(
	appId: string,
	runId: string,
	toolCallId: string,
): { url: string; appId: string; runId: string; toolCallId: string } {
	try {
		const path = readAgentToolPath({ appId, runId, toolCallId });
		return {
			url: '/apps/' + path.appId + '/runs/' + path.runId + '/tools/' + path.toolCallId,
			appId: path.appId,
			runId: path.runId,
			toolCallId: path.toolCallId,
		};
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

function query(after: number, tool: boolean): URLSearchParams {
	try {
		const params = new URLSearchParams({ after: String(after), limit: '50' });
		if (tool) readAgentToolEventsQuery(params);
		else readAgentRunEventsQuery(params);
		return params;
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
}

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

export async function getNativeStep(
	appId: string,
	runId: string,
	stepIndex: number,
	signal?: AbortSignal,
): Promise<NativeStep> {
	const value = await requestAgentManagement({
		method: 'GET',
		path: stepPath(appId, runId, stepIndex),
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
		signal,

		decode(value) {
			const step = readAgentRunStepResponse(value);
			if (step.runId !== runId || step.stepIndex !== stepIndex) throw new Error('Step association mismatch');
			return step;
		},
	});
	return fromNativeStep(value);
}

export async function listNativeStepEvents(
	appId: string,
	runId: string,
	stepIndex: number,
	after: number,
	signal?: AbortSignal,
): Promise<NativePage<NativeStepEvent, number>> {
	const value = await requestAgentManagement({
		method: 'GET',
		path: stepPath(appId, runId, stepIndex) + '/events?' + query(after, false),
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
		signal,

		decode(value) {
			const page = readAgentRunStepEventsResponse(value);
			if (
				page.items.length > 50 ||
				page.items.some(
					(item) => item.runId !== runId || item.stepIndex !== stepIndex || item.sequence <= after,
				) ||
				(page.items.length === 0 && page.nextCursor !== after)
			)
				throw new Error('Step event association mismatch');
			return page;
		},
	});
	return { items: value.items.map(fromNativeStepEvent), nextCursor: value.nextCursor };
}

export async function getNativeTool(
	appId: string,
	runId: string,
	toolCallId: string,
	signal?: AbortSignal,
): Promise<NativeTool> {
	const expected = toolPath(appId, runId, toolCallId);
	const value = await requestAgentManagement({
		method: 'GET',
		path: expected.url,
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_TOOL_MAX_RESPONSE_BYTES,
		signal,

		decode(value) {
			const tool = readAgentToolResponse(value);
			if (tool.appId !== expected.appId || tool.runId !== expected.runId || tool.id !== expected.toolCallId)
				throw new Error('Tool association mismatch');
			return tool;
		},
	});
	return fromNativeTool(value);
}

export async function listNativeToolEvents(
	appId: string,
	runId: string,
	toolCallId: string,
	after: number,
	signal?: AbortSignal,
): Promise<NativePage<NativeToolEvent, number>> {
	const expected = toolPath(appId, runId, toolCallId);
	const value = await requestAgentManagement({
		method: 'GET',
		path: expected.url + '/events?' + query(after, true),
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_TOOL_MAX_RESPONSE_BYTES,
		signal,

		decode(value) {
			const page = readAgentToolEventsResponse(value);
			if (
				page.items.length > 50 ||
				page.items.some(
					(item) =>
						item.runId !== expected.runId ||
						item.toolCallId !== expected.toolCallId ||
						item.revision <= after,
				) ||
				(page.items.length === 0 && page.nextCursor !== after)
			)
				throw new Error('Tool event association mismatch');
			return page;
		},
	});
	return { items: value.items.map(fromNativeToolEvent), nextCursor: value.nextCursor };
}
