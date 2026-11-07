import { AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { randomUUID } from 'node:crypto';
import { agentRecord, readAgentId, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { pluginContractText } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import { readAgentPluginServiceTransportRequest } from '@nexus-terminal/shared/agent/plugins/service-transport-codec';
import { AgentFailure, aggregateAgentFailures, isAgentDrainFailure } from '../../agent-failure.js';
import type { GovernanceService } from '../../governance/service/governance-service.js';
import type { ExecutionService } from '../../execution/service/execution-service.js';
import type { PluginConnectionService } from '../../plugins/service/plugin-connection-service.js';
import type { PluginInstanceService } from '../../plugins/service/plugin-instance-service.js';
import type {
	PluginLifecycleFactory,
	PluginLifecycleInput,
	PluginLifecycleLease,
} from '../../plugins/model/plugin-lifecycle-types.js';
import { PluginServiceTransportOwner } from '../../plugins/service/plugin-service-transport.js';
import { toPluginInstanceSettings } from './plugin-configuration-mapper.js';

/** Instance preparation may read its own configuration and prepare fixed HTTP metadata I/O.
 * Its persisted runtime reservation owns the session; it never borrows a user Run or cookie.
 */
export class PluginLifecycleCapabilities implements PluginLifecycleFactory {
	constructor(
		private readonly instances: PluginInstanceService,
		private readonly connections: PluginConnectionService,
		private readonly governance: GovernanceService,
		private readonly settings: ExecutionService,
	) {}

	open(input: PluginLifecycleInput): PluginLifecycleLease {
		const sessions = new Map<string, PluginServiceTransportOwner>();
		const intents = new Map<string, Promise<{ id: string; transport: PluginServiceTransportOwner }>>();
		const stop = new AbortController();
		const signal = AbortSignal.any([input.signal, stop.signal]);
		let closing: Promise<void> | null = null;

		const validate = async () => {
			signal.throwIfAborted();
			await input.validate();
			const current = await this.instances.source(input.userId, input.appId, input.instanceId);
			if (!current.instance.enabled || current.configuration.revision !== input.configurationRevision) {
				throw new AgentFailure('version_conflict');
			}
			signal.throwIfAborted();
			return current;
		};

		const openSession = async () => {
			await validate();
			const connection = await this.connections.source(input.userId, input.appId, input.instanceId);
			const connector = connection.connection.connector;
			// Process execution is a Run effect. An instance initializer cannot launch an App task.
			if (connector.kind !== 'http' || !input.manifest.capabilities.includes('service.transport.http')) {
				throw new AgentFailure('forbidden');
			}

			const authorize = async () => {
				await validate();
				await this.governance.assertInstanceCapabilities(input.userId, input.appId, [
					'plugin.invoke',
					'service.transport.http',
				]);
				const settings = await this.settings.get(input.userId);
				if (!settings.enabled) {
					throw new AgentFailure('forbidden');
				}
				const latest = await this.connections.source(input.userId, input.appId, input.instanceId);
				if (latest.connection.revision !== connection.connection.revision) {
					throw new AgentFailure('version_conflict');
				}
				await validate();
			};

			await authorize();
			const transport = new PluginServiceTransportOwner({
				signal,
				validate: authorize,
				transport: {
					kind: 'http',
					options: {
						url: connector.endpoint,
						privateAuthorities: connector.privateAuthorities.map((value) => value),
						headers:
							connection.credential === null
								? []
								: [{ name: 'authorization', value: 'Bearer ' + connection.credential }],
						maxResponseBytes: Number.MAX_SAFE_INTEGER,
					},
				},
			});
			const id = randomUUID();
			sessions.set(id, transport);
			if (closing || signal.aborted) {
				await transport.close();
				throw new AgentFailure('forbidden');
			}
			return { id, transport };
		};

		return {
			call: async (request) => {
				try {
					const raw: unknown = JSON.parse(request.inputJson);
					if (request.method === 'transport.session.close') {
						const id = readAgentId(
							agentRecord(raw, ['sessionId'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES).sessionId,
						);
						const session = sessions.get(id);
						if (!session) {
							throw new AgentFailure('forbidden');
						}
						await session.close();
						return { ok: true, valueJson: 'null' };
					}
					const source = await validate();
					if (request.method === 'configuration.read') {
						const id = readAgentId(
							agentRecord(raw, ['instanceId'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES).instanceId,
						);
						if (id !== input.instanceId) {
							throw new AgentFailure('forbidden');
						}
						return { ok: true, valueJson: JSON.stringify(toPluginInstanceSettings(source)) };
					}
					if (request.method === 'transport.session.open') {
						const key = pluginContractText(
							agentRecord(raw, ['operationKey'], AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES).operationKey,
						);
						let original = intents.get(key);
						if (!original) {
							original = openSession();
							intents.set(key, original);
						}
						const session = await original;
						return {
							ok: true,
							valueJson: JSON.stringify({ sessionId: session.id, transport: session.transport.facts }),
						};
					}
					if (request.method !== 'transport.session.call') {
						throw new AgentFailure('forbidden');
					}
					const row = agentRecord(
						raw,
						['sessionId', 'operationKey', 'request'],
						AGENT_PLUGIN_APP_PAYLOAD_MAX_BYTES,
					);
					pluginContractText(row.operationKey);
					const transport = sessions.get(readAgentId(row.sessionId));
					if (!transport) {
						throw new AgentFailure('forbidden');
					}
					const result = await transport.dispatch(readAgentPluginServiceTransportRequest(row.request));
					await validate();
					return { ok: true, valueJson: JSON.stringify(result) };
				} catch (error) {
					if (error instanceof InvalidAgentPayload || error instanceof SyntaxError) {
						return { ok: false, code: 'invalid_input' };
					}
					if (error instanceof AgentFailure && !isAgentDrainFailure(error)) {
						return { ok: false, code: error.code };
					}
					throw error;
				}
			},

			close: () => {
				closing ??= Promise.resolve().then(async () => {
					await Promise.allSettled([...intents.values()]);
					const outcomes = await Promise.allSettled(
						[...sessions.values()].map((session) => Promise.resolve().then(() => session.close())),
					);
					const failures = outcomes.flatMap((result) =>
						result.status === 'rejected' ? [result.reason] : [],
					);
					if (failures.length) {
						throw aggregateAgentFailures(failures, 'Plugin preparation I/O did not close');
					}
				});
				stop.abort();
				return closing;
			},
		};
	}
}
