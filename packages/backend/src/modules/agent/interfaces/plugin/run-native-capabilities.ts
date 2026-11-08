import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { pluginCallOwner } from '../../plugins/plugin-caller-rules.js';
import { createHash } from 'node:crypto';
import { agentRecord, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginHostOperationRequest } from '@nexus-terminal/shared/agent/plugins/host-operations-codec';
import { pluginContractText } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import {
	AgentFailure,
	AgentResourceFenced,
	aggregateAgentFailures,
	ToolExecutionUnknown,
	ToolCleanupFailure,
	ToolOperationRefusal,
} from '../../agent-failure.js';
import { OperationEffectFailure, operationReceiptFailure } from '../../operations/model/operation-failure.js';
import { CollaborationRefusal } from '../../runs/run-collaboration-failure.js';
import type { OperationReceipt } from '../../operations/model/operation-types.js';
import type { OperationService } from '../../operations/service/operation-service.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import type { OperationApprovalService } from '../../governance/service/operation-approval-service.js';
import { authorizationFact } from '../../governance/governance-rules.js';
import { effectiveHostOperationPolicy } from '../../tools/host-operation-rules.js';
import { cloneHostOperationResult } from '../../tools/model/host-operation-result.js';
import type { HostEffect, HostEffectContribution, PreparedHostEffect } from '../../tools/model/host-execution-types.js';
import type { RunToolResources } from '../../tools/service/run-tool-resources.js';
import type {
	PluginRunCapabilityExtensions,
	PluginRunCapabilityExtension,
} from '../../plugins/model/plugin-run-capability-types.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { HostToolContributions } from '../../tools/service/host-tool-contributions.js';
import type { RunChanges } from '../../runs/model/run-changes.js';

/** Concrete native I/O is assembled outside the Run kernel and uses its one effect ledger. */
export class RunNativeCapabilities implements PluginRunCapabilityExtensions {
	private readonly contributions: ReadonlyMap<string, HostEffectContribution>;

	constructor(
		private readonly host: HostToolContributions,
		private readonly operations: OperationService,
		private readonly governance: GovernanceService,
		private readonly approvals: OperationApprovalService,
		private readonly resources: RunToolResources,
		private readonly plugins: PluginService,
		private readonly settings: ExecutionService,
		private readonly collaboration: RunCollaborationService,
		private readonly changes: RunChanges,
		private readonly transports: PluginRunCapabilityExtensions,
	) {
		const entries = new Map<string, HostEffectContribution>();
		for (const contribution of host.contributions()) {
			if (entries.has(contribution.definition.name)) {
				throw new Error('Duplicate native operation');
			}
			entries.set(contribution.definition.name, contribution);
		}
		this.contributions = entries;
	}

