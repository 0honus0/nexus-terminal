import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	IntegrationStorage,
	StoredIntegrationScope,
	StoredIntegration,
	StoredIntegrationFacts,
	StoredIntegrationTask,
	StoredIntegrationReceipt,
} from '../../storage/integration-storage.js';
import { IntegrationStorageRefusal } from '../../storage/integration-storage.js';
import { integrationRow, integrationReceipt } from './integration-row.js';

async function get(tx: SqlExecutor, scope: StoredIntegrationScope, id: string): Promise<StoredIntegration | null> {
	const row = await tx.one('SELECT * FROM agent_integrations WHERE user_id=? AND app_id=? AND id=?', [
		scope.userId,
		scope.appId,
		id,
	]);
	return row === null ? null : integrationRow(row);
}

export class SqliteIntegrationStorage implements IntegrationStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Integration identity already installed');
		}
		this.readIdentity = read;
	}

	private async facts(
		tx: SqlExecutor,
		scope: StoredIntegrationScope,
		digest: string,
	): Promise<StoredIntegrationFacts> {
		if (!this.readIdentity) {
			throw new Error('Integration identity unavailable');
		}
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE id=? AND user_id=?', [
			scope.appId,
			scope.userId,
		]);
		const count = await tx.one('SELECT COUNT(*) AS count FROM agent_integrations WHERE user_id=? AND app_id=?', [
			scope.userId,
			scope.appId,
		]);
		if (typeof count?.count !== 'number') {
			throw new Error('Integration count missing');
		}
		return {
			exists: app !== null,
			enabled: app?.enabled === 1,
			identityUserId: await this.readIdentity(tx, digest),
			count: count.count,
		};
	}

	async list(scope: StoredIntegrationScope): Promise<StoredIntegration[]> {
		return (
			await this.db.all('SELECT * FROM agent_integrations WHERE user_id=? AND app_id=? ORDER BY created_at,id', [
				scope.userId,
				scope.appId,
			])
		).map(integrationRow);
	}

	get(scope: StoredIntegrationScope, id: string): Promise<StoredIntegration | null> {
		return get(this.db, scope, id);
	}

	create(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		key: string,
		intentHash: string,
		now: number,
		admit: (facts: StoredIntegrationFacts) => void,
		decide: (facts: StoredIntegrationFacts) => StoredIntegrationTask,
	): Promise<StoredIntegrationReceipt> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, scope, digest);
			admit(facts);
			const prior = await tx.one(
				'SELECT * FROM agent_integration_intents WHERE user_id=? AND app_id=? AND operation_key=?',
				[scope.userId, scope.appId, key],
			);
			if (prior) {
				if (prior.intent_hash !== intentHash || typeof prior.integration_id !== 'string') {
					throw new IntegrationStorageRefusal('idempotency_conflict');
				}
				return integrationReceipt(prior);
			}
			const task = decide(facts);
			await tx.run('INSERT INTO agent_integrations VALUES(?,?,?,?,?,?,?,NULL,1,?,?)', [
				id,
				scope.userId,
				scope.appId,
				JSON.stringify(task.configuration),
				task.enabled ? 1 : 0,
				task.encryptedCredential,
				task.credentialRevision,
				now,
				now,
			]);
			const saved = await get(tx, scope, id);
			if (!saved) {
				throw new Error('Created integration missing');
			}
			const receipt: StoredIntegrationReceipt = {
				id: saved.id,
				appId: saved.appId,
				configuration: saved.configuration,
				enabled: saved.enabled,
				hasCredential: saved.encryptedCredential !== null,
				credentialRevision: saved.credentialRevision,
				schemaHash: saved.schemaHash,
				version: saved.version,
				createdAt: saved.createdAt,
				updatedAt: saved.updatedAt,
			};
			await tx.run('INSERT INTO agent_integration_intents VALUES(?,?,?,?,?,?)', [
				scope.userId,
				scope.appId,
				key,
				intentHash,
				id,
				JSON.stringify(receipt),
			]);
			return receipt;
		});
	}

	update(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		now: number,
		decide: (facts: StoredIntegrationFacts, current: StoredIntegration) => StoredIntegrationTask,
	): Promise<StoredIntegration> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, scope, digest);
			const current = await get(tx, scope, id);
			if (!current) {
				throw new IntegrationStorageRefusal('not_found');
			}
			if (current.version !== version) {
				throw new IntegrationStorageRefusal('version_conflict');
			}
			const task = decide(facts, current);
			if (current.version === Number.MAX_SAFE_INTEGER || !Number.isSafeInteger(task.credentialRevision)) {
				throw new IntegrationStorageRefusal('version_conflict');
			}
			await tx.run(
				'UPDATE agent_integrations SET configuration_json=?,enabled=?,encrypted_credential=?,credential_revision=?,schema_hash=NULL,version=version+1,updated_at=? WHERE id=?',
				[
					JSON.stringify(task.configuration),
					task.enabled ? 1 : 0,
					task.encryptedCredential,
					task.credentialRevision,
					now,
					id,
				],
			);
			const saved = await get(tx, scope, id);
			if (!saved) {
				throw new Error('Updated integration missing');
			}
			return saved;
		});
	}

	remove(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		admit: (facts: StoredIntegrationFacts) => void,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, digest));
			const current = await get(tx, scope, id);
			if (!current) {
				throw new IntegrationStorageRefusal('not_found');
			}
			if (current.version !== version) {
				throw new IntegrationStorageRefusal('version_conflict');
			}
			await tx.run('DELETE FROM agent_integrations WHERE id=?', [id]);
		});
	}

	discover(
		scope: StoredIntegrationScope,
		digest: string,
		id: string,
		version: number,
		hash: string,
		admit: (facts: StoredIntegrationFacts) => void,
	): Promise<StoredIntegration> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, digest));
			const current = await get(tx, scope, id);
			if (!current) {
				throw new IntegrationStorageRefusal('not_found');
			}
			if (current.version !== version || !current.enabled) {
				throw new IntegrationStorageRefusal('version_conflict');
			}
			if (current.schemaHash !== hash) {
				if (current.version === Number.MAX_SAFE_INTEGER) {
					throw new IntegrationStorageRefusal('version_conflict');
				}
				await tx.run('UPDATE agent_integrations SET schema_hash=?,version=version+1,updated_at=? WHERE id=?', [
					hash,
					Date.now(),
					id,
				]);
			}
			const saved = await get(tx, scope, id);
			if (!saved) {
				throw new Error('Discovered integration missing');
			}
			return saved;
		});
	}
}
