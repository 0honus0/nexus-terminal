import type {
	AgentPluginBackendContext,
	AgentPluginBackendReply,
} from '@nexus-terminal/shared/agent/plugins/backend-sdk';
import { readAgentPluginRpcInput } from '@nexus-terminal/shared/agent/plugins/rpc-codec';
import type { AgentPluginIntentReceipt } from '@nexus-terminal/shared/agent/plugins/intent-model';
import type { StoredPluginIntent } from '../../storage/plugin-intent-storage.js';
import { encodeAgentJson } from '@nexus-terminal/shared/agent/http-codec';
import { AGENT_PLUGIN_MAX_MESSAGE_BYTES } from '@nexus-terminal/shared/agent/plugins/values';
import { InvalidAgentPayload } from '@nexus-terminal/shared/agent/http-codec';
import type { PluginBackendRuntime, PluginBackendInstance, PluginRuntimeReply } from '../../storage/plugin-runtime.js';
import type { ModuleRuntime } from '../../../../../platform/isolation/module-runtime.js';

function intent(value: StoredPluginIntent): AgentPluginIntentReceipt {
	return {
		id: value.id,
		senderAppId: value.senderAppId,
		receiverAppId: value.receiverAppId,
		senderVersion: value.senderVersion,
		receiverVersion: value.receiverVersion,
		senderRevision: value.senderRevision,
		receiverRevision: value.receiverRevision,
		intentId: value.intentId,
		schemaVersion: value.schemaVersion,
		inputJson: value.inputJson,
		artifactIds: value.artifactIds.map((id) => id),
		createdAt: value.createdAt,
		expiresAt: value.expiresAt,
		revokedAt: value.revokedAt,
	};
}

function reply(value: PluginRuntimeReply): AgentPluginBackendReply {
	const response = projectReply(value);
	try {
		// Reserve framing space for the generic runtime's finite IPC envelope.
		encodeAgentJson(response, AGENT_PLUGIN_MAX_MESSAGE_BYTES - 1024);
		return response;
	} catch (error) {
		if (!(error instanceof InvalidAgentPayload)) {
			throw error;
		}
		const committed =
			value.ok &&
			(value.method === 'storage.put' ||
				value.method === 'storage.delete' ||
				value.method === 'intents.create' ||
				value.method === 'intents.revoke');
		return { ok: false, error: { code: committed ? 'operation_unknown' : 'limit_exceeded' } };
	}
}

function projectReply(value: PluginRuntimeReply): AgentPluginBackendReply {
	if (!value.ok) {
		return { ok: false, error: { code: value.code } };
	}
	if (value.method === 'intents.create') {
		return { ok: true, result: { method: value.method, value: intent(value.value) } };
	}
	if (value.method === 'intents.listReceived') {
		return { ok: true, result: { method: value.method, value: value.value.map(intent) } };
	}
	if (value.method === 'intents.revoke') {
		return { ok: true, result: { method: value.method, value: { revoked: true } } };
	}
	if (value.method === 'intents.artifacts.get') {
		const item = value.value;
		return {
			ok: true,
			result: {
				method: value.method,
				value: {
					id: item.id,
					appId: item.appId,
					name: item.name,
					mediaType: item.mediaType,
					kind: item.kind,
					sizeBytes: item.sizeBytes,
					sha256: item.sha256,
					status: item.status,
					retained: item.retained,
					version: item.version,
					createdAt: item.createdAt,
					readyAt: item.readyAt,
					expiresAt: item.expiresAt,
					deletedAt: item.deletedAt,
				},
			},
		};
	}
	if (value.method === 'intents.artifacts.readRange') {
		const item = value.value;
		return {
			ok: true,
			result: {
				method: value.method,
				value: {
					receiptId: item.receiptId,
					artifactId: item.artifactId,
					start: item.start,
					endInclusive: item.endInclusive,
					dataBase64: Buffer.from(item.bytes).toString('base64'),
				},
			},
		};
	}
	if (value.method === 'host.appInfo') {
		const item = value.value;
		return {
			ok: true,
			result: {
				method: value.method,
				value: {
					appId: item.appId,
					definitionId: item.definitionId,
					version: item.version,
					packageHash: item.packageHash,
					publisherKeyId: item.publisherKeyId,
					status: item.status,
					revision: item.revision,
					createdAt: item.createdAt,
					updatedAt: item.updatedAt,
				},
			},
		};
	}
	if (value.method === 'storage.get') {
		const item = value.value;
		return {
			ok: true,
			result: {
				method: value.method,
				value:
					item === null
						? null
						: {
								key: item.key,
								version: item.version,
								valueJson: item.valueJson,
								updatedAt: item.updatedAt,
							},
			},
		};
	}
	const item = value.value;
	return {
		ok: true,
		result: {
			method: value.method,
			value: { key: item.key, version: item.version, valueJson: item.valueJson, updatedAt: item.updatedAt },
		},
	};
}

