import type { AgentRunStreamCursor, AgentRunStreamEvent } from '@nexus-terminal/shared/agent/runs/events';
import type { RunStreamCursor, RunStreamPage } from '../../runs/model/run-stream-types.js';
import { toThreadEntries, toRunEvents, toChildren } from '../http/workspace-mapper.js';
import { toRunView, toRunUsageView } from '../http/run-mapper.js';
import { toThreadView } from '../http/scope-mapper.js';
import { toOperationApprovalPage } from '../http/operation-approval-mapper.js';

export function fromRunStreamCursor(value: AgentRunStreamCursor): RunStreamCursor {
	return {
		threadId: value.threadId,
		entries: {
			runSequence: value.entries.runSequence,
			messageOrdinal: value.entries.messageOrdinal,
			chunkIndex: value.entries.chunkIndex,
			textOffset: value.entries.textOffset,
		},
		events: value.events,
		approvals: value.approvals,
	};
}

export function toRunStreamEvent(
	appId: string,
	runId: string,
	revision: number,
	value: RunStreamPage,
): AgentRunStreamEvent {
	return {
		type: 'update',
		appId,
		runId,
		revision,
		body: toThreadEntries(value.body),
		state:
			value.state === null
				? null
				: {
						thread: toThreadView(value.state.thread),
						run: toRunView(value.state.run),
						usage: toRunUsageView(value.state.usage),
						events: toRunEvents(value.state.events),
						approvals: toOperationApprovalPage(value.state.approvals),
						children: toChildren(value.state.children),
						resources: value.state.resources.map((value) => ({
							id: value.resource.id,
							runId: value.resource.runId,
							state: value.resource.phase,
							openedAt: value.resource.createdAt,
							sshConnections: value.resource.connections,
							sftpChannels: value.resource.files,
							protocolSessions: value.resource.protocolSessions,
							browserSessions: value.resource.browserSessions,
							activeOperations: value.resource.operations,
							backgroundJobs: value.backgroundJobs,
							waitingOutputJobs: value.waitingOutputJobs,
							targetIds: value.resource.targets.map((id) => id),
							expiresAt: value.expiresAt,
						})),
					},
		more: value.more,
	};
}
