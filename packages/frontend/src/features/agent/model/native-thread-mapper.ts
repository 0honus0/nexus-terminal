import type { AgentThreadView } from '@nexus-terminal/shared/agent/scope/model';
import type { AgentWorkspaceRequest } from '@nexus-terminal/shared/agent/scope/workspace-http';
import type { NativeThread, NativeThreadIntent } from './native-thread-types';

export function fromNativeThread(value: AgentThreadView): NativeThread {
	return {
		id: value.id,
		appId: value.appId,
		title: value.title,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

export function toNativeThreadMutation(value: NativeThreadIntent): AgentWorkspaceRequest {
	if (value.kind === 'create') {
		return {
			appVersion: value.scope.appVersion,
			request: { method: 'agent.threads.create', params: { operationId: value.operationId, title: value.title } },
		};
	}
	return {
		appVersion: value.scope.appVersion,
		request: {
			method: 'agent.threads.rename',
			params: {
				threadId: value.thread.id,
				expectedVersion: value.thread.version,
				operationId: value.operationId,
				title: value.title,
			},
		},
	};
}
