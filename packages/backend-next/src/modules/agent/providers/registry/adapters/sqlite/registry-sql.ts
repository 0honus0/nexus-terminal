import { AGENT_REGISTRY_ERROR_CODES } from '@nexus-terminal/shared/agent/providers/values';
import type { SqlExecutor } from '../../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { CapabilityRegistryStorage } from '../../storage/registry-storage.js';
import { decodeRegistrySnapshot } from './registry-row.js';
import type { StoredCapabilityRegistryRead, StoredCapabilityRegistryState } from '../../storage/registry-storage.js';

export async function migrateModelRegistry(tx: SqlExecutor): Promise<void> {
	await tx.exec(`
		CREATE TABLE agent_model_capability_registry (
			id INTEGER PRIMARY KEY CHECK (id=1),
			snapshot_json TEXT,
			last_attempt_at INTEGER,
			last_success_at INTEGER,
			last_error_code TEXT
		);
		INSERT INTO agent_model_capability_registry(id) VALUES(1);
	`);
}

function integerOrNull(value: unknown): number | null {
	if (value === null) {
		return null;
	}
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new Error('Corrupt registry timestamp');
	}
	return value;
}

export class SqliteCapabilityRegistryStorage implements CapabilityRegistryStorage {
	constructor(private readonly db: SqliteRuntime) {}

	async load(): Promise<StoredCapabilityRegistryRead> {
		const row = await this.db.one(
			'SELECT snapshot_json,last_attempt_at,last_success_at,last_error_code FROM agent_model_capability_registry WHERE id=1',
		);
		if (!row) {
			throw new Error('Missing model registry singleton row');
		}
		if (row.snapshot_json !== null && typeof row.snapshot_json !== 'string') {
			throw new Error('Corrupt registry state');
		}
		const lastErrorCode =
			row.last_error_code === null
				? null
				: AGENT_REGISTRY_ERROR_CODES.find((code) => code === row.last_error_code);
		if (lastErrorCode === undefined) {
			throw new Error('Corrupt registry failure');
		}
		let snapshot: StoredCapabilityRegistryState['snapshot'] = null;
		let snapshotInvalid = false;
		if (row.snapshot_json !== null) {
			try {
				const parsed: unknown = JSON.parse(row.snapshot_json);
				snapshot = decodeRegistrySnapshot(parsed);
			} catch {
				snapshotInvalid = true;
			}
		}
		return {
			snapshot,
			snapshotInvalid,
			lastAttemptAt: integerOrNull(row.last_attempt_at),
			lastSuccessAt: integerOrNull(row.last_success_at),
			lastErrorCode,
		};
	}

	async save(value: StoredCapabilityRegistryState): Promise<void> {
		const result = await this.db.run(
			'UPDATE agent_model_capability_registry SET snapshot_json=?,last_attempt_at=?,last_success_at=?,last_error_code=? WHERE id=1',
			[
				value.snapshot === null ? null : JSON.stringify(value.snapshot),
				value.lastAttemptAt,
				value.lastSuccessAt,
				value.lastErrorCode,
			],
		);
		if (result.changes !== 1) {
			throw new Error('Model registry singleton update failed');
		}
	}
}
