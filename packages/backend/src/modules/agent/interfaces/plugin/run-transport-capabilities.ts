import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { pluginCallOwner } from '../../plugins/plugin-caller-rules.js';
import { createHash, randomUUID } from 'node:crypto';
import { agentRecord, readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import { pluginContractText } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import {
	readAgentPluginServiceTransportRequest,
	readAgentPluginServiceTransportResult,
} from '@nexus-terminal/shared/agent/plugins/service-transport-codec';
import type { AgentCapability } from '@nexus-terminal/shared/agent/governance/values';
import { AgentFailure, isAgentDrainFailure, aggregateAgentFailures } from '../../agent-failure.js';
import { authorizationFact } from '../../governance/governance-rules.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { OperationApprovalService } from '../../governance/service/operation-approval-service.js';
import { OperationEffectFailure, operationReceiptFailure } from '../../operations/model/operation-failure.js';
import type { OperationReceipt } from '../../operations/model/operation-types.js';
import type { PluginConnectionService } from '../../plugins/service/plugin-connection-service.js';
import { PluginServiceTransportOwner } from '../../plugins/service/plugin-service-transport.js';
import type {
	PluginServicePermissionInput,
	PluginServicePermissionResponse,
	PluginServiceTransportSelection,
} from '../../plugins/service/plugin-service-transport.js';
import type {
	PluginRunCapabilityExtensions,
	PluginRunCapabilityExtension,
} from '../../plugins/model/plugin-run-capability-types.js';
import type { PluginCapabilitySource } from '../../plugins/model/plugin-run-types.js';
import type { PluginService } from '../../plugins/service/plugin-service.js';
import type { ToolModel } from '../../tools/model/tool-model.js';
import type { ToolTarget } from '../../tools/model/tool-types.js';
import type { RunChanges } from '../../runs/model/run-changes.js';
import type { ToolProtocolResources } from '../../tools/model/tool-runtime-types.js';
import type { ToolJobScope } from '../../tools/model/tool-job-types.js';

type Input = Parameters<PluginRunCapabilityExtensions['open']>[0];

interface Session {
	id: string;
	instanceId: string;
	generation: string;
	transport: PluginServiceTransportOwner;
	validateCaller(source: PluginCapabilitySource): Promise<void>;
	request(
		source: PluginCapabilitySource,
		operationKey: string,
		command: import('@nexus-terminal/shared/agent/plugins/service-transport').AgentPluginServiceTransportRequest,
		signal: AbortSignal,
	): Promise<import('@nexus-terminal/shared/agent/plugins/service-transport').AgentPluginServiceTransportResult>;
	closed: boolean;
	close(): Promise<void>;
}

function hash(json: string): string {
	return createHash('sha256').update(json).digest('hex');
}

/** A durable session operation stays dispatched until the execution-owned transport actually closes. */
export class RunTransportCapabilities implements PluginRunCapabilityExtensions, ToolProtocolResources {
	private readonly owners = new Map<string, { scope: ToolJobScope; count(): number; close(): Promise<void> }>();

	constructor(
		private readonly connections: PluginConnectionService,
		private readonly governance: GovernanceService,
		private readonly approvals: OperationApprovalService,
		private readonly plugins: PluginService,
		private readonly tools: ToolModel,
		private readonly changes: RunChanges,
	) {}

	count(scope: ToolJobScope): number {
		const owner = this.owners.get(scope.runId);
		return owner?.scope.userId === scope.userId && owner.scope.appId === scope.appId ? owner.count() : 0;
	}

	drainRun(scope: ToolJobScope): Promise<void> {
		const owner = this.owners.get(scope.runId);
		return owner?.scope.userId === scope.userId && owner.scope.appId === scope.appId
			? owner.close()
			: Promise.resolve();
	}

	open(input: Input): PluginRunCapabilityExtension {
		const sessions = new Map<string, Session>();
		const openings = new Map<string, Promise<Session>>();
		const stop = new AbortController();
		const lifetime = AbortSignal.any([input.execution.signal, stop.signal]);
		let draining = false;
		let closing: Promise<void> | null = null;
		let resourcesClosing: Promise<void> | null = null;
		let resourceStop = new AbortController();
		const owner = {
			scope: { userId: input.scope.userId, appId: input.scope.appId, runId: input.scope.runId },

			count: () => [...sessions.values()].filter((session) => !session.closed).length,

			close: (): Promise<void> => {
				if (resourcesClosing) {
					return resourcesClosing;
				}
				resourcesClosing = Promise.resolve().then(async () => {
					await Promise.allSettled([...openings.values()]);
					const outcomes = await Promise.allSettled(
						[...sessions.values()].map((session) => Promise.resolve().then(() => session.close())),
					);
					const failures = outcomes.flatMap((result) =>
						result.status === 'rejected' ? [result.reason] : [],
					);
					if (failures.length) {
						throw aggregateAgentFailures(failures, 'Protocol sessions did not close');
					}
					openings.clear();
					await this.plugins.releaseResources(input.scope);
					resourceStop = new AbortController();
					resourcesClosing = null;
				});
				// Stop approval/setup before awaiting publication. Otherwise manual close
				// could wait forever for a pending grant while admitting another session.
				resourceStop.abort();
				return resourcesClosing;
			},
		};
		if (this.owners.has(input.scope.runId)) {
			throw new AgentFailure('active_run_conflict');
		}
		this.owners.set(input.scope.runId, owner);
		const unsubscribe = this.connections.subscribe((scope) => {
			if (scope.userId === input.scope.userId && scope.appId === input.scope.appId) {
				this.changes.notify(input.scope);
			}
		});
		return {
			drain: () =>
				(closing ??= Promise.resolve().then(async () => {
					draining = true;
					// Cancel pending approval/connection setup before waiting for its published resource.
					stop.abort();
					try {
						await owner.close();
						this.owners.delete(input.scope.runId);
					} finally {
						unsubscribe();
					}
				})),

			call: async (request, source, signal) => {
				if (source.pure || ((draining || resourcesClosing) && request.method !== 'transport.session.close')) {
					throw new AgentFailure('forbidden');
				}
				const release =
					request.method === 'transport.session.close' ? () => {} : this.tools.activity(input.scope);
				try {
					const raw: unknown = JSON.parse(request.inputJson);
					if (request.method === 'transport.session.open') {
						const row = agentRecord(raw, ['operationKey'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES);
						const operationKey = pluginContractText(row.operationKey);
						const key = JSON.stringify([
							source.instanceId,
							source.generation,
							source.operationId,
							operationKey,
						]);
						let opening = openings.get(key);
						if (!opening) {
							opening = this.start(
								input,
								source,
								operationKey,
								sessions,
								AbortSignal.any([lifetime, resourceStop.signal]),
							);
							openings.set(key, opening);
						}
						const session = await opening;
						if (draining || signal.aborted) {
							await session.close();
							signal.throwIfAborted();
							throw new AgentFailure('forbidden');
						}
						return {
							ok: true,
							valueJson: JSON.stringify({ sessionId: session.id, transport: session.transport.facts }),
						};
					}
					const row = agentRecord(
						raw,
						request.method === 'transport.session.close'
							? ['sessionId']
							: ['sessionId', 'operationKey', 'request'],
						AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
					);
					const session = sessions.get(readAgentId(row.sessionId));
					if (
						!session ||
						session.instanceId !== source.instanceId ||
						session.generation !== source.generation
					) {
						throw new AgentFailure('forbidden');
					}
					if (request.method === 'transport.session.close') {
						await session.close();
						return { ok: true, valueJson: 'null' };
					}
					if (request.method !== 'transport.session.call') {
						throw new AgentFailure('invalid_input');
					}
					await session.validateCaller(source);
					const command = readAgentPluginServiceTransportRequest(row.request);

					const cancelled = () => {
						void session
							.close()
							.catch((error: unknown) => input.execution.onBackgroundFailure(error, 'transport.session'));
					};

					signal.addEventListener('abort', cancelled, { once: true });
					try {
						if (signal.aborted) {
							cancelled();
							signal.throwIfAborted();
						}
						const result = await session.request(
							source,
							pluginContractText(row.operationKey),
							command,
							signal,
						);
						signal.throwIfAborted();
						await session.validateCaller(source);
						return { ok: true, valueJson: JSON.stringify(result) };
					} finally {
						signal.removeEventListener('abort', cancelled);
					}
				} finally {
					release();
				}
			},
		};
	}

	private async start(
		input: Input,
		source: PluginCapabilitySource,
		operationKey: string,
		sessions: Map<string, Session>,
		originalLifetime: AbortSignal,
	): Promise<Session> {
		const retirement = new AbortController();
		const lifetime = AbortSignal.any([originalLifetime, retirement.signal]);

		let publish: (session: Session) => void = () => {};

		let refuse: (error: unknown) => void = () => {};

		const ready = new Promise<Session>((resolve, reject) => {
			publish = resolve;
			refuse = reject;
		});
		const args = JSON.stringify({
			instanceId: source.instanceId,
			generation: source.generation,
			configurationRevision: source.configurationRevision,
			originOperationId: source.operationId,
		});
		let created: Session | null = null;
		const task = input.operation({
			intent: {
				scope: input.scope,
				callerId: 'transport:' + pluginCallOwner(input.scope.runId, source.instanceId, source.operationId),
				parentId: null,
				operationKey,
				requestHash: hash(args),
			},
			signal: lifetime,

			prepare: async () => {
				const connection = await this.connections.source(
					input.scope.userId,
					input.scope.appId,
					source.instanceId,
				);
				const connector = connection.connection.connector;
				if (connector.kind === 'none') {
					throw new AgentFailure('provider_unavailable');
				}
				const capability: AgentCapability =
					connector.kind === 'http' ? 'service.transport.http' : 'service.transport.process';
				const target =
					connector.kind === 'remoteProcess' ? await this.tools.target(connector.connectionId) : null;

				const validate = async (caller = source) => {
					lifetime.throwIfAborted();
					await input.assertCurrent();
					await this.plugins.assertRunSource(input.scope, caller);
					await input.authorize(caller);
					const current = await this.connections.source(
						input.scope.userId,
						input.scope.appId,
						source.instanceId,
					);
					if (current.connection.revision !== connection.connection.revision) {
						throw new AgentFailure('version_conflict');
					}
					const facts = await this.governance.operationAuthority(
						input.scope.userId,
						input.scope.appId,
						input.scope.runId,
					);
					if (
						!facts ||
						!(await input.visibleCapabilities(caller)).includes(capability) ||
						!authorizationFact(facts.policy, capability, target?.id ?? null).allowed ||
						(target !== null && !facts.connectionIds.includes(target.id))
					) {
						throw new AgentFailure('forbidden');
					}
					if (target) {
						await this.tools.validateTarget(target);
					}
					lifetime.throwIfAborted();
					return facts;
				};

				await validate();
				return {
					record: true,
					kind: 'effect',
					label: 'transport.session',
					argumentsJson: args,
					bindingJson: this.binding(
						'transport.session',
						capability,
						connector.kind === 'http' ? connector.endpoint : connector.argv.join(' '),
						target,
					),
					mayHaveExternalEffect: connector.kind === 'remoteProcess',

					validate: async () => {
						await validate();
					},

					authorize: async (operation) => {
						if (!operation) {
							throw new AgentFailure('internal_failure');
						}
						await validate();
						const authority = await input.authorize(source);
						authority.target = target === null ? null : { id: target.id, version: target.version };
						// HTTP allocation performs no request. Process consent binds the exact launch argv/cwd;
						// later protocol writes retain their own effect approval.
						if (connector.kind === 'remoteProcess') {
							authority.approval = await this.approvals.permit(
								{
									operation,
									policyRevision: authority.policyRevision,
									capability,
									risk: 'destructive',
									summary: connector.argv.join(' '),
									targetId: target?.id ?? null,
								},
								lifetime,
							);
						}
						return authority;
					},

					execute: async (operation) => {
						if (!operation) {
							throw new AgentFailure('internal_failure');
						}
						const selection: PluginServiceTransportSelection =
							connector.kind === 'http'
								? {
										kind: 'http',
										options: {
											url: connector.endpoint,
											headers:
												connection.credential === null
													? []
													: [
															{
																name: 'authorization',
																value: 'Bearer ' + connection.credential,
															},
														],
											// Responses are pulled in bounded chunks. An RPC envelope is not a session's total output budget.
											privateAuthorities: connector.privateAuthorities.map((item) => item),
											maxResponseBytes: Number.MAX_SAFE_INTEGER,
										},
									}
								: {
										kind: 'remoteProcess',
										cwd: connector.cwd,

										run: async (signal, consume) => {
											if (!target) {
												throw new AgentFailure('internal_failure');
											}
											await this.tools.remote(input.scope).withProcess(
												{
													operationId: operation.id,
													target,
													timeoutMs: Math.max(
														1,
														input.execution.command.deadlineAt - Date.now(),
													),
													signal,

													validate: async () => {
														await validate();
													},
												},
												{
													argv: connector.argv.map((arg) => arg),
													cwd: connector.cwd,
													maxReadBytes: Number.MAX_SAFE_INTEGER,
												},
												consume,
											);
										},

										permission: (permission, signal) =>
											this.permission(
												input,
												source,
												operation,
												capability,
												target,
												permission,
												signal,
											),
									};

						let release: () => void = () => {};

						const finished = new Promise<void>((resolve) => {
							release = resolve;
						});
						const transport = new PluginServiceTransportOwner({
							signal: lifetime,

							validate: async () => {
								await validate();
							},

							transport: selection,
						});
						let close: Promise<void> | null = null;
						const id = randomUUID();
						const session: Session = {
							id,
							instanceId: source.instanceId,
							generation: source.generation,
							transport,
							closed: false,

							validateCaller: async (caller) => {
								await validate(caller);
							},

							request: async (caller, operationKey, command, signal) => {
								if (!['transport.http.request', 'transport.stdio.write'].includes(command.method)) {
									return transport.dispatch(command);
								}
								const argumentsJson = JSON.stringify({ sessionId: id, request: command });
								const outcome = await input.operation({
									intent: {
										scope: input.scope,
										parentId: caller.operationId,
										callerId: pluginCallOwner(
											input.scope.runId,
											caller.instanceId,
											caller.operationId,
										),
										operationKey: 'transport:' + operationKey,
										requestHash: hash(argumentsJson),
									},
									signal,

									prepare: async () => ({
										record: true,
										kind: 'effect',
										label: command.method,
										argumentsJson,
										bindingJson: this.binding(
											command.method,
											capability,
											connector.kind === 'http' ? connector.endpoint : connector.argv.join(' '),
											target,
										),
										mayHaveExternalEffect: true,

										validate: async () => {
											await validate(caller);
										},

										authorize: async (effect) => {
											if (!effect) {
												throw new AgentFailure('internal_failure');
											}
											await validate(caller);
											const proof = await input.authorize(caller);
											proof.target =
												target === null ? null : { id: target.id, version: target.version };
											proof.approval = await this.approvals.permit(
												{
													operation: effect,
													policyRevision: proof.policyRevision,
													capability,
													risk: 'destructive',
													summary: command.method,
													targetId: target?.id ?? null,
												},
												signal,
											);
											return proof;
										},

										execute: async () => JSON.stringify(await transport.dispatch(command)),
									}),
								});
								if (outcome.kind !== 'receipt') {
									throw new AgentFailure('internal_failure');
								}
								if (outcome.receipt.state !== 'completed' || outcome.receipt.resultJson === null) {
									throw operationReceiptFailure(outcome.receipt, 'forbidden');
								}
								return readAgentPluginServiceTransportResult(
									JSON.parse(outcome.receipt.resultJson),
									command,
								);
							},

							close: () =>
								(close ??= Promise.resolve().then(async () => {
									const failures: unknown[] = [];
									try {
										await transport.close();
									} catch (error) {
										failures.push(error);
									} finally {
										release();
									}
									try {
										const result = await task;
										if (result.kind === 'receipt' && result.receipt.state !== 'completed') {
											throw operationReceiptFailure(result.receipt, 'version_conflict');
										}
										if (result.kind !== 'receipt') {
											throw new AgentFailure('operation_unknown');
										}
									} catch (error) {
										failures.push(error);
									}
									if (failures.length) {
										throw aggregateAgentFailures(failures, 'Protocol session settlement failed');
									}
									session.closed = true;
									this.tools.touch(input.scope);
								})),
						};
						created = session;
						sessions.set(id, session);

						const closeSession = () => {
							void session
								.close()
								.catch((error: unknown) =>
									input.execution.onBackgroundFailure(error, 'transport.session'),
								);
						};

						let checking: Promise<void> | null = null;
						let authorityFailure: unknown = null;
						let dirty = false;

						const revalidate = () => {
							dirty = true;
							checking ??= Promise.resolve().then(async () => {
								try {
									while (dirty && !close) {
										dirty = false;
										await validate();
									}
								} catch (error) {
									if (
										!(lifetime.aborted && error === lifetime.reason) &&
										(!(error instanceof AgentFailure) ||
											![
												'forbidden',
												'version_conflict',
												'provider_unavailable',
												'not_found',
											].includes(error.code))
									) {
										authorityFailure = error;
										input.execution.onBackgroundFailure(error, 'transport.session');
									}
									closeSession();
								} finally {
									checking = null;
								}
							});
						};

						const unwatch = this.changes.subscribe(
							input.scope,
							(kind) => {
								if (kind === 'state') {
									revalidate();
								}
							},
							closeSession,
							(scope) => scope.runId === undefined || scope.runId === input.scope.runId,
						);
						lifetime.addEventListener('abort', closeSession, { once: true });
						publish(session);
						if (lifetime.aborted) {
							closeSession();
						}
						let closeFailure: unknown = null;
						try {
							await finished;
							await transport.close();
						} catch (error) {
							closeFailure = error;
						} finally {
							unwatch();
							lifetime.removeEventListener('abort', closeSession);
							await checking;
						}
						// A closed channel cannot erase a failed in-flight authority check.
						// Wait for that owner before publishing any successful session receipt.
						const failures = [closeFailure, authorityFailure].filter((error) => error !== null);
						if (failures.length) {
							const cause = aggregateAgentFailures(
								failures,
								'Protocol session authority or cleanup failed',
							);
							throw new OperationEffectFailure(
								'operation_unknown',
								'unknown',
								isAgentDrainFailure(cause) ? 'unknown' : 'closed',
								{ cause },
							);
						}
						return 'null';
					},
				};
			},
		});
		const unsubscribeRetirement = this.plugins.subscribeRuntimeRetirement(async (scope) => {
			if (
				scope.userId !== input.scope.userId ||
				scope.appId !== input.scope.appId ||
				scope.instanceId !== source.instanceId ||
				scope.generation !== source.generation
			) {
				return;
			}
			retirement.abort();
			const result = await task;
			if (created) {
				await created.close();
			} else if (result.kind === 'receipt' && result.receipt.state === 'unknown') {
				throw new AgentFailure('operation_unknown');
			}
		});
		void task.then(
			(result) => {
				unsubscribeRetirement();
				if (!created) {
					refuse(
						new AgentFailure(
							result.kind === 'receipt'
								? (result.receipt.failureCode ?? 'version_conflict')
								: 'internal_failure',
						),
					);
				}
			},
			(error: unknown) => {
				unsubscribeRetirement();
				refuse(error);
				if (created) {
					input.execution.onBackgroundFailure(error, 'transport.session');
				}
			},
		);
		return ready;
	}

	private binding(name: string, capability: AgentCapability, summary: string, target: ToolTarget | null): string {
		return JSON.stringify({
			kind: 'native',
			name,
			version: '1',
			summary,
			risk: 'destructive',
			mutation: true,
			capability,
			requiredCapabilities: [],
			target:
				target === null ? null : { id: target.id, version: target.version, fingerprint: target.fingerprint },
		});
	}

	private async permission(
		input: Input,
		source: PluginCapabilitySource,
		parent: OperationReceipt,
		capability: AgentCapability,
		target: ToolTarget | null,
		permission: PluginServicePermissionInput,
		signal: AbortSignal,
	): Promise<PluginServicePermissionResponse> {
		let deliver: (proof: { sha256: string; sizeBytes: number }) => void = () => {};

		let abandon: (error: unknown) => void = () => {};

		const delivered = new Promise<{ sha256: string; sizeBytes: number }>((resolve, reject) => {
			deliver = resolve;
			abandon = reject;
		});
		// Approval can still be denied before execute observes this delivery promise.
		void delivered.catch(() => undefined);

		let publish: (response: PluginServicePermissionResponse) => void = () => {};

		let refuse: (error: unknown) => void = () => {};

		let granted = false;
		const ready = new Promise<PluginServicePermissionResponse>((resolve, reject) => {
			publish = resolve;
			refuse = reject;
		});
		const args = JSON.stringify(permission);
		const task = input.operation({
			intent: {
				scope: input.scope,
				callerId: pluginCallOwner(input.scope.runId, source.instanceId, source.operationId),
				parentId: parent.id,
				operationKey: 'permission:' + hash(args),
				requestHash: hash(args),
			},
			signal,

			prepare: () => ({
				record: true,
				kind: 'effect',
				label: 'transport.permission',
				argumentsJson: args,
				bindingJson: this.binding(
					'transport.permission',
					capability,
					permission.title || permission.toolCallId,
					target,
				),
				mayHaveExternalEffect: true,

				validate: async () => {
					await input.assertCurrent();
				},

				authorize: async (operation) => {
					if (!operation) {
						throw new AgentFailure('internal_failure');
					}
					const authority = await input.authorize(source);
					authority.target = target === null ? null : { id: target.id, version: target.version };
					authority.approval = await this.approvals.permit(
						{
							operation,
							policyRevision: authority.policyRevision,
							capability,
							risk: 'destructive',
							summary: permission.title || permission.toolCallId,
							targetId: target?.id ?? null,
						},
						signal,
					);
					return authority;
				},

				execute: async () => {
					granted = true;
					publish({
						decision: 'allow_once',

						delivered: async (proof) => {
							deliver(proof);
							await task;
						},

						abandon: async (error, dispatched) => {
							abandon(
								new OperationEffectFailure(
									dispatched ? 'operation_unknown' : 'forbidden',
									dispatched ? 'unknown' : 'not_started',
									'closed',
									{ cause: error },
								),
							);
							await task;
						},
					});
					return JSON.stringify(await delivered);
				},
			}),
		});
		void task.then(
			(result) => {
				if (granted) {
					return;
				}
				if (
					result.kind === 'receipt' &&
					result.receipt.state === 'failed' &&
					result.receipt.failureCode === 'forbidden'
				) {
					publish({
						decision: 'reject_once',

						delivered: async () => {},

						abandon: async () => {},
					});
				} else {
					refuse(
						new AgentFailure(
							result.kind === 'receipt'
								? (result.receipt.failureCode ?? 'version_conflict')
								: 'internal_failure',
						),
					);
				}
			},
			(error: unknown) => {
				refuse(error);
				if (granted) {
					input.execution.onBackgroundFailure(error, 'transport.permission');
				}
			},
		);
		return ready;
	}
}
