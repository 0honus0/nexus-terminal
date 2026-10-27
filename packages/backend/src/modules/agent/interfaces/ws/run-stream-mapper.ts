import type { AgentRunStreamCursor, AgentRunStreamEvent } from '@nexus-terminal/shared/agent/runs/events';
import type { RunStreamCursor, RunStreamPage } from '../../runs/model/run-stream-types.js';
import { toThreadEntries, toRunEvents, toChildren } from '../http/workspace-mapper.js';
import { toRunView, toRunUsageView } from '../http/run-mapper.js';
import { toThreadView } from '../http/scope-mapper.js';
import { toApprovalPage } from '../http/governance-mapper.js';

export function fromRunStreamCursor(value: AgentRunStreamCursor): RunStreamCursor {
	return {
		threadId: value.threadId,
		entries: {
			runSequence: value.entries.runSequence,
			stepIndex: value.entries.stepIndex,
			eventSequence: value.entries.eventSequence,
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
						approvals: toApprovalPage(value.state.approvals),
						children: toChildren(value.state.children),
					},
		more: value.more,
	};
}
