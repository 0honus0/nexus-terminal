import { AGENT_RUN_EVENT_MAX_LIMIT } from '@nexus-terminal/shared/agent/runs/values';
import { AGENT_THREAD_ENTRY_MAX_PAGE } from '@nexus-terminal/shared/agent/scope/values';
import { AgentFailure } from '../../agent-failure.js';
import type { RunStreamCursor, RunStreamPage } from '../model/run-stream-types.js';
import type { RunService } from './run-service.js';
import type { ContextHistoryService } from '../../context/service/context-history-service.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { RunCollaborationService } from './run-collaboration-service.js';

/** Cursor-based committed output, independent of the model request and browser lifetime. */
export class RunStreamService {
	constructor(
		private readonly runs: RunService,
		private readonly contexts: ContextHistoryService,
		private readonly governance: GovernanceService,
		private readonly collaboration: RunCollaborationService,
	) {}

	async read(
		userId: number,
		appId: string,
		runId: string,
		cursor: RunStreamCursor,
		includeState: boolean,
	): Promise<RunStreamPage> {
		const readBody = () =>
			this.contexts.entries(userId, appId, cursor.threadId, cursor.entries, AGENT_THREAD_ENTRY_MAX_PAGE);

		if (!includeState) {
			const body = await readBody();
			if (!body) {
				throw new AgentFailure('not_found');
			}
			return { body, state: null, more: body.items.length > 0 };
		}
		const [page, approvals, children, initialBody] = await Promise.all([
			this.runs.listEvents(userId, appId, runId, cursor.events, AGENT_RUN_EVENT_MAX_LIMIT),
			this.governance.approvals(userId, appId, runId),
			this.collaboration.listChildren({ userId, appId, runId }),
			readBody(),
		]);
		const run = await this.runs.get(userId, appId, runId);
		if (!run || run.threadId !== cursor.threadId || !page || !approvals || !children || !initialBody) {
			throw new AgentFailure('not_found');
		}
		if (page.items.some((event) => event.runVersion > run.version)) {
			throw new AgentFailure('internal_failure');
		}
		// The final state can be observed after an earlier body read; drain from the same cursor again.
		const body = run.status !== 'pending' && run.status !== 'running' ? await readBody() : initialBody;
		const usage = await this.runs.getUsage(userId, appId, runId);
		if (!body || !usage || usage.runVersion < run.version) {
			throw new AgentFailure('internal_failure');
		}
		return {
			body,
			state: { run, usage, events: page, approvals, children },
			more: body.items.length > 0 || page.items.length > 0,
		};
	}
}
