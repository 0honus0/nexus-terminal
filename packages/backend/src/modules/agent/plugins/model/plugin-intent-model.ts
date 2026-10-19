import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { agentStorage } from '../../agent-storage-failure.js';
import { AgentFailure } from '../../agent-failure.js';
import { artifactFromStorage } from '../../artifacts/model/artifact-model.js';
import type { ArtifactRecord } from '../../artifacts/model/artifact-types.js';
import type {
	PluginIntentIdentity,
	PluginIntentStorage,
	StoredPluginIntentApp,
	StoredPluginIntent,
	StoredPluginIntentFacts,
} from '../storage/plugin-intent-storage.js';
import { PluginIntentStorageRefusal } from '../storage/plugin-intent-storage.js';
import type {
	PluginIntentActor,
	PluginIntentCreate,
	PluginIntentApp,
	PluginIntentReceipt,
	PluginIntentFacts,
} from './plugin-intent-types.js';

function app(value: StoredPluginIntentApp | null): PluginIntentApp | null {
	return value === null
		? null
		: {
				id: value.id,
				version: value.version,
				revision: value.revision,
				pluginRevision: value.pluginRevision,
				enabled: value.enabled,
				declared: value.declared,
				capabilities: value.capabilities.map((item) => item),
				grants: value.grants.map((item) => item),
				intents: value.intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
			};
}

function receipt(value: StoredPluginIntent): PluginIntentReceipt {
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
		artifactIds: value.artifactIds.map((item) => item),
		createdAt: value.createdAt,
		expiresAt: value.expiresAt,
		revokedAt: value.revokedAt,
	};
}

export function intentToStorage(value: PluginIntentReceipt): StoredPluginIntent {
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
		artifactIds: value.artifactIds.map((item) => item),
		createdAt: value.createdAt,
		expiresAt: value.expiresAt,
		revokedAt: value.revokedAt,
	};
}

function facts(value: StoredPluginIntentFacts): PluginIntentFacts {
	return {
		identityUserId: value.identityUserId,
		sender: app(value.sender),
		receiver: app(value.receiver),
		artifacts: value.artifacts.map(artifactFromStorage),
		count: value.count,
		evidenceCount: value.evidenceCount,
		evidenceBytes: value.evidenceBytes,
		now: value.now,
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	return agentStorage(async () => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof PluginIntentStorageRefusal) {
				throw new AgentFailure(error.code, { cause: error });
			}
			throw error;
		}
	});
}

export class PluginIntentModel {
	constructor(
		private readonly store: PluginIntentStorage,
		private readonly tokens: SessionTokens,
	) {}

	private identity(actor: PluginIntentActor): PluginIntentIdentity {
		if ('token' in actor) {
			return { kind: 'session', digest: this.tokens.digest(actor.token) };
		}
		return { kind: 'runtime' };
	}

	async create(
		actor: PluginIntentActor,
		input: PluginIntentCreate,
		admit: (facts: PluginIntentFacts, replay: PluginIntentReceipt | null) => void,
		decide: (facts: PluginIntentFacts) => PluginIntentReceipt,
	): Promise<PluginIntentReceipt> {
		return receipt(
			await storage(() =>
				this.store.create(
					actor.userId,
					this.identity(actor),
					actor.appId,
					{
						id: input.operationId,
						receiverAppId: input.receiverAppId,
						intentId: input.intentId,
						inputJson: input.inputJson,
						artifactIds: input.artifactIds.map((item) => item),
					},
					(value, replay) => admit(facts(value), replay === null ? null : receipt(replay)),
					(value) => intentToStorage(decide(facts(value))),
				),
			),
		);
	}

	async list(
		actor: PluginIntentActor,
		limit: number,
		admit: (identity: number | null, app: PluginIntentApp | null) => void,
		visible: (
			receipt: PluginIntentReceipt,
			sender: PluginIntentApp | null,
			receiver: PluginIntentApp | null,
			now: number,
		) => boolean,
	): Promise<PluginIntentReceipt[]> {
		return (
			await storage(() =>
				this.store.list(
					actor.userId,
					this.identity(actor),
					actor.appId,
					limit,
					(identity, value) => admit(identity, app(value)),
					(value, sender, receiver, now) => visible(receipt(value), app(sender), app(receiver), now),
				),
			)
		).map(receipt);
	}

	revoke(
		actor: PluginIntentActor,
		id: string,
		admit: (identity: number | null, app: PluginIntentApp | null) => void,
	): Promise<void> {
		return storage(() =>
			this.store.revoke(actor.userId, this.identity(actor), actor.appId, id, (identity, value) =>
				admit(identity, app(value)),
			),
		);
	}

	async artifact(
		actor: PluginIntentActor,
		id: string,
		artifactId: string,
		admit: (
			identity: number | null,
			receipt: PluginIntentReceipt,
			sender: PluginIntentApp | null,
			receiver: PluginIntentApp | null,
			now: number,
		) => void,
	): Promise<ArtifactRecord> {
		return artifactFromStorage(
			await storage(() =>
				this.store.getArtifact(
					actor.userId,
					this.identity(actor),
					actor.appId,
					id,
					artifactId,
					(identity, value, sender, receiver, now) =>
						admit(identity, receipt(value), app(sender), app(receiver), now),
				),
			),
		);
	}
}
