import { AGENT_MAX_JSON_BODY_BYTES } from '@nexus-terminal/shared/agent/values';
import {
	readAgentCloseResourcesRequest,
	readAgentCloseResourcesResponse,
} from '@nexus-terminal/shared/agent/runs/http-codec';
import { readAgentAppPath } from '@nexus-terminal/shared/agent/scope/http-codec';
import { requestAgentManagement } from './management-request';
import type { NativeThreadScope } from '../model/native-thread-types';
import type { NativeResourceCloseTarget, NativeResourceCloseResult } from '../model/native-resource-types';

export async function closeNativeResources(
	scope: NativeThreadScope,
	target: NativeResourceCloseTarget,
	confirmed: boolean,
	signal: AbortSignal,
): Promise<NativeResourceCloseResult> {
	const appId = readAgentAppPath({ appId: scope.appId }).appId;
	const value = await requestAgentManagement({
		method: 'POST',
		path: '/apps/' + appId + '/resources/close',
		maxRequestBytes: AGENT_MAX_JSON_BODY_BYTES,
		maxResponseBytes: AGENT_MAX_JSON_BODY_BYTES,
		signal,

		input: () =>
			readAgentCloseResourcesRequest({
				appVersion: scope.appVersion,
				target:
					target.kind === 'app'
						? { kind: 'app' }
						: { kind: 'session', runId: target.runId, sessionId: target.sessionId },
				confirmed,
			}),

		decode: readAgentCloseResourcesResponse,
	});
	return {
		status: value.status,
		activeRuns: value.activeRuns,
		activeOperations: value.activeOperations,
		backgroundJobs: value.backgroundJobs,
	};
}
