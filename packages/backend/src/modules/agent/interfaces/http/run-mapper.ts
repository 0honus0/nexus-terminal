import type { AgentRunView } from '@nexus-terminal/shared/agent/runs/model';
import type { AgentRun } from '../../runs/model/run-types.js';

export function toRunView(value: AgentRun): AgentRunView {
	return {
		id: value.id,
		appId: value.appId,
		threadId: value.threadId,
		status: value.status,
		version: value.version,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}
