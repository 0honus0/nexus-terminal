import { pluginCallOwner } from '../../plugins/plugin-caller-rules.js';
import { createHash } from 'node:crypto';
import { agentRecord, readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginConfigurationWrite } from '@nexus-terminal/shared/agent/plugins/settings-codec';
import { readAgentPluginDataWrite } from '@nexus-terminal/shared/agent/plugins/data';
import {
	AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
	AGENT_PLUGIN_MAX_MESSAGE_BYTES,
} from '@nexus-terminal/shared/agent/plugins/values';
import { pluginContractText } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import { AgentFailure } from '../../agent-failure.js';
import { authorizationFact } from '../../governance/governance-rules.js';
import { OperationEffectFailure } from '../../operations/model/operation-failure.js';
import type { OperationDispatchAuthority } from '../../operations/model/operation-types.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { OperationApprovalService } from '../../governance/service/operation-approval-service.js';
import type { PluginInstanceService } from '../../plugins/service/plugin-instance-service.js';
import type { PluginConfigurationPrincipal } from '../../plugins/model/plugin-instance-types.js';
import type { PluginCapabilitySource } from '../../plugins/model/plugin-run-types.js';
import type { PluginCapabilityReply } from '../../plugins/model/plugin-invocation-types.js';
import type { RunAppCapabilityFactory } from '../../runs/model/run-app-driver-types.js';
import { toPluginConfiguration, toPluginInstance, toPluginInstanceSettings } from './plugin-configuration-mapper.js';

/** Human and Run changes share one CAS owner; only the Run entry requires an effect approval. */
export class RunConfigurationCapabilities {
	constructor(
		private readonly instances: PluginInstanceService,
		private readonly governance: GovernanceService,
		private readonly approvals: OperationApprovalService,
	) {}

