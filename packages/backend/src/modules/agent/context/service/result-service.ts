import { toolAuthorityIdentity } from '../../governance/governance-rules.js';
import { AgentFailure } from '../../agent-failure.js';
import type { RunToolModel } from '../../runs/model/run-tool-model.js';
import type { ToolOperation } from '../../runs/model/run-tool-types.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ResultReadInput, ResultReadOutcome } from '../model/context-types.js';
import { resultPage } from '../result-rules.js';

/** Reads existing captured facts; never invokes the original tool or an external resource. */
export class ResultService {
	constructor(
		private readonly journal: RunToolModel,
		private readonly governance: GovernanceService,
	) {}

	async read(input: ResultReadInput, reader: ToolOperation, policyRevision: number): Promise<ResultReadOutcome> {
		const source = await this.journal.get({
			userId: reader.userId,
			appId: reader.appId,
			runId: reader.runId,
			id: input.toolCallId,
		});
		if (
			!source ||
			source.state !== 'completed' ||
			source.resultText === null ||
			source.modelStepIndex >= reader.modelStepIndex ||
			source.toolName === 'tool_result_read'
		) {
			throw new AgentFailure('not_found');
		}
		const authority = await this.governance.toolAuthority(toolAuthorityIdentity(source), {
			kind: 'verify',
			policyRevision,
		});
		if (
			!authority ||
			(source.toolName === 'machine_connection_list' &&
				authority.connectionIds.some((id) => authority.policy.app.deniedTargetIds.includes(id)))
		) {
			throw new AgentFailure('version_conflict');
		}
		if (source.targetId !== null && source.targetVersion === null) {
			throw new AgentFailure('internal_failure');
		}
		return {
			page: resultPage(source.resultText, input),
			targets:
				source.targetId !== null && source.targetVersion !== null
					? [{ id: source.targetId, version: source.targetVersion }]
					: [],
		};
	}
}
