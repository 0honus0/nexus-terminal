import { readAgentRunPath, readAgentRunUsageResponse } from '@nexus-terminal/shared/agent/runs/http-codec';
import { AGENT_MAX_JSON_BODY_BYTES, AGENT_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/values';
import { requestAgentManagement } from './management-request';
import type { NativeRunUsage } from '../model/native-run-types';
import { fromNativeRunUsage } from '../model/native-run-mapper';
import { requestNativeWorkspace } from './native-workspace-request';
import { AgentManagementFailure } from '../model/management-failure';
import type { NativeThreadScope } from '../model/native-thread-types';
import type {
	NativeRun,
	NativeRunIntent,
	NativeRunConfirmation,
	NativeModel,
	NativeEntry,
	NativeEntryCursor,
	NativePage,
	NativeEvent,
	NativeChild,
	NativeApproval,
	NativeMessage,
} from '../model/native-run-types';
import {
	fromNativeRun,
	fromNativeModel,
	fromNativeEntry,
	fromNativeCursor,
	fromNativeEvent,
	fromNativeChild,
	fromNativeApproval,
	fromNativeMessage,
	toNativeRunMutation,
} from '../model/native-run-mapper';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_COLLABORATION_MESSAGE_MAX_PAGE } from '@nexus-terminal/shared/agent/collaboration/values';

function unexpected(): never {
	throw new AgentManagementFailure('protocol_failure', 'unknown');
}

export async function listNativeModels(scope: NativeThreadScope, signal?: AbortSignal): Promise<NativeModel[]> {
	const result = await requestNativeWorkspace(
		scope,
		{ appVersion: scope.appVersion, request: { method: 'agent.providers.list', params: {} } },
		signal,
	);
	return result.method === 'agent.providers.list' ? result.value.map(fromNativeModel) : unexpected();
}

export async function listNativeRuns(
	scope: NativeThreadScope,
	threadId: string,
	after: number,
	signal?: AbortSignal,
): Promise<NativePage<NativeRun, number>> {
	const result = await requestNativeWorkspace(
		scope,
		{
			appVersion: scope.appVersion,
			request: { method: 'agent.runs.list', params: { threadId, after, limit: AGENT_RUN_EVENT_MAX_LIMIT } },
		},
		signal,
	);
	return result.method === 'agent.runs.list'
		? { items: result.value.items.map(fromNativeRun), nextCursor: result.value.nextCursor }
		: unexpected();
}

export async function getNativeRun(
	scope: NativeThreadScope,
	runId: string,
	signal?: AbortSignal,
): Promise<NativeRun | null> {
	const result = await requestNativeWorkspace(
		scope,
		{ appVersion: scope.appVersion, request: { method: 'agent.runs.get', params: { runId } } },
		signal,
	);
	return result.method === 'agent.runs.get'
		? result.value === null
			? null
			: fromNativeRun(result.value)
		: unexpected();
}

export async function listNativeEntries(
	scope: NativeThreadScope,
	threadId: string,
	after: NativeEntryCursor,
	signal?: AbortSignal,
): Promise<NativePage<NativeEntry, NativeEntryCursor>> {
	const result = await requestNativeWorkspace(
		scope,
		{
			appVersion: scope.appVersion,
			request: {
				method: 'agent.threads.entries',
				params: { threadId, after: fromNativeCursor(after), limit: AGENT_THREAD_ENTRY_MAX_PAGE },
			},
		},
		signal,
	);
	return result.method === 'agent.threads.entries'
		? { items: result.value.items.map(fromNativeEntry), nextCursor: fromNativeCursor(result.value.nextCursor) }
		: unexpected();
}

export async function listNativeEvents(
	scope: NativeThreadScope,
	runId: string,
	after: number,
	signal?: AbortSignal,
): Promise<NativePage<NativeEvent, number>> {
	const result = await requestNativeWorkspace(
		scope,
		{
			appVersion: scope.appVersion,
			request: { method: 'agent.runs.events', params: { runId, after, limit: AGENT_RUN_EVENT_MAX_LIMIT } },
		},
		signal,
	);
	return result.method === 'agent.runs.events'
		? { items: result.value.items.map(fromNativeEvent), nextCursor: result.value.nextCursor }
		: unexpected();
}

export async function listNativeChildren(
	scope: NativeThreadScope,
	runId: string,
	signal?: AbortSignal,
): Promise<NativeChild[]> {
	const result = await requestNativeWorkspace(
		scope,
		{ appVersion: scope.appVersion, request: { method: 'agent.subagents.list', params: { runId } } },
		signal,
	);
	return result.method === 'agent.subagents.list' ? result.value.items.map(fromNativeChild) : unexpected();
}

export async function listNativeApprovals(
	scope: NativeThreadScope,
	runId: string,
	signal?: AbortSignal,
): Promise<NativeApproval[]> {
	const result = await requestNativeWorkspace(
		scope,
		{ appVersion: scope.appVersion, request: { method: 'agent.approvals.list', params: { runId } } },
		signal,
	);
	return result.method === 'agent.approvals.list' ? result.value.map(fromNativeApproval) : unexpected();
}

export async function listNativeMessages(
	scope: NativeThreadScope,
	runId: string,
	childId: string,
	after: number,
	signal?: AbortSignal,
): Promise<NativePage<NativeMessage, number>> {
	const result = await requestNativeWorkspace(
		scope,
		{
			appVersion: scope.appVersion,
			request: {
				method: 'agent.subagents.messages',
				params: { runId, childId, after, limit: AGENT_COLLABORATION_MESSAGE_MAX_PAGE },
			},
		},
		signal,
	);
	return result.method === 'agent.subagents.messages'
		? { items: result.value.items.map(fromNativeMessage), nextCursor: result.value.nextCursor }
		: unexpected();
}

export async function mutateNativeRun(intent: NativeRunIntent, signal?: AbortSignal): Promise<NativeRunConfirmation> {
	const result = await requestNativeWorkspace(intent.scope, toNativeRunMutation(intent), signal);
	if (result.method === 'agent.approvals.resolve')
		return { kind: 'approval', approval: fromNativeApproval(result.value) };
	if (
		result.method === 'agent.runs.create' ||
		result.method === 'agent.runs.appendInput' ||
		result.method === 'agent.runs.cancel' ||
		result.method === 'agent.subagents.cancel'
	)
		return { kind: 'run', run: fromNativeRun(result.value.run) };
	return unexpected();
}

export async function getNativeRunUsage(
	scope: NativeThreadScope,
	runId: string,
	signal?: AbortSignal,
): Promise<NativeRunUsage> {
	let path;
	try {
		path = readAgentRunPath({ appId: scope.appId, runId });
	} catch (cause) {
		throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
	}
	const value = await requestAgentManagement({
		method: 'GET',
		path: '/apps/' + path.appId + '/runs/' + path.runId + '/usage',
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_MAX_RESPONSE_BYTES,
		signal,

		decode(input) {
			const usage = readAgentRunUsageResponse(input);
			if (usage.runId !== runId) throw new AgentManagementFailure('protocol_failure', 'unknown');
			return usage;
		},
	});
	return fromNativeRunUsage(value);
}
