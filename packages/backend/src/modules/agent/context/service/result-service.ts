import { readAgentPluginContentReference } from '@nexus-terminal/shared/agent/plugins/content';
import { agentRecord } from '@nexus-terminal/shared/agent/http-codec';
import { AgentFailure } from '../../agent-failure.js';
import { authorizationFact } from '../../governance/governance-rules.js';
import type { OperationEvidence } from '../../operations/model/operation-types.js';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import type { OperationModel } from '../../operations/model/operation-model.js';
import type { OperationContentService } from '../../operations/service/operation-content-service.js';
import type { HostEffect } from '../../tools/model/host-execution-types.js';
import type { ToolModel } from '../../tools/model/tool-model.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ResultReadInput, ResultReadOutcome } from '../model/context-types.js';
import { resultPage } from '../result-rules.js';

/** Registry parents declare capabilities without a target. Their real child effects
 * supply the exact scopes; a receipt from another branch cannot provide authority. */
function descendantTargets(captured: readonly OperationEvidence[], id: string, capability: AgentCapability): number[] {
	const byId = new Map(captured.map((entry) => [entry.operation.id, entry]));
	return captured.flatMap((entry) => {
		const target = entry.authority?.target;
		if (!target || !entry.capabilities.includes(capability)) {
			return [];
		}
		const visited = new Set<string>();
		let parentId = entry.operation.parentId;
		while (parentId !== null && !visited.has(parentId)) {
			if (parentId === id) {
				return [target.id];
			}
			visited.add(parentId);
			parentId = byId.get(parentId)?.operation.parentId ?? null;
		}
		return [];
	});
}

/** Reads captured receipts and their real effect provenance; never re-executes a handler. */
export class ResultService {
	constructor(
		private readonly operations: OperationModel,
		private readonly contents: OperationContentService,
		private readonly governance: GovernanceService,
		private readonly targets: ToolModel,
	) {}

	async read(
		input: ResultReadInput,
		reader: HostEffect,
		policyRevision: number,
		previewBytes: number,
		signal: AbortSignal,
	): Promise<ResultReadOutcome> {
		const captured = await this.operations.evidence(
			{
				userId: reader.userId,
				appId: reader.appId,
				runId: reader.runId,
				executionGeneration: reader.executionGeneration,
			},
			input.toolCallId,
		);
		const source = captured.find((entry) => entry.operation.id === input.toolCallId)?.operation;
		if (
			!source ||
			source.id === reader.id ||
			source.state !== 'completed' ||
			source.resultJson === null ||
			source.label === 'context.readResults'
		) {
			throw new AgentFailure('not_found');
		}
		const targets = new Map<number, { id: number; version: number }>();

		const validate = async () => {
			signal.throwIfAborted();
			const facts = await this.governance.operationAuthority(reader.userId, reader.appId, reader.runId);
			if (
				!facts ||
				facts.policy.revision !== policyRevision ||
				!authorizationFact(facts.policy, 'context.read', null).allowed
			) {
				throw new AgentFailure('version_conflict');
			}
			for (const entry of captured) {
				if (entry.operation.state === 'accepted' || entry.operation.state === 'cancelled') {
					continue;
				}
				if (entry.authority === null) {
					throw new AgentFailure('version_conflict');
				}
				const target = entry.authority.target;
				const required = entry.capabilities;
				if (
					required.some((capability) => {
						if (authorizationFact(facts.policy, capability, target?.id ?? null).allowed) {
							return false;
						}
						if (target !== null) {
							return true;
						}
						const scopes = descendantTargets(captured, entry.operation.id, capability);
						return (
							scopes.length === 0 ||
							scopes.some((id) => !authorizationFact(facts.policy, capability, id).allowed)
						);
					})
				) {
					throw new AgentFailure('forbidden');
				}
				if (target !== null) {
					if (
						!facts.connectionIds.includes(target.id) ||
						(await this.targets.target(target.id)).version !== target.version
					) {
						throw new AgentFailure('version_conflict');
					}
					targets.set(target.id, { id: target.id, version: target.version });
				}
			}
		};

		await validate();
		let text = source.resultJson;
		if (source.kind === 'tool') {
			const raw: unknown = JSON.parse(source.resultJson);
			const envelope = agentRecord(raw, ['content']);
			const content = readAgentPluginContentReference(envelope.content);
			text = await this.contents.text(
				{ userId: reader.userId, appId: reader.appId, runId: reader.runId },
				{ id: content.id, sha256: content.sha256, sizeBytes: content.sizeBytes, mediaType: content.mediaType },
				signal,
			);
		}
		const page = resultPage(text, input, previewBytes);
		await validate();
		return { page, targets: [...targets.values()] };
	}
}
