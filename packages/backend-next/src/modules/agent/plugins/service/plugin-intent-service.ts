import type { PluginRpcInput } from '../model/plugin-types.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_PLUGIN_INTENT_MAX_RANGE_BYTES,
	AGENT_PLUGIN_INTENT_MAX_ARTIFACTS,
	AGENT_PLUGIN_INTENT_MAX_INPUT_BYTES,
	AGENT_PLUGIN_INTENT_MAX_PAGE,
} from '@nexus-terminal/shared/agent/plugins/intent-values';
import type { ArtifactService } from '../../artifacts/service/artifact-service.js';
import type { ArtifactRecord, ArtifactReadRange } from '../../artifacts/model/artifact-types.js';
import { AgentFailure } from '../../agent-failure.js';
import type { PluginIntentModel } from '../model/plugin-intent-model.js';
import type {
	PluginIntentRpcInput,
	PluginIntentRpcResult,
	PluginIntentActor,
	PluginIntentApp,
	PluginIntentCreate,
	PluginIntentReceipt,
} from '../model/plugin-intent-types.js';

function id(value: string): void {
	if (!AGENT_ID_PATTERN.test(value)) {
		throw new AgentFailure('invalid_input');
	}
}

function actor(value: PluginIntentActor): void {
	id(value.appId);
	if (!Number.isSafeInteger(value.userId) || value.userId < 1 || ('token' in value && !value.token)) {
		throw new AgentFailure('invalid_input');
	}
}

function permitted(value: PluginIntentApp | null, artifacts: boolean): boolean {
	const required = artifacts
		? (['app.intents.exchange', 'artifacts.read'] as const)
		: (['app.intents.exchange'] as const);
	return (
		value !== null &&
		value.enabled &&
		value.declared &&
		required.every((capability) => value.capabilities.includes(capability) && value.grants.includes(capability))
	);
}

function visible(
	value: PluginIntentReceipt,
	sender: PluginIntentApp | null,
	receiver: PluginIntentApp | null,
	now: number,
): boolean {
	return (
		value.revokedAt === null &&
		value.expiresAt > now &&
		permitted(sender, value.artifactIds.length > 0) &&
		permitted(receiver, value.artifactIds.length > 0) &&
		sender?.version === value.senderVersion &&
		receiver?.version === value.receiverVersion &&
		sender?.revision === value.senderRevision &&
		receiver?.revision === value.receiverRevision &&
		receiver.intents.some((item) => item.id === value.intentId && item.schemaVersion === value.schemaVersion)
	);
}

function ready(value: ArtifactRecord, now: number): void {
	if (
		value.status !== 'ready' ||
		value.sha256 === null ||
		(!value.retained && value.expiresAt !== null && value.expiresAt <= now)
	) {
		throw new AgentFailure('not_found');
	}
}

export function isPluginIntentRpc(input: PluginRpcInput): input is PluginIntentRpcInput {
	return (
		input.method === 'intents.create' ||
		input.method === 'intents.listReceived' ||
		input.method === 'intents.revoke' ||
		input.method === 'intents.artifacts.get' ||
		input.method === 'intents.artifacts.readRange'
	);
}

export class PluginIntentService {
	constructor(
		private readonly model: PluginIntentModel,
		private readonly artifacts: ArtifactService,
	) {}

	async rpc(
		current: PluginIntentActor,
		input: PluginIntentRpcInput,
		signal: AbortSignal,
	): Promise<PluginIntentRpcResult> {
		switch (input.method) {
			case 'intents.create':
				return { method: input.method, value: await this.create(current, input.input, signal) };
			case 'intents.listReceived':
				return { method: input.method, value: await this.list(current, input.limit) };
			case 'intents.revoke':
				await this.revoke(current, input.receiptId, signal);
				return { method: input.method, value: { revoked: true } };
			case 'intents.artifacts.get':
				return { method: input.method, value: await this.artifact(current, input.receiptId, input.artifactId) };
			case 'intents.artifacts.readRange':
				return {
					method: input.method,
					value: {
						receiptId: input.receiptId,
						artifactId: input.artifactId,
						start: input.start,
						endInclusive: input.endInclusive,
						bytes: await this.readRange(
							current,
							input.receiptId,
							input.artifactId,
							{ start: input.start, endInclusive: input.endInclusive },
							signal,
						),
					},
				};
		}
	}

	private identity(actor: PluginIntentActor, current: number | null): void {
		if (actor.authorization.kind === 'runtime') {
			actor.authorization.validate();
			if (actor.userId !== 1) {
				throw new AgentFailure('forbidden');
			}
			return;
		}
		if (current !== actor.userId) {
			throw new AgentFailure('unauthenticated');
		}
	}

	private authorize(current: PluginIntentActor, app: PluginIntentApp | null, now: number): void {
		if (
			(current.authorization.kind === 'frontend' && current.authorization.expiresAt <= now) ||
			((current.authorization.kind === 'frontend' || current.authorization.kind === 'runtime') &&
				app?.pluginRevision !== current.authorization.revision)
		) {
			throw new AgentFailure('version_conflict');
		}
	}

