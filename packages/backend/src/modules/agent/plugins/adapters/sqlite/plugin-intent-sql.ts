import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { StoredArtifact } from '../../../artifacts/storage/artifact-storage.js';
import { ArtifactStorageRefusal } from '../../../artifacts/storage/artifact-storage.js';
import { readApp } from '../../../scope/adapters/sqlite/app-row.js';
import { currentPolicy } from '../../../governance/adapters/sqlite/governance-sql.js';
import { pluginManifest } from '../package/plugin-manifest.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import {
	AGENT_PLUGIN_INTENT_MAX_INPUT_BYTES,
	AGENT_PLUGIN_INTENT_MAX_ARTIFACTS,
} from '@nexus-terminal/shared/agent/plugins/intent-values';
import type {
	PluginIntentIdentity,
	PluginIntentStorage,
	StoredPluginIntent,
	StoredPluginIntentApp,
	StoredPluginIntentCommand,
	StoredPluginIntentFacts,
} from '../../storage/plugin-intent-storage.js';
import { PluginIntentStorageRefusal } from '../../storage/plugin-intent-storage.js';

export async function initializePluginIntents(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_plugin_intents (
	 id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,sender_app_id TEXT NOT NULL,receiver_app_id TEXT NOT NULL,
	 sender_version TEXT NOT NULL,receiver_version TEXT NOT NULL,sender_revision TEXT NOT NULL,receiver_revision TEXT NOT NULL,intent_id TEXT NOT NULL,schema_version INTEGER NOT NULL CHECK(schema_version>=1),
	 input_json TEXT NOT NULL,artifact_ids_json TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,
	 FOREIGN KEY(sender_app_id,user_id) REFERENCES agent_apps(id,user_id),
	 FOREIGN KEY(receiver_app_id,user_id) REFERENCES agent_apps(id,user_id));
	 CREATE INDEX agent_plugin_intent_inbox ON agent_plugin_intents(user_id,receiver_app_id,expires_at,created_at,id);`);
}

function integer(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt intent integer');
	}
	return value;
}

function text(value: unknown, bytes: number): string {
	if (
		typeof value !== 'string' ||
		!value.length ||
		Buffer.byteLength(value, 'utf8') > bytes ||
		Buffer.from(value, 'utf8').toString('utf8') !== value
	) {
		throw new Error('Corrupt intent text');
	}
	return value;
}

function id(value: unknown): string {
	const valueId = text(value, 128);
	if (!AGENT_ID_PATTERN.test(valueId)) {
		throw new Error('Corrupt intent identity');
	}
	return valueId;
}

export function readPluginIntentReceipt(row: Record<string, unknown>): StoredPluginIntent {
	const inputJson = text(row.input_json, AGENT_PLUGIN_INTENT_MAX_INPUT_BYTES);
	JSON.parse(inputJson);
	const ids: unknown = JSON.parse(text(row.artifact_ids_json, 2048));
	if (!Array.isArray(ids) || ids.length > AGENT_PLUGIN_INTENT_MAX_ARTIFACTS) {
		throw new Error('Corrupt intent artifacts');
	}
	const artifactIds = ids.map(id);
	if (new Set(artifactIds).size !== artifactIds.length) {
		throw new Error('Duplicate intent artifacts');
	}
	const createdAt = integer(row.created_at);
	return {
		id: id(row.id),
		senderAppId: id(row.sender_app_id),
		receiverAppId: id(row.receiver_app_id),
		senderVersion: text(row.sender_version, 128),
		receiverVersion: text(row.receiver_version, 128),
		senderRevision: text(row.sender_revision, 128),
		receiverRevision: text(row.receiver_revision, 128),
		intentId: text(row.intent_id, 128),
		schemaVersion: integer(row.schema_version, 1),
		inputJson,
		artifactIds,
		createdAt,
		expiresAt: integer(row.expires_at, createdAt + 1),
		revokedAt: row.revoked_at === null ? null : integer(row.revoked_at, createdAt),
	};
}

async function app(tx: SqlExecutor, userId: number, appId: string): Promise<StoredPluginIntentApp | null> {
	const row = await tx.one('SELECT * FROM agent_apps WHERE user_id=? AND id=?', [userId, appId]);
	if (!row) {
		return null;
	}
	const value = await readApp(tx, row);
	const policy = await currentPolicy(tx, userId, appId);
	if (!policy) {
		throw new Error('Missing intent policy');
	}
	const plugin = await tx.one('SELECT manifest_json FROM agent_plugin_versions WHERE definition_id=? AND version=?', [
		value.definitionId,
		value.definitionVersion,
	]);
	const installation = await tx.one('SELECT revision FROM agent_plugin_installations WHERE user_id=? AND app_id=?', [
		userId,
		appId,
	]);
	const intents = plugin === null ? [] : pluginManifest(JSON.parse(text(plugin.manifest_json, 256 * 1024))).intents;
	return {
		id: value.id,
		version: value.definitionVersion,
		revision: value.version + ':' + policy.revision,
		pluginRevision: installation === null ? null : integer(installation.revision, 1),
		enabled: value.enabled,
		declared: value.definitionInstalled,
		capabilities: value.capabilities.map((item) => item),
		grants: policy.grants.map((item) => item.capability),
		intents: intents.map((item) => ({ id: item.id, schemaVersion: item.schemaVersion })),
	};
}

interface ArtifactGrantTasks {
	source(tx: SqlExecutor, userId: number, appId: string, artifactId: string): Promise<StoredArtifact>;
	publish(
		tx: SqlExecutor,
		userId: number,
		receiptId: string,
		appId: string,
		artifacts: StoredArtifact[],
		expiresAt: number,
	): Promise<void>;
	revoke(tx: SqlExecutor, userId: number, receiptId: string, now: number): Promise<void>;
	read(
		tx: SqlExecutor,
		userId: number,
		appId: string,
		receiptId: string,
		artifactId: string,
		now: number,
	): Promise<StoredArtifact>;
}

export class SqlitePluginIntentStorage implements PluginIntentStorage {
	private identity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(
		private readonly db: SqliteRuntime,
		private readonly artifacts: ArtifactGrantTasks,
	) {}

	installIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.identity) {
			throw new Error('Intent identity reader already installed');
		}
		this.identity = read;
	}

	private readIdentity(tx: SqlExecutor, identity: PluginIntentIdentity): Promise<number | null> {
		if (identity.kind === 'runtime') {
			return Promise.resolve(null);
		}
		if (!this.identity) {
			throw new Error('Intent identity reader unavailable');
		}
		return this.identity(tx, identity.digest);
	}

	create(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		input: StoredPluginIntentCommand,
		admit: (facts: StoredPluginIntentFacts, replay: StoredPluginIntent | null) => void,
		decide: (facts: StoredPluginIntentFacts) => StoredPluginIntent,
	): Promise<StoredPluginIntent> {
		return this.db.transaction(async (tx) => {
			const identityUserId = await this.readIdentity(tx, identity);
			const sender = await app(tx, userId, appId),
				receiver = await app(tx, userId, input.receiverAppId);
			const now = Date.now();
			const facts: StoredPluginIntentFacts = {
				identityUserId,
				sender,
				receiver,
				now,
				artifacts: [],
				count: 0,
				evidenceCount: 0,
				evidenceBytes: 0,
			};
			const existing = await tx.one('SELECT * FROM agent_plugin_intents WHERE id=?', [input.id]);
			const replay = existing === null ? null : readPluginIntentReceipt(existing);
			admit(facts, replay);
			if (existing && replay) {
				if (
					existing.user_id !== userId ||
					replay.senderAppId !== appId ||
					replay.receiverAppId !== input.receiverAppId ||
					replay.intentId !== input.intentId ||
					replay.inputJson !== input.inputJson ||
					JSON.stringify(replay.artifactIds) !== JSON.stringify(input.artifactIds)
				) {
					throw new PluginIntentStorageRefusal('version_conflict');
				}
				return replay;
			}
			await tx.run(
				"UPDATE agent_plugin_intents SET input_json='{}',artifact_ids_json='[]' WHERE user_id=? AND (revoked_at IS NOT NULL OR expires_at<=?) AND (input_json!='{}' OR artifact_ids_json!='[]')",
				[userId, now],
			);
			for (const id of input.artifactIds) {
				try {
					facts.artifacts.push(await this.artifacts.source(tx, userId, appId, id));
				} catch (error) {
					if (error instanceof ArtifactStorageRefusal) {
						throw new PluginIntentStorageRefusal(error.code);
					}
					throw error;
				}
			}
			const count = await tx.one(
				'SELECT COUNT(*) AS count FROM agent_plugin_intents WHERE user_id=? AND sender_app_id=? AND revoked_at IS NULL AND expires_at>?',
				[userId, appId, now],
			);
			facts.count = integer(count?.count);
			const evidence = await tx.one(
				'SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(input_json AS BLOB))),0) AS bytes FROM agent_plugin_intents WHERE user_id=? AND revoked_at IS NULL AND expires_at>?',
				[userId, now],
			);
			facts.evidenceCount = integer(evidence?.count);
			facts.evidenceBytes = integer(evidence?.bytes);
			facts.now = Date.now();
			admit(facts, null);
			const result = decide(facts);
			await tx.run('INSERT INTO agent_plugin_intents VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)', [
				result.id,
				userId,
				result.senderAppId,
				result.receiverAppId,
				result.senderVersion,
				result.receiverVersion,
				result.senderRevision,
				result.receiverRevision,
				result.intentId,
				result.schemaVersion,
				result.inputJson,
				JSON.stringify(result.artifactIds),
				result.createdAt,
				result.expiresAt,
			]);
			await this.artifacts.publish(
				tx,
				userId,
				result.id,
				result.receiverAppId,
				facts.artifacts,
				result.expiresAt,
			);
			facts.now = Date.now();
			admit(facts, null);
			return result;
		});
	}

	list(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		limit: number,
		admit: (identity: number | null, app: StoredPluginIntentApp | null) => void,
		visible: (
			value: StoredPluginIntent,
			sender: StoredPluginIntentApp | null,
			receiver: StoredPluginIntentApp | null,
			now: number,
		) => boolean,
	): Promise<StoredPluginIntent[]> {
		return this.db.transaction(async (tx) => {
			const receiver = await app(tx, userId, appId);
			admit(await this.readIdentity(tx, identity), receiver);
			const now = Date.now();
			const result: StoredPluginIntent[] = [];
			const senders = new Map<string, StoredPluginIntentApp | null>();
			const batchSize = 128;
			let after: { createdAt: number; id: string } | null = null;
			for (;;) {
				// Revoked authority may hide candidates; only visible receipts consume the requested limit.
				const where = after === null ? '' : ' AND (created_at,id)<(?,?)';
				const rows = await tx.all(
					'SELECT * FROM agent_plugin_intents WHERE user_id=? AND receiver_app_id=? AND revoked_at IS NULL AND expires_at>?' +
						where +
						' ORDER BY created_at DESC,id DESC LIMIT ?',
					after === null
						? [userId, appId, now, batchSize]
						: [userId, appId, now, after.createdAt, after.id, batchSize],
				);
				for (const row of rows) {
					const value = readPluginIntentReceipt(row);
					after = { createdAt: value.createdAt, id: value.id };
					let sender = senders.get(value.senderAppId);
					if (sender === undefined) {
						sender = await app(tx, userId, value.senderAppId);
						senders.set(value.senderAppId, sender);
					}
					if (visible(value, sender, receiver, now)) {
						result.push(value);
						if (result.length === limit) {
							break;
						}
					}
				}
				if (rows.length < batchSize || result.length === limit) {
					break;
				}
			}
			admit(await this.readIdentity(tx, identity), await app(tx, userId, appId));
			return result;
		});
	}

	revoke(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		id: string,
		admit: (identity: number | null, app: StoredPluginIntentApp | null) => void,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			admit(await this.readIdentity(tx, identity), await app(tx, userId, appId));
			const row = await tx.one(
				'SELECT id FROM agent_plugin_intents WHERE user_id=? AND sender_app_id=? AND id=?',
				[userId, appId, id],
			);
			if (!row) {
				throw new PluginIntentStorageRefusal('not_found');
			}
			const now = Date.now();
			admit(await this.readIdentity(tx, identity), await app(tx, userId, appId));
			await tx.run('UPDATE agent_plugin_intents SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? AND id=?', [
				now,
				userId,
				id,
			]);
			await this.artifacts.revoke(tx, userId, id, now);
			admit(await this.readIdentity(tx, identity), await app(tx, userId, appId));
		});
	}

	getArtifact(
		userId: number,
		identity: PluginIntentIdentity,
		appId: string,
		id: string,
		artifactId: string,
		admit: (
			identity: number | null,
			receipt: StoredPluginIntent,
			sender: StoredPluginIntentApp | null,
			receiver: StoredPluginIntentApp | null,
			now: number,
		) => void,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT * FROM agent_plugin_intents WHERE user_id=? AND receiver_app_id=? AND id=?',
				[userId, appId, id],
			);
			if (!row) {
				throw new PluginIntentStorageRefusal('not_found');
			}
			const value = readPluginIntentReceipt(row),
				now = Date.now();
			admit(
				await this.readIdentity(tx, identity),
				value,
				await app(tx, userId, value.senderAppId),
				await app(tx, userId, appId),
				now,
			);
			if (!value.artifactIds.includes(artifactId)) {
				throw new PluginIntentStorageRefusal('not_found');
			}
			try {
				const artifact = await this.artifacts.read(tx, userId, appId, id, artifactId, now);
				admit(
					await this.readIdentity(tx, identity),
					value,
					await app(tx, userId, value.senderAppId),
					await app(tx, userId, appId),
					Date.now(),
				);
				return artifact;
			} catch (error) {
				if (error instanceof ArtifactStorageRefusal) {
					throw new PluginIntentStorageRefusal(error.code);
				}
				throw error;
			}
		});
	}
}
