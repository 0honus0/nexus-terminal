import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { decodeProviderRow, readStoredObservations } from './provider-row.js';
import type {
	ProviderStorage,
	ProviderStoredRow,
	ProviderWrite,
	ProviderWriteResult,
	ProviderDeleteResult,
} from '../../storage/provider-storage.js';
import type { StoredProviderObservation } from '../../storage/provider-storage.js';
import type { StoredProviderUsage } from '../../storage/provider-storage.js';
import { AGENT_RUN_STATUSES } from '@nexus-terminal/shared/agent/runs/values';
const columns =
	'id,user_id,display_name,base_url,protocol,models_json,observations_json,protected_credential,credential_revision,enabled,version,created_at,updated_at';

function storedText(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt provider string');
	}
	return value;
}

function storedInteger(value: unknown, min = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
		throw new Error('Corrupt provider integer');
	}
	return value;
}

async function find(tx: SqlExecutor, userId: number, id: string): Promise<ProviderStoredRow | null> {
	const row = await tx.one(`SELECT ${columns} FROM agent_providers WHERE id=? AND user_id=? AND deleted_at IS NULL`, [
		id,
		userId,
	]);
	return row === null ? null : decodeProviderRow(row);
}

export class SqliteProviderStorage implements ProviderStorage {
	constructor(private readonly db: SqliteRuntime) {}

	async recordObservations(
		userId: number,
		id: string,
		version: number,
		credentialRevision: number,
		items: StoredProviderObservation[],
	): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT version,credential_revision FROM agent_providers WHERE id=? AND user_id=? AND deleted_at IS NULL',
				[id, userId],
			);
			if (
				!row ||
				storedInteger(row.version, 1) !== version ||
				storedInteger(row.credential_revision, 1) !== credentialRevision
			) {
				return false;
			}
			const valid = readStoredObservations(JSON.stringify(items));
			const updated = await tx.run(
				'UPDATE agent_providers SET observations_json=? WHERE id=? AND user_id=? AND version=? AND credential_revision=? AND deleted_at IS NULL',
				[JSON.stringify(valid), id, userId, version, credentialRevision],
			);
			if (updated.changes !== 1) {
				throw new Error('Provider observation CAS lost');
			}
			return true;
		});
	}

	async list(userId: number): Promise<ProviderStoredRow[]> {
		return (
			await this.db.all(
				`SELECT ${columns} FROM agent_providers WHERE user_id=? AND deleted_at IS NULL ORDER BY display_name COLLATE NOCASE,id`,
				[userId],
			)
		).map(decodeProviderRow);
	}

	async get(userId: number, id: string): Promise<ProviderStoredRow | null> {
		return find(this.db, userId, id);
	}

	async create(value: ProviderWrite): Promise<ProviderStoredRow> {
		return this.db.transaction(async (tx) => {
			await tx.run(
				'INSERT INTO agent_providers(id,user_id,display_name,base_url,protocol,models_json,protected_credential,credential_revision,enabled,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
				[
					value.id,
					value.userId,
					value.displayName,
					value.baseUrl,
					value.protocol,
					JSON.stringify(value.models),
					value.protectedCredential ?? null,
					1,
					value.enabled ? 1 : 0,
					1,
					value.now,
					value.now,
				],
			);
			const provider = await find(tx, value.userId, value.id);
			if (!provider) {
				throw new Error('Provider insert lost');
			}
			return provider;
		});
	}

	async update(
		value: ProviderWrite,
		expectedVersion: number,
		resetObservations: (current: ProviderStoredRow) => boolean,
	): Promise<ProviderWriteResult> {
		return this.db.transaction(async (tx) => {
			const existing = await find(tx, value.userId, value.id);
			if (!existing) {
				return { status: 'not_found' };
			}
			if (existing.version !== expectedVersion) {
				return { status: 'version_conflict' };
			}
			const changeCredential = value.protectedCredential !== undefined || value.clearCredential === true;
			const credentialSql = changeCredential
				? ',protected_credential=?,credential_revision=credential_revision+1'
				: '';
			const clearObservations = resetObservations(existing);
			const changed = await tx.run(
				`UPDATE agent_providers SET display_name=?,base_url=?,protocol=?,models_json=?,enabled=?,updated_at=?,version=version+1${credentialSql}${clearObservations ? ",observations_json='[]'" : ''} WHERE user_id=? AND id=? AND version=? AND deleted_at IS NULL`,
				[
					value.displayName,
					value.baseUrl,
					value.protocol,
					JSON.stringify(value.models),
					value.enabled ? 1 : 0,
					value.now,
					...(changeCredential ? [value.protectedCredential ?? null] : []),
					value.userId,
					value.id,
					expectedVersion,
				],
			);
			if (changed.changes !== 1) {
				throw new Error('Provider CAS lost');
			}
			const updated = await find(tx, value.userId, value.id);
			if (!updated) {
				throw new Error('Provider row disappeared');
			}
			return { status: 'ok', provider: updated };
		});
	}

	async remove(
		userId: number,
		id: string,
		expectedVersion: number,
		now: number,
		mayDelete: (usage: StoredProviderUsage) => boolean,
	): Promise<ProviderDeleteResult> {
		return this.db.transaction(async (tx) => {
			const existing = await find(tx, userId, id);
			if (!existing) {
				return { status: 'not_found' };
			}
			if (existing.version !== expectedVersion) {
				return { status: 'version_conflict' };
			}
			const references = await tx.all(
				`SELECT DISTINCT r.status FROM agent_run_frozen_inputs f JOIN agent_runs r ON f.run_id=r.id
				 WHERE f.provider_id=? AND r.user_id=?`,
				[id, userId],
			);
			const runStatuses = references.map((row) => {
				const status = AGENT_RUN_STATUSES.find((value) => value === row.status);
				if (status === undefined) {
					throw new Error('Corrupt Provider Run reference');
				}
				return status;
			});
			if (!mayDelete({ runStatuses })) {
				return { status: 'provider_in_use' };
			}
			const result = await tx.run(
				'UPDATE agent_providers SET enabled=0,protected_credential=NULL,credential_revision=credential_revision+1,version=version+1,deleted_at=?,updated_at=? WHERE id=? AND user_id=? AND version=? AND deleted_at IS NULL',
				[now, now, id, userId, expectedVersion],
			);
			if (result.changes !== 1) {
				throw new Error('Provider deletion CAS lost');
			}
			return { status: 'ok' };
		});
	}

	async credential(
		userId: number,
		id: string,
		providerVersion: number,
		credentialRevision: number,
	): Promise<string | null> {
		const row = await this.db.one(
			'SELECT version,credential_revision,protected_credential,enabled FROM agent_providers WHERE id=? AND user_id=? AND deleted_at IS NULL',
			[id, userId],
		);
		if (!row || row.enabled !== 1) {
			return null;
		}
		if (
			storedInteger(row.version, 1) !== providerVersion ||
			storedInteger(row.credential_revision, 1) !== credentialRevision
		) {
			return null;
		}
		return row.protected_credential === null ? null : storedText(row.protected_credential);
	}

	async snapshot(tx: SqlExecutor, userId: number, id: string): Promise<ProviderStoredRow | null> {
		return find(tx, userId, id);
	}
}