	create(current: PluginIntentActor, input: PluginIntentCreate, signal: AbortSignal): Promise<PluginIntentReceipt> {
		actor(current);
		id(input.operationId);
		id(input.receiverAppId);
		if (
			!input.confirmed ||
			current.appId === input.receiverAppId ||
			!input.intentId.trim() ||
			Buffer.byteLength(input.intentId, 'utf8') > 128 ||
			!input.inputJson.length ||
			Buffer.byteLength(input.inputJson, 'utf8') > AGENT_PLUGIN_INTENT_MAX_INPUT_BYTES ||
			input.artifactIds.length > AGENT_PLUGIN_INTENT_MAX_ARTIFACTS ||
			new Set(input.artifactIds).size !== input.artifactIds.length
		) {
			throw new AgentFailure('invalid_input');
		}
		input.artifactIds.forEach(id);
		return this.model.create(
			current,
			input,
			(facts, replay) => {
				if (signal.aborted) {
					throw new AgentFailure('provider_unavailable');
				}
				this.identity(current, facts.identityUserId);
				this.authorize(current, facts.sender, facts.now);
				if (
					!permitted(facts.sender, input.artifactIds.length > 0) ||
					!permitted(facts.receiver, input.artifactIds.length > 0)
				) {
					throw new AgentFailure('forbidden');
				}
				if (replay !== null && !visible(replay, facts.sender, facts.receiver, facts.now)) {
					throw new AgentFailure('not_found');
				}
			},
			(facts) => {
				const sender = facts.sender,
					receiver = facts.receiver;
				const intent = receiver?.intents.find((item) => item.id === input.intentId);
				if (!sender || !receiver || !intent) {
					throw new AgentFailure('invalid_input');
				}
				if (
					facts.count >= 100 ||
					facts.evidenceCount >= 4096 ||
					facts.evidenceBytes + Buffer.byteLength(input.inputJson, 'utf8') > 64 * 1024 * 1024
				) {
					throw new AgentFailure('limit_exceeded');
				}
				facts.artifacts.forEach((item) => ready(item, facts.now));
				return {
					id: input.operationId,
					senderAppId: current.appId,
					receiverAppId: input.receiverAppId,
					senderVersion: sender.version,
					receiverVersion: receiver.version,
					senderRevision: sender.revision,
					receiverRevision: receiver.revision,
					intentId: input.intentId,
					schemaVersion: intent.schemaVersion,
					inputJson: input.inputJson,
					artifactIds: input.artifactIds.map((item) => item),
					createdAt: facts.now,
					expiresAt: facts.now + 600000,
					revokedAt: null,
				};
			},
		);
	}

	list(current: PluginIntentActor, limit: number): Promise<PluginIntentReceipt[]> {
		actor(current);
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > AGENT_PLUGIN_INTENT_MAX_PAGE) {
			throw new AgentFailure('invalid_input');
		}
		return this.model.list(
			current,
			limit,
			(identity, app) => {
				this.identity(current, identity);
				this.authorize(current, app, Date.now());
				if (!permitted(app, false)) {
					throw new AgentFailure('forbidden');
				}
			},
			visible,
		);
	}

	revoke(current: PluginIntentActor, receiptId: string, signal: AbortSignal): Promise<void> {
		actor(current);
		id(receiptId);
		// Revocation remains possible after a grant or App has been disabled.
		return this.model.revoke(current, receiptId, (identity, app) => {
			if (signal.aborted) {
				throw new AgentFailure('provider_unavailable');
			}
			this.identity(current, identity);
			this.authorize(current, app, Date.now());
		});
	}

	artifact(current: PluginIntentActor, receiptId: string, artifactId: string): Promise<ArtifactRecord> {
		actor(current);
		id(receiptId);
		id(artifactId);
		return this.model
			.artifact(current, receiptId, artifactId, (identity, receipt, sender, receiver, now) => {
				this.identity(current, identity);
				this.authorize(current, receiver, now);
				if (!visible(receipt, sender, receiver, now)) {
					throw new AgentFailure('not_found');
				}
			})
			.then((value) => {
				ready(value, Date.now());
				return value;
			});
	}

	async readRange(
		current: PluginIntentActor,
		receiptId: string,
		artifactId: string,
		range: ArtifactReadRange,
		signal: AbortSignal,
	): Promise<Uint8Array> {
		if (
			!Number.isSafeInteger(range.start) ||
			range.start < 0 ||
			!Number.isSafeInteger(range.endInclusive) ||
			range.endInclusive < range.start ||
			range.endInclusive >= Number.MAX_SAFE_INTEGER
		) {
			throw new AgentFailure('invalid_input');
		}
		const size = range.endInclusive - range.start + 1;
		if (size > AGENT_PLUGIN_INTENT_MAX_RANGE_BYTES) {
			throw new AgentFailure('limit_exceeded');
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for await (const chunk of this.read(current, receiptId, artifactId, range, signal)) {
			if (chunk.byteLength > size - offset) {
				throw new AgentFailure('storage_unavailable');
			}
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		if (offset !== size) {
			throw new AgentFailure('storage_unavailable');
		}
		// No partial content is published after the grant changes while the final read settles.
		await this.artifact(current, receiptId, artifactId);
		if (signal.aborted) {
			throw new AgentFailure('provider_unavailable');
		}
		return bytes;
	}

	read(
		current: PluginIntentActor,
		receiptId: string,
		artifactId: string,
		range: ArtifactReadRange,
		signal: AbortSignal,
	): AsyncIterable<Uint8Array> {
		return this.artifacts.readGranted(artifactId, range, signal, () =>
			this.artifact(current, receiptId, artifactId),
		);
	}
}