	open(input: Parameters<PluginRunCapabilityExtensions['open']>[0]): PluginRunCapabilityExtension {
		const unsubscribe = this.plugins.subscribeCapabilities(input.scope, () => this.changes.notify(input.scope));
		const transports = this.transports.open(input);
		return {
			drain: async () => {
				try {
					const results = await Promise.allSettled([
						Promise.resolve().then(() => transports.drain()),
						Promise.resolve().then(() => this.resources.drainRun(input.scope)),
					]);
					const failures = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
					if (failures.length) {
						if (failures.every((error) => error instanceof AgentResourceFenced)) {
							throw aggregateAgentFailures(failures, 'Native effects remain unconfirmed');
						}
						throw new ToolCleanupFailure({
							cause: new AggregateError(failures, 'Native resources did not close'),
						});
					}
				} finally {
					unsubscribe();
				}
			},

			call: async (request, source, signal) => {
				if (request.method.startsWith('transport.session.')) {
					return transports.call(request, source, signal);
				}
				if (request.method !== 'host.perform') {
					throw new AgentFailure('forbidden');
				}
				let raw: unknown;
				try {
					raw = JSON.parse(request.inputJson);
				} catch {
					throw new InvalidAgentPayload();
				}
				const row = agentRecord(raw, ['operationKey', 'request'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
				const command = readAgentPluginHostOperationRequest(row.request);
				const operationKey = pluginContractText(row.operationKey);
				const argumentsJson = JSON.stringify(command);
				const pluginConfiguration = {
					instanceId: source.instanceId,
					generation: source.generation,

					read: () => this.plugins.runSourceConfiguration(input.scope, source),
				};
				if (this.host.isMetadata(command.operation)) {
					const policy = effectiveHostOperationPolicy(command.operation, argumentsJson);
					if (!policy) {
						throw new AgentFailure('invalid_input');
					}
					const required = [policy.capability, ...policy.requirements.capabilities];

					const verify = async () => {
						signal.throwIfAborted();
						await input.assertCurrent();
						await this.plugins.assertRunSource(input.scope, source);
						const facts = await this.governance.operationAuthority(
							input.scope.userId,
							input.scope.appId,
							input.scope.runId,
						);
						const visible = await input.visibleCapabilities(source);
						if (
							!facts ||
							required.some(
								(capability) =>
									!visible.includes(capability) ||
									!authorizationFact(facts.policy, capability, null).allowed,
							)
						) {
							throw new AgentFailure('forbidden');
						}
						signal.throwIfAborted();
						return facts;
					};

					const value = await this.host.metadata(command, {
						pluginConfiguration,
						userId: input.scope.userId,
						appId: input.scope.appId,
						signal,
						verify,
					});
					return { ok: true, valueJson: JSON.stringify(value) };
				}
				if (source.pure) {
					throw new AgentFailure('forbidden');
				}
				const requestHash = createHash('sha256').update(argumentsJson).digest('hex');
				const completion: { prepared: PreparedHostEffect | null; executed: HostEffect | null } = {
					prepared: null,
					executed: null,
				};
				const outcome = await input.operation({
					intent: {
						scope: input.scope,
						parentId: source.operationId,
						callerId: pluginCallOwner(input.scope.runId, source.instanceId, source.operationId),
						operationKey,
						requestHash,
					},
					signal,

					prepare: async () => {
						const contribution = this.contributions.get(command.operation);
						const policy = effectiveHostOperationPolicy(command.operation, argumentsJson);
						if (!contribution || !policy) {
							throw new AgentFailure('forbidden');
						}
						const selected = await contribution.prepare(
							argumentsJson,
							{
								userId: input.scope.userId,
								appId: input.scope.appId,
								runId: input.scope.runId,
								deadlineAt: input.execution.command.deadlineAt,
							},
							signal,
						);
						completion.prepared = selected;
						const required = [policy.capability, ...policy.requirements.capabilities];

						const facts = async (taskSignal: AbortSignal) => {
							taskSignal.throwIfAborted();
							await input.assertCurrent();
							await this.plugins.assertRunSource(input.scope, source);
							const current = await this.governance.operationAuthority(
								input.scope.userId,
								input.scope.appId,
								input.scope.runId,
							);
							const visible = await input.visibleCapabilities(source);
							if (
								!current ||
								required.some(
									(capability) =>
										!visible.includes(capability) ||
										!authorizationFact(current.policy, capability, selected.target?.id ?? null)
											.allowed,
								) ||
								(selected.target !== null && !current.connectionIds.includes(selected.target.id))
							) {
								throw new AgentFailure('forbidden');
							}
							const participant = await this.collaboration.participant(input.scope);
							if (!participant || (policy.childAccess === 'root-only' && participant.parentId !== null)) {
								throw new AgentFailure('forbidden');
							}
							await selected.validate();
							taskSignal.throwIfAborted();
							return current;
						};

						await facts(signal);
						return {
							record: true,
							kind: 'effect',
							label: command.operation,
							argumentsJson,
							bindingJson: JSON.stringify({
								kind: 'native',
								name: command.operation,
								version: policy.version,
								summary: selected.summary,
								risk: selected.risk,
								mutation: selected.mutation,
								capability: policy.capability,
								requiredCapabilities: policy.requirements.capabilities.map((item) => item),
								target:
									selected.target === null
										? null
										: {
												id: selected.target.id,
												version: selected.target.version,
												fingerprint: selected.target.fingerprint,
											},
							}),
							mayHaveExternalEffect: selected.mutation,

							validate: async () => {
								await facts(signal);
							},

							authorize: async (operation) => {
								if (!operation) {
									throw new AgentFailure('internal_failure');
								}
								const current = await facts(signal);
								const authority = await input.authorize(source);
								if (authority.policyRevision !== current.policy.revision) {
									throw new AgentFailure('version_conflict');
								}
								authority.target =
									selected.target === null
										? null
										: { id: selected.target.id, version: selected.target.version };
								if (selected.risk === 'forbidden') {
									throw new AgentFailure('forbidden');
								}
								if (selected.risk !== 'read' || selected.mutation) {
									authority.approval = await this.approvals.permit(
										{
											operation,
											policyRevision: authority.policyRevision,
											capability: policy.capability,
											risk: selected.risk,
											summary: selected.summary,
											targetId: selected.target?.id ?? null,
										},
										signal,
									);
								}
								return authority;
							},

							execute: async (operation, childSignal) => {
								if (!operation) {
									throw new AgentFailure('internal_failure');
								}
								const settings = await this.settings.frozen(
									input.scope.userId,
									input.scope.appId,
									input.scope.runId,
								);
								const effect: HostEffect = {
									id: operation.id,
									userId: input.scope.userId,
									appId: input.scope.appId,
									runId: input.scope.runId,
									executionGeneration: input.scope.executionGeneration,
									operationHash: operation.requestHash,
								};
								completion.executed = effect;
								const artifacts = new Set<string>();
								const release = this.resources.activity(input.scope);

								const verify = async (taskSignal: AbortSignal) => {
									await this.operations.verifyEffect(
										operation,
										command.operation === 'shell.execute',
									);
									return facts(taskSignal);
								};

								try {
									const result = await selected.execute({
										pluginConfiguration,
										operation: effect,
										revision: (await facts(childSignal)).policy.revision,
										signal: childSignal,
										limits: settings.limits,

										validate: async () => {
											await verify(childSignal);
										},

										verify,

										recordOutputArtifacts: (ids) => {
											for (const id of ids) {
												artifacts.add(id);
											}
										},

										availableTools: async () => {
											const participant = await this.collaboration.participant(input.scope);
											if (!participant) {
												throw new AgentFailure('not_found');
											}
											const catalog = await this.governance.toolCatalog(
												input.scope.userId,
												input.scope.appId,
												input.scope.runId,
											);
											if (!catalog) {
												throw new AgentFailure('not_found');
											}
											const keys = await this.plugins.availableToolKeys(
												input.scope,
												source,
												catalog.capabilities,
												childSignal,
											);
											return participant.parentId === null
												? keys
												: keys.filter((key) => participant.tools.includes(key));
										},

										run: {
											signal: input.execution.signal,
											deadlineAt: input.execution.command.deadlineAt,

											onBackgroundFailure: (error) =>
												input.execution.onBackgroundFailure(error, command.operation),
										},
									});
									if (artifacts.size) {
										await this.operations.confirmArtifacts(operation, [...artifacts]);
									}
									return JSON.stringify(cloneHostOperationResult(result.hostResult));
								} catch (error) {
									await this.retainArtifacts(operation, artifacts, error);
									if (error instanceof ToolExecutionUnknown) {
										throw new OperationEffectFailure(
											'operation_unknown',
											'unknown',
											error instanceof ToolCleanupFailure ? 'unknown' : 'closed',
											{ cause: error },
										);
									}
									if (
										error instanceof ToolOperationRefusal ||
										error instanceof CollaborationRefusal
									) {
										throw new OperationEffectFailure(error.code, 'not_started', 'closed', {
											cause: error,
										});
									}
									throw error;
								} finally {
									release();
								}
							},
						};
					},
				});
				if (outcome.kind !== 'receipt') {
					throw new AgentFailure('internal_failure');
				}
				if (outcome.receipt.state !== 'completed' || outcome.receipt.resultJson === null) {
					throw operationReceiptFailure(outcome.receipt, 'version_conflict');
				}
				if (completion.prepared !== null && completion.executed !== null) {
					completion.prepared.afterCommit?.(completion.executed);
				}
				return { ok: true, valueJson: outcome.receipt.resultJson };
			},
		};
	}

	private async retainArtifacts(
		operation: OperationReceipt,
		artifacts: ReadonlySet<string>,
		error: unknown,
	): Promise<void> {
		if (!artifacts.size) {
			return;
		}
		try {
			await this.operations.confirmArtifacts(operation, [...artifacts]);
		} catch (evidence) {
			throw new AgentFailure('operation_unknown', {
				cause: new AggregateError([error, evidence], 'Native output evidence unconfirmed'),
			});
		}
	}
}
