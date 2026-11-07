import { pluginCallOwner } from '../../plugins/plugin-caller-rules.js';
import { createHash } from 'node:crypto';
import { agentInteger, agentRecord, InvalidAgentPayload, readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import { readAgentPluginContentReference } from '@nexus-terminal/shared/agent/plugins/content';
import {
	readAgentPluginModelRequest,
	readAgentPluginModelSelection,
} from '@nexus-terminal/shared/agent/plugins/app-runtime';
import { readAgentPluginCheckpointWrite } from '@nexus-terminal/shared/agent/plugins/run-context';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { pluginContractText } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import { AgentFailure, aggregateAgentFailures, isAgentDrainFailure } from '../../agent-failure.js';
import { authorizationFact } from '../../governance/governance-rules.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { OperationContentService } from '../../operations/service/operation-content-service.js';
import type { OperationDispatchAuthority } from '../../operations/model/operation-types.js';
import { operationReceiptFailure } from '../../operations/model/operation-failure.js';
import type { RunAppCapabilityFactory, RunAppCapabilitySession } from '../../runs/model/run-app-driver-types.js';
import type { ModelInvocationService } from '../../providers/service/model-invocation-service.js';
import type { RunAppStateService } from '../../runs/service/run-app-state-service.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { PluginCapabilitySource } from '../../plugins/model/plugin-run-types.js';
import type { PluginRunCapabilityExtensions } from '../../plugins/model/plugin-run-capability-types.js';
import type { RunConfigurationCapabilities } from './run-configuration-capabilities.js';
import type { RunCollaborationService } from '../../runs/service/run-collaboration-service.js';
import { toPluginRunInfo, toPluginCheckpoint } from './run-state-mapper.js';

/** The execution core receives a narrow factory; protocol decoding and concrete capabilities live here. */
export class RunPluginCapabilities implements RunAppCapabilityFactory {
	constructor(
		private readonly governance: GovernanceService,
		private readonly settings: ExecutionService,
		private readonly contents: OperationContentService,
		private readonly models: ModelInvocationService,
		private readonly states: RunAppStateService,
		private readonly plugins: PluginService,
		private readonly configurations: RunConfigurationCapabilities,
		private readonly extensions: PluginRunCapabilityExtensions,
		private readonly collaboration: RunCollaborationService,
	) {}

	open(input: Parameters<RunAppCapabilityFactory['open']>[0]): RunAppCapabilitySession {
		const modelIndexes = new Map<string, number>();

		const onModelText = async (operationId: string, text: string) => {
			let index = modelIndexes.get(operationId) ?? 0;
			for (let start = 0; start < text.length;) {
				let end = Math.min(text.length, start + 16384);
				const last = text.charCodeAt(end - 1);
				if (end < text.length && last >= 0xd800 && last <= 0xdbff) {
					end--;
				}
				await this.states.append(input.scope, {
					ownerId: 'host.model',
					key: operationId,
					operationId,
					index,
					text: text.slice(start, end),
				});
				modelIndexes.set(operationId, ++index);
				start = end;
			}
		};

		const visibleCapabilities = async (source: PluginCapabilitySource) => {
			await input.assertCurrent();
			const catalog = await this.governance.toolCatalog(input.scope.userId, input.scope.appId, input.scope.runId);
			if (!catalog) {
				throw new AgentFailure('version_conflict');
			}
			return source.capabilities.filter((capability) => catalog.capabilities.includes(capability));
		};

		const authorize = async (source: PluginCapabilitySource): Promise<OperationDispatchAuthority> => {
			await input.assertCurrent();
			await this.plugins.assertRunSource(input.scope, source);
			const facts = await this.governance.operationAuthority(
				input.scope.userId,
				input.scope.appId,
				input.scope.runId,
			);
			if (
				!facts ||
				!source.capabilities.includes('plugin.invoke') ||
				!authorizationFact(facts.policy, 'plugin.invoke', null).allowed
			) {
				throw new AgentFailure('forbidden');
			}
			const settings = await this.settings.get(input.scope.userId);
			if (!settings.enabled) {
				throw new AgentFailure('execution_disabled');
			}
			await input.assertCurrent();
			return {
				policyRevision: facts.policy.revision,
				policyExecutionVersion: facts.policyExecutionVersion,
				denylistRevision: facts.denylistRevision,
				settingsVersion: settings.version,
				instance: {
					id: source.instanceId,
					packageId: source.packageId,
					generation: source.generation,
					configurationRevision: source.configurationRevision,
					packageRevision: source.packageRevision,
				},
				ancestors: source.ancestors.map((item) => ({
					id: item.instanceId,
					packageId: item.packageId,
					generation: item.generation,
					configurationRevision: item.configurationRevision,
					packageRevision: item.packageRevision,
				})),
				provider: null,
				target: null,
				modelReservation: null,
				approval: null,
			};
		};

		const extension = this.extensions.open({
			execution: input.execution,
			scope: input.scope,
			assertCurrent: input.assertCurrent,
			reportFailure: input.reportFailure,
			operation: input.operation,
			settleOperations: input.settleOperations,
			authorize,
			visibleCapabilities,
		});

		const visibleToolKeys = async (): Promise<readonly string[] | null> => {
			const participant = await this.collaboration.participant(input.scope);
			if (!participant) {
				throw new AgentFailure('not_found');
			}
			return participant.parentId === null ? null : participant.tools.map((name) => name);
		};

		return {
			validateResult: async (result) => {
				for (const ref of result.kind === 'complete' ? result.outputs : [result.inputRequest]) {
					await this.contents.read(
						input.scope,
						{ id: ref.id, sha256: ref.sha256, sizeBytes: ref.sizeBytes, mediaType: ref.mediaType },
						0,
					);
				}
				if (
					result.kind === 'suspend' &&
					(await this.states.read(input.scope))?.version !== result.checkpointVersion
				) {
					throw new AgentFailure('version_conflict');
				}
				await input.assertCurrent();
			},

			ready: async () => {
				if (!(await this.collaboration.prepare(input.scope, input.execution.signal))) {
					throw new AgentFailure('version_conflict');
				}
			},

			visibleToolKeys,
			authorize,
			visibleCapabilities,

			drain: async (completed) => {
				const outcomes = await Promise.allSettled([
					Promise.resolve().then(() => extension.drain()),
					Promise.resolve().then(() => (completed ? undefined : this.collaboration.drain(input.scope))),
				]);
				const failures = outcomes.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
				try {
					await input.settleOperations();
				} catch (error) {
					failures.push(error);
				}
				try {
					await this.plugins.releaseResources(input.scope);
				} catch (error) {
					failures.push(error);
				}
				// The operation barrier includes any late child creation by an already accepted delegate call.
				if (completed) {
					try {
						if (failures.length) {
							await this.collaboration.drain(input.scope);
						} else {
							await this.collaboration.finishChildren(input.scope);
						}
					} catch (error) {
						failures.push(error);
						try {
							await this.collaboration.drain(input.scope);
						} catch (cleanup) {
							failures.push(cleanup);
						}
					}
				}
				if (failures.length) {
					throw aggregateAgentFailures(failures, 'App capability resources did not settle');
				}
			},

			call: async (request, source, signal) => {
				try {
					if (request.method === 'transport.session.close') {
						return await extension.call(request, source, signal);
					}
					signal.throwIfAborted();
					// Receipt lookup belongs before today's provider/configuration resolution.
					// New effects authorize inside prepare/dispatch; reads authorize immediately.
					if (
						![
							'models.invoke',
							'configuration.write',
							'storage.write',
							'host.perform',
							'transport.session.open',
							'run.setTitle',
						].includes(request.method)
					) {
						await authorize(source);
					}
					let raw: unknown;
					try {
						raw = JSON.parse(request.inputJson);
					} catch {
						throw new InvalidAgentPayload();
					}
					const ownerId = pluginCallOwner(input.scope.runId, source.instanceId, source.operationId);
					const writeScope = {
						userId: input.scope.userId,
						appId: input.scope.appId,
						runId: input.scope.runId,
						executionGeneration: input.scope.executionGeneration,
						operationId: source.operationId,
					};
					if (
						[
							'configuration.read',
							'configuration.list',
							'configuration.write',
							'storage.read',
							'storage.list',
							'storage.write',
						].includes(request.method)
					) {
						return await this.configurations.call(
							request.method,
							raw,
							source,
							signal,
							input,
							authorize,
							visibleCapabilities,
						);
					}
					if (request.method === 'run.describe' || request.method === 'run.readCheckpoint') {
						agentRecord(raw, []);
						if (
							request.method === 'run.readCheckpoint' &&
							(source.instanceId !== input.scope.appId || source.operationId !== null)
						) {
							throw new AgentFailure('forbidden');
						}
						let value;
						if (request.method === 'run.describe') {
							const settings = await this.settings.frozen(
								input.scope.userId,
								input.scope.appId,
								input.scope.runId,
							);
							value = toPluginRunInfo(
								await this.states.describe(input.scope),
								settings.limits.maxToolOutputBytes,
							);
						} else {
							const checkpoint = await this.states.read(input.scope);
							value = checkpoint === null ? null : toPluginCheckpoint(checkpoint);
						}
						await authorize(source);
						signal.throwIfAborted();
						return { ok: true, valueJson: JSON.stringify(value) };
					}
					if (request.method === 'run.history') {
						const row = agentRecord(raw, ['before']);
						if (!(await visibleCapabilities(source)).includes('context.read')) {
							throw new AgentFailure('forbidden');
						}
						const value = await this.states.history(
							input.scope,
							row.before === null ? null : agentInteger(row.before, 1),
							AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024,
						);
						if (!(await visibleCapabilities(source)).includes('context.read')) {
							throw new AgentFailure('forbidden');
						}
						return { ok: true, valueJson: JSON.stringify(value) };
					}
					if (
						request.method === 'run.checkpoint' ||
						request.method === 'run.append' ||
						request.method === 'run.setTitle'
					) {
						const implementation = input.execution.frozen.appExecution;
						if (
							source.pure ||
							implementation.kind !== 'plugin' ||
							source.instanceId !== input.scope.appId ||
							source.packageId !== implementation.package.packageId ||
							source.operationId !== null
						) {
							throw new AgentFailure('forbidden');
						}
						if (request.method === 'run.setTitle') {
							const row = agentRecord(raw, ['operationKey', 'expectedThreadVersion', 'title']);
							if (typeof row.title !== 'string') {
								throw new InvalidAgentPayload();
							}
							const title = row.title;
							const expectedVersion = agentInteger(row.expectedThreadVersion, 1);
							const argumentsJson = JSON.stringify({ expectedThreadVersion: expectedVersion, title });
							const result = await input.operation({
								intent: {
									scope: input.scope,
									callerId: ownerId,
									parentId: null,
									operationKey: pluginContractText(row.operationKey),
									requestHash: createHash('sha256').update(argumentsJson).digest('hex'),
								},
								signal,

								prepare: () => ({
									record: true,
									kind: 'effect',
									label: 'thread.title',
									argumentsJson,
									bindingJson: JSON.stringify({ kind: 'thread.title', runId: input.scope.runId }),
									mayHaveExternalEffect: false,

									validate: async () => {
										await authorize(source);
									},

									authorize: () => authorize(source),

									execute: async (operation) => {
										if (!operation) {
											throw new AgentFailure('internal_failure');
										}
										return JSON.stringify(
											await this.states.setTitle(
												input.scope,
												operation.id,
												operation.requestHash,
												expectedVersion,
												title,
											),
										);
									},
								}),
							});
							if (result.kind !== 'receipt') {
								throw new AgentFailure('internal_failure');
							}
							const receipt = result.receipt;
							if (receipt.state !== 'completed' || receipt.resultJson === null) {
								throw operationReceiptFailure(receipt, 'version_conflict');
							}
							const updated: unknown = JSON.parse(receipt.resultJson);
							if (typeof updated !== 'boolean') {
								throw new AgentFailure('internal_failure');
							}
							return { ok: true, valueJson: JSON.stringify({ operationId: receipt.id, updated }) };
						}
						if (request.method === 'run.checkpoint') {
							const command = readAgentPluginCheckpointWrite(raw);
							const result = await this.states.checkpoint(input.scope, command.expectedVersion, {
								state: {
									id: command.state.id,
									sha256: command.state.sha256,
									sizeBytes: command.state.sizeBytes,
									mediaType: command.state.mediaType,
								},
								consumedOperationIds: command.consumedOperationIds.map((id) => id),
								pendingIntents: command.pendingIntents.map((intent) => ({
									operationKey: intent.operationKey,
									requestSha256: intent.requestSha256,
								})),
							});
							return { ok: true, valueJson: JSON.stringify(result) };
						}
						const command = agentRecord(
							raw,
							['key', 'index', 'text'],
							AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024,
						);
						if (typeof command.text !== 'string') {
							throw new InvalidAgentPayload();
						}
						await this.states.append(input.scope, {
							ownerId,
							key: pluginContractText(command.key),
							operationId: null,
							index: agentInteger(command.index),
							text: command.text,
						});
						return { ok: true, valueJson: 'null' };
					}
					if (request.method === 'content.open') {
						const row = agentRecord(raw, ['key', 'mediaType']);
						const value = await this.contents.open(
							writeScope,
							ownerId,
							pluginContractText(row.key),
							pluginContractText(row.mediaType),
						);
						return {
							ok: true,
							valueJson: JSON.stringify({ id: value.id, chunks: value.chunks, sealed: value.sealed }),
						};
					}
					if (request.method === 'content.append') {
						const row = agentRecord(raw, ['id', 'index', 'text'], AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024);
						if (typeof row.text !== 'string') {
							throw new InvalidAgentPayload();
						}
						const value = await this.contents.append(
							writeScope,
							ownerId,
							readAgentId(row.id),
							agentInteger(row.index),
							row.text,
						);
						return {
							ok: true,
							valueJson: JSON.stringify({ id: value.id, chunks: value.chunks, sealed: value.sealed }),
						};
					}
					if (request.method === 'content.seal') {
						const row = agentRecord(raw, ['id', 'chunks', 'sha256']);
						if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha256)) {
							throw new InvalidAgentPayload();
						}
						const value = await this.contents.seal(
							writeScope,
							ownerId,
							readAgentId(row.id),
							agentInteger(row.chunks),
							row.sha256,
							signal,
						);
						return {
							ok: true,
							valueJson: JSON.stringify({
								id: value.id,
								sha256: value.sha256,
								sizeBytes: value.sizeBytes,
								mediaType: value.mediaType,
							}),
						};
					}
					if (request.method === 'content.read') {
						const row = agentRecord(raw, ['reference', 'index']);
						const ref = readAgentPluginContentReference(row.reference);
						const includeThread = (await visibleCapabilities(source)).includes('context.read');
						const value = await this.contents.read(
							input.scope,
							{ id: ref.id, sha256: ref.sha256, sizeBytes: ref.sizeBytes, mediaType: ref.mediaType },
							agentInteger(row.index),
							includeThread,
						);
						await authorize(source);
						if (includeThread && !(await visibleCapabilities(source)).includes('context.read')) {
							throw new AgentFailure('forbidden');
						}
						return {
							ok: true,
							valueJson: JSON.stringify({
								reference: {
									id: value.reference.id,
									sha256: value.reference.sha256,
									sizeBytes: value.reference.sizeBytes,
									mediaType: value.reference.mediaType,
								},
								index: value.index,
								text: value.text,
								nextIndex: value.nextIndex,
							}),
						};
					}
					if (request.method === 'models.invoke') {
						if (source.pure) {
							throw new AgentFailure('forbidden');
						}
						const command = readAgentPluginModelRequest(raw);
						const value = await this.models.invoke(
							{
								operationKey: command.operationKey,
								model: {
									providerId: command.model.providerId,
									modelId: command.model.modelId,
									configurationVersion: command.model.configurationVersion,
									reasoningEffort: command.model.reasoningEffort,
								},
								systemPrompt: command.systemPrompt,
								messages: {
									id: command.messages.id,
									sha256: command.messages.sha256,
									sizeBytes: command.messages.sizeBytes,
									mediaType: command.messages.mediaType,
								},
								tools: command.tools.map((tool) => ({ name: tool.name, bindingId: tool.bindingId })),
								maxOutputTokens: command.maxOutputTokens,
								visible: command.visible,
							},
							{
								scope: input.scope,
								callerId: ownerId,
								parentId: source.operationId,
								signal: signal,
								assertCurrent: input.assertCurrent,
								reportFailure: input.reportFailure,

								authorize: () => authorize(source),

								operation: input.operation,

								resolveTools: async (tools) =>
									this.plugins.modelToolBindings(
										input.scope,
										{
											ancestors: source.ancestors.map((item) => ({
												instanceId: item.instanceId,
												packageId: item.packageId,
												generation: item.generation,
												configurationRevision: item.configurationRevision,
												packageRevision: item.packageRevision,
											})),
											instanceId: source.instanceId,
											generation: source.generation,
											packageId: source.packageId,
											packageRevision: source.packageRevision,
											operationId: source.operationId,
											configurationRevision: source.configurationRevision,
											capabilities: await visibleCapabilities(source),
											pure: source.pure,
										},
										tools,
										signal,
										await visibleToolKeys(),
									),

								onText: onModelText,

								assertArtifactAccess: async () => {
									await authorize(source);
									const facts = await this.governance.operationAuthority(
										input.scope.userId,
										input.scope.appId,
										input.scope.runId,
									);
									if (
										!facts ||
										!(await visibleCapabilities(source)).includes('artifacts.read') ||
										!authorizationFact(facts.policy, 'artifacts.read', null).allowed
									) {
										throw new AgentFailure('forbidden');
									}
								},
							},
						);
						return {
							ok: true,
							valueJson: JSON.stringify({
								operationId: value.operationId,
								body: {
									id: value.body.id,
									sha256: value.body.sha256,
									sizeBytes: value.body.sizeBytes,
									mediaType: value.body.mediaType,
								},
								inputTokens: value.inputTokens,
								outputTokens: value.outputTokens,
							}),
						};
					}
					if (request.method === 'models.describe') {
						const selection = readAgentPluginModelSelection(raw);
						const value = await this.models.describe(input.scope.userId, {
							providerId: selection.providerId,
							modelId: selection.modelId,
							configurationVersion: selection.configurationVersion,
							reasoningEffort: selection.reasoningEffort,
						});
						await authorize(source);
						return {
							ok: true,
							valueJson: JSON.stringify({
								protocol: value.protocol,
								contextWindow: value.contextWindow,
								maxOutputTokens: value.maxOutputTokens,
								supportsTools: value.supportsTools,
								supportsImageInput: value.supportsImageInput,
								reasoningEfforts: value.reasoningEfforts.map((effort) => effort),
								chosenReasoningEffort: value.chosenReasoningEffort,
							}),
						};
					}
					return await extension.call(request, source, signal);
				} catch (error) {
					if (error instanceof InvalidAgentPayload) {
						return { ok: false, code: 'invalid_input' };
					}
					if (error instanceof AgentFailure && !isAgentDrainFailure(error)) {
						return { ok: false, code: error.code };
					}
					throw error;
				}
			},
		};
	}
}