	async call(
		method: string,
		raw: unknown,
		source: PluginCapabilitySource,
		signal: AbortSignal,
		input: Parameters<RunAppCapabilityFactory['open']>[0],
		authorize: (source: PluginCapabilitySource) => Promise<OperationDispatchAuthority>,
		visibleCapabilities: (source: PluginCapabilitySource) => Promise<PluginCapabilitySource['capabilities']>,
	): Promise<PluginCapabilityReply> {
		const principal = async (operationId: string | null): Promise<PluginConfigurationPrincipal> => {
			const authority = await authorize(source);
			return {
				kind: 'run',
				userId: input.scope.userId,
				appId: input.scope.appId,
				runId: input.scope.runId,
				executionGeneration: input.scope.executionGeneration,
				operationId,
				policyRevision: authority.policyRevision,
				callerInstanceId: source.instanceId,
				callerGeneration: source.generation,
				participants: [
					...source.ancestors.map((item) => ({
						instanceId: item.instanceId,
						packageId: item.packageId,
						generation: item.generation,
						configurationRevision: item.configurationRevision,
						packageRevision: item.packageRevision,
					})),
					{
						instanceId: source.instanceId,
						packageId: source.packageId,
						generation: source.generation,
						configurationRevision: source.configurationRevision,
						packageRevision: source.packageRevision,
					},
				],
				capabilities: await visibleCapabilities(source),
			};
		};

		const recheck = async () => {
			signal.throwIfAborted();
			await authorize(source);
		};

		if (method === 'storage.read' || method === 'storage.list') {
			const row = agentRecord(
				raw,
				method === 'storage.read' ? ['namespace', 'key'] : ['namespace', 'after'],
				AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
			);
			const namespace = pluginContractText(row.namespace);
			const actor = await principal(source.operationId);
			const value =
				method === 'storage.read'
					? await this.instances.dataRead(actor, namespace, pluginContractText(row.key))
					: await this.instances.dataList(
							actor,
							namespace,
							row.after === null ? null : pluginContractText(row.after),
							AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024,
						);
			await recheck();
			return { ok: true, valueJson: JSON.stringify(value) };
		}
		if (method === 'storage.write') {
			if (source.pure) {
				throw new AgentFailure('forbidden');
			}
			const command = readAgentPluginDataWrite(raw);
			const requestJson = JSON.stringify({
				namespace: command.namespace,
				key: command.key,
				expectedRevision: command.expectedRevision,
				documentJson: command.documentJson,
			});
			const argumentsJson = JSON.stringify({
				namespace: command.namespace,
				key: command.key,
				expectedRevision: command.expectedRevision,
				documentSha256:
					command.documentJson === null
						? null
						: createHash('sha256').update(command.documentJson).digest('hex'),
			});
			const result = await input.operation({
				intent: {
					scope: input.scope,
					parentId: source.operationId,
					callerId: pluginCallOwner(input.scope.runId, source.instanceId, source.operationId),
					operationKey: command.operationKey,
					requestHash: createHash('sha256').update(requestJson).digest('hex'),
				},
				signal,

				prepare: async () => ({
					record: true,
					kind: 'effect',
					label: 'plugin.storage.write',
					argumentsJson,
					bindingJson: JSON.stringify({
						kind: 'plugin.storage',
						instanceId: source.instanceId,
						packageId: source.packageId,
						generation: source.generation,
						configurationRevision: source.configurationRevision,
					}),
					mayHaveExternalEffect: false,
					validate: recheck,

					authorize: () => authorize(source),

					execute: async (operation) => {
						if (!operation) {
							throw new AgentFailure('internal_failure');
						}
						const record = await this.instances.dataWrite(
							await principal(operation.id),
							command.namespace,
							command.key,
							command.expectedRevision,
							command.documentJson,
						);
						return JSON.stringify({
							key: record.key,
							revision: record.revision,
							deleted: record.documentJson === null,
						});
					},
				}),
			});
			if (result.kind !== 'receipt') {
				throw new AgentFailure('internal_failure');
			}
			const receipt = result.receipt;
			return {
				ok: true,
				valueJson: JSON.stringify(
					receipt.state === 'completed'
						? { kind: 'completed', operationId: receipt.id, resultJson: receipt.resultJson }
						: receipt.state === 'unknown' || receipt.state === 'cancelled'
							? {
									kind: 'interrupted',
									operationId: receipt.id,
									reason: receipt.state === 'unknown' ? 'effect_unknown' : 'cancelled',
								}
							: { kind: 'rejected', code: receipt.failureCode ?? 'version_conflict' },
				),
			};
		}
		if (method === 'configuration.list') {
			agentRecord(raw, [], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
			const value = await this.instances.listAuthorized(await principal(source.operationId), input.scope.appId);
			await recheck();
			return { ok: true, valueJson: JSON.stringify({ instances: value.map(toPluginInstance) }) };
		}
		if (method === 'configuration.read') {
			const row = agentRecord(raw, ['instanceId'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
			const value = await this.instances.read(
				await principal(source.operationId),
				input.scope.appId,
				readAgentId(row.instanceId),
			);
			await recheck();
			return { ok: true, valueJson: JSON.stringify(toPluginInstanceSettings(value)) };
		}
		if (method !== 'configuration.write' || source.pure) {
			throw new AgentFailure('forbidden');
		}
		const row = agentRecord(raw, ['instanceId', 'command'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
		const instanceId = readAgentId(row.instanceId);
		const command = readAgentPluginConfigurationWrite(row.command);
		const argumentsJson = JSON.stringify({
			instanceId,
			expectedPackageRevision: command.expectedPackageRevision,
			expectedRevision: command.expectedRevision,
			schemaRevision: command.schemaRevision,
			documentJson: command.documentJson,
		});
		let writeAttempted = false;
		const result = await input
			.operation({
				intent: {
					scope: input.scope,
					parentId: source.operationId,
					callerId: pluginCallOwner(input.scope.runId, source.instanceId, source.operationId),
					operationKey: command.operationKey,
					requestHash: createHash('sha256').update(argumentsJson).digest('hex'),
				},
				signal,

				prepare: async () => {
					// Resolve current schema only for a new operation. A replay never resolves today's instance.
					const write = {
						operationKey: command.operationKey,
						expectedPackageRevision: command.expectedPackageRevision,
						expectedRevision: command.expectedRevision,
						schemaRevision: command.schemaRevision,
						documentJson: command.documentJson,
					};
					const target = await this.instances.inspect(
						await principal(null),
						input.scope.appId,
						instanceId,
						write,
					);
					return {
						record: true,
						kind: 'effect',
						label: 'plugin.configuration.write',
						argumentsJson,
						bindingJson: JSON.stringify({
							kind: 'configuration',
							instanceId,
							package: target.package,
							packageRevision: target.packageRevision,
							configurationRevision: command.expectedRevision,
							schemaRevision: command.schemaRevision,
						}),
						mayHaveExternalEffect: false,
						validate: recheck,

						authorize: async (operation) => {
							if (!operation) {
								throw new AgentFailure('internal_failure');
							}
							const authority = await authorize(source);
							const facts = await this.governance.operationAuthority(
								input.scope.userId,
								input.scope.appId,
								input.scope.runId,
							);
							if (
								!facts ||
								facts.policy.revision !== authority.policyRevision ||
								!(await visibleCapabilities(source)).includes('plugin.configure') ||
								!authorizationFact(facts.policy, 'plugin.configure', null).allowed
							) {
								throw new AgentFailure('forbidden');
							}
							authority.approval = await this.approvals.permit(
								{
									operation,
									policyRevision: authority.policyRevision,
									capability: 'plugin.configure',
									risk: 'mutate',
									summary: target.instance.name,
									targetId: null,
								},
								signal,
							);
							return authority;
						},

						execute: async (operation) => {
							if (!operation) {
								throw new AgentFailure('internal_failure');
							}
							writeAttempted = true;
							const outcome = await this.instances.write(
								await principal(operation.id),
								input.scope.appId,
								instanceId,
								write,
							);
							return JSON.stringify(toPluginConfiguration(outcome.configuration));
						},
					};
				},
			})
			.finally(() => {
				// Re-read the actual configuration even after a lost commit/settlement reply.
				// Observers compare revisions, so a known failed CAS cannot restart a current instance.
				if (writeAttempted) {
					this.instances.changed(input.scope.userId, input.scope.appId, instanceId);
				}
			});
		if (result.kind !== 'receipt') {
			throw new AgentFailure('internal_failure');
		}
		const receipt = result.receipt;
		if (receipt.state === 'completed') {
			return {
				ok: true,
				valueJson: JSON.stringify({
					kind: 'completed',
					operationId: receipt.id,
					resultJson: receipt.resultJson,
				}),
			};
		}
		if (receipt.state === 'unknown' || receipt.state === 'cancelled') {
			return {
				ok: true,
				valueJson: JSON.stringify({
					kind: 'interrupted',
					operationId: receipt.id,
					reason: receipt.state === 'unknown' ? 'effect_unknown' : 'cancelled',
				}),
			};
		}
		if (receipt.state === 'failed') {
			return { ok: true, valueJson: JSON.stringify({ kind: 'rejected', code: receipt.failureCode }) };
		}
		throw new OperationEffectFailure('operation_unknown', 'unknown', 'closed');
	}
}