export class NativePluginBackendRuntime implements PluginBackendRuntime {
	constructor(private readonly modules: ModuleRuntime) {}

	recover(): Promise<void> {
		return this.modules.recover();
	}

	async open(input: Parameters<PluginBackendRuntime['open']>[0]): Promise<PluginBackendInstance> {
		const context: AgentPluginBackendContext = {
			protocol: 1,
			sdkVersion: '1',
			appId: input.appId,
			definitionId: input.definitionId,
			version: input.version,
			revision: input.revision,
		};
		const instance = await this.modules.open({
			entry: input.entry,
			files: input.files.map((file) => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
			contextJson: JSON.stringify(context),

			host: async (raw) => {
				try {
					const value = readAgentPluginRpcInput(raw);
					if (value.method === 'host.appInfo') {
						return reply(await input.host({ method: value.method }));
					}
					if (value.method === 'intents.create') {
						const p = value.params;
						return reply(
							await input.host({
								method: value.method,
								input: {
									operationId: p.operationId,
									receiverAppId: p.receiverAppId,
									intentId: p.intentId,
									inputJson: p.inputJson,
									artifactIds: p.artifactIds.map((id) => id),
									confirmed: p.confirmed,
								},
							}),
						);
					}
					if (value.method === 'intents.listReceived') {
						return reply(await input.host({ method: value.method, limit: value.params.limit }));
					}
					if (value.method === 'intents.revoke') {
						return reply(await input.host({ method: value.method, receiptId: value.params.receiptId }));
					}
					if (value.method === 'intents.artifacts.get') {
						return reply(
							await input.host({
								method: value.method,
								receiptId: value.params.receiptId,
								artifactId: value.params.artifactId,
							}),
						);
					}
					if (value.method === 'intents.artifacts.readRange') {
						return reply(
							await input.host({
								method: value.method,
								receiptId: value.params.receiptId,
								artifactId: value.params.artifactId,
								start: value.params.start,
								endInclusive: value.params.endInclusive,
							}),
						);
					}
					if (value.method === 'storage.get') {
						return reply(await input.host({ method: value.method, key: value.params.key }));
					}
					if (value.method === 'storage.delete') {
						return reply(
							await input.host({
								method: value.method,
								key: value.params.key,
								expectedVersion: value.params.expectedVersion,
								operationId: value.params.operationId,
							}),
						);
					}
					if (value.method !== 'storage.put') {
						return { ok: false, error: { code: 'forbidden' } };
					}
					return reply(
						await input.host({
							method: value.method,
							key: value.params.key,
							expectedVersion: value.params.expectedVersion,
							operationId: value.params.operationId,
							valueJson: value.params.valueJson,
						}),
					);
				} catch (error) {
					if (error instanceof InvalidAgentPayload) {
						return { ok: false, error: { code: 'invalid_input' } };
					}
					throw error;
				}
			},
		});
		return {
			exited: instance.exited,

			activate: () => instance.activate(),

			health: () => instance.health(),

			quiesce: (deadline) => instance.quiesce(deadline),

			close: () => instance.close(),
		};
	}
}
