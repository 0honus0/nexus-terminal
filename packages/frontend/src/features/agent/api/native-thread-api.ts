import { readAgentAppPath, readAgentAppResponse } from '@nexus-terminal/shared/agent/scope/http-codec';
import type { AgentWorkspaceRequest } from '@nexus-terminal/shared/agent/scope/workspace-http';
import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import { AGENT_WORKSPACE_MAX_RESPONSE_BYTES } from '@nexus-terminal/shared/agent/scope/values';
import type {
	NativeThread,
	NativeThreadIntent,
	NativeThreadPage,
	NativeThreadScope,
} from '../model/native-thread-types';
import { fromNativeThread, toNativeThreadMutation } from '../model/native-thread-mapper';
import { AgentManagementFailure } from '../model/management-failure';
import { requestAgentManagement } from './management-request';
import { requestNativeWorkspace } from './native-workspace-request';

export function createNativeThreadApi(apiBase: '/api/v1/agent' | '/__next/api/v1/agent' = '/api/v1/agent') {
	function normalizedAppId(appId: string): string {
		try {
			return readAgentAppPath({ appId }).appId;
		} catch (cause) {
			throw new AgentManagementFailure('invalid_input', 'not_dispatched', { cause });
		}
	}

	function path(appId: string): string {
		return '/apps/' + encodeURIComponent(normalizedAppId(appId));
	}

	return {
		async scope(appId: string, signal?: AbortSignal): Promise<NativeThreadScope> {
			const id = normalizedAppId(appId);
			const app = await requestAgentManagement({
				method: 'GET',
				apiBase,
				path: path(id),
				maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
				maxResponseBytes: AGENT_WORKSPACE_MAX_RESPONSE_BYTES,

				decode: (value) => {
					const app = readAgentAppResponse(value);
					if (app.id !== id) {
						throw new Error('Mismatched Agent App');
					}
					return app;
				},

				signal,
			});
			return { appId: app.id, appVersion: app.version };
		},

		async list(
			scope: NativeThreadScope,
			after: string | null,
			limit: number,
			signal?: AbortSignal,
		): Promise<NativeThreadPage> {
			const request: AgentWorkspaceRequest = {
				appVersion: scope.appVersion,
				request: { method: 'agent.threads.list', params: { after, limit } },
			};
			const result = await requestNativeWorkspace(scope, request, signal, apiBase);
			if (result.method !== 'agent.threads.list') {
				throw new AgentManagementFailure('protocol_failure', 'unknown');
			}
			return { items: result.value.items.map(fromNativeThread), nextCursor: result.value.nextCursor };
		},

		async mutate(intent: NativeThreadIntent, signal?: AbortSignal): Promise<NativeThread> {
			const result = await requestNativeWorkspace(intent.scope, toNativeThreadMutation(intent), signal, apiBase);
			if (result.method !== 'agent.threads.create' && result.method !== 'agent.threads.rename') {
				throw new AgentManagementFailure('protocol_failure', 'unknown');
			}
			return fromNativeThread(result.value);
		},
	};
}

export type NativeThreadApi = ReturnType<typeof createNativeThreadApi>;
