import { readAgentPluginRegistrations } from '@nexus-terminal/shared/agent/plugins/registry-codec';
import {
	readAgentPluginDispatchInput,
	readAgentPluginDispatchReply,
	readAgentPluginCapabilityRequest,
	readAgentPluginCapabilityReply,
} from '@nexus-terminal/shared/agent/plugins/runtime-codec';
import type { AgentPluginRuntimeContext } from '@nexus-terminal/shared/agent/plugins/runtime';
import { AGENT_PLUGIN_RESOURCE_RELEASE_KEY } from '@nexus-terminal/shared/agent/plugins/runtime';
import { agentRecord, InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { PluginCallableRefusal } from '../../storage/plugin-runtime.js';
import type { PluginBackendRuntime, PluginBackendInstance } from '../../storage/plugin-runtime.js';
import type { ModuleRuntime } from '../../../../../platform/isolation/module-runtime.js';
import { ModuleRuntimeFailure } from '../../../../../platform/isolation/module-runtime.js';

/** Only the invocation-local bridge carries authority. Activation cannot borrow a global Host callback. */
export class NativePluginBackendRuntime implements PluginBackendRuntime {
	constructor(private readonly modules: ModuleRuntime) {}

	recover(): Promise<void> {
		return this.modules.recover();
	}

	async open(input: Parameters<PluginBackendRuntime['open']>[0]): Promise<PluginBackendInstance> {
		const context: AgentPluginRuntimeContext = {
			protocol: 4,
			sdkVersion: '4',
			instanceId: input.instanceId,
			generation: input.generation,
			appId: input.appId,
			package: {
				packageId: input.definitionId,
				version: input.version,
				packageHash: input.packageHash,
				publisherKeyId: input.publisherKeyId,
			},
			configurationRevision: input.configurationRevision,
		};
		const instance = await this.modules.open({
			entry: input.entry,
			files: input.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
			contextJson: JSON.stringify(context),

			host: async () => ({ ok: false, code: 'forbidden' }),
		});
		return {
			exited: instance.exited,

			activate: async () => readAgentPluginRegistrations(await instance.activate()),

			releaseResources: async (runId, deadlineUnixMs) => {
				const result = await instance.invoke(
					JSON.stringify({
						key: AGENT_PLUGIN_RESOURCE_RELEASE_KEY,
						argumentsJson: JSON.stringify({ runId }),
						scope: { kind: 'lifecycle', deadlineUnixMs },
					}),
					new AbortController().signal,
					Math.max(1, deadlineUnixMs - Date.now()),
					{
						exportName: 'dispatch',
						methods: [],

						read: async () => {
							throw new InvalidAgentPayload();
						},
					},
				);
				const reply = readAgentPluginDispatchReply(result);
				if ('errorCode' in reply) {
					throw new PluginCallableRefusal(reply.errorCode);
				}
				if (reply.resultJson !== 'null') {
					throw new InvalidAgentPayload();
				}
			},

			invokeCallable: async (input, signal, timeoutMs, call) => {
				const request = readAgentPluginDispatchInput(input);
				const pending = new Set<Promise<unknown>>();
				const failures = new Set<unknown>();
				let accepting = true;
				let result: unknown;
				let invocationFailed = false;
				let invocationFailure: unknown;
				try {
					result = await instance.invoke(JSON.stringify(request), signal, timeoutMs, {
						exportName: 'dispatch',
						methods: ['call'],

						read: (raw) => {
							if (!accepting) {
								return Promise.reject(new InvalidAgentPayload());
							}
							const task = Promise.resolve().then(async () => {
								const envelope = agentRecord(
									raw,
									['method', 'input'],
									AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024,
								);
								if (envelope.method !== 'call') {
									throw new InvalidAgentPayload();
								}
								const value = readAgentPluginCapabilityRequest(envelope.input);
								return readAgentPluginCapabilityReply(
									await call({ method: value.method, inputJson: value.inputJson }),
								);
							});
							pending.add(task);
							void task.then(
								() => pending.delete(task),
								(error: unknown) => {
									accepting = false;
									pending.delete(task);
									failures.add(error);
								},
							);
							return task;
						},
					});
				} catch (error) {
					invocationFailed = true;
					invocationFailure = error;
				} finally {
					// A handler may return or catch a refusal while accepted Host work is
					// still pending. Its original invocation owns all of that work.
					accepting = false;
					await Promise.allSettled([...pending]);
				}
				if (failures.size > 0) {
					if (invocationFailed) {
						failures.add(invocationFailure);
					}
					throw new ModuleRuntimeFailure('protocol_invalid', {
						cause: new AggregateError([...failures], 'Callable and accepted capabilities failed'),
					});
				}
				if (invocationFailed) {
					throw invocationFailure;
				}
				const reply = readAgentPluginDispatchReply(result);
				if ('errorCode' in reply) {
					throw new PluginCallableRefusal(reply.errorCode);
				}
				return reply.resultJson;
			},

			health: () => instance.health(),

			quiesce: (deadline) => instance.quiesce(deadline),

			close: () => instance.close(),
		};
	}
}
