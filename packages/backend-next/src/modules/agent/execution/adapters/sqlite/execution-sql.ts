import { cancelRunsInScope } from '../../../runs/adapters/sqlite/run-fence.js';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ExecutionStorage,
	StoredExecutionSettings,
	StoredExecutionActor,
	StoredExecutionFacts,
	StoredHardLimitPreview,
} from '../../storage/execution-storage.js';
import { ExecutionStorageRefusal } from '../../storage/execution-storage.js';
import { executionDocument, executionLimits, executionInteger } from './execution-row.js';

export async function executionSettings(tx: SqlReader, userId: number): Promise<StoredExecutionSettings | null> {
	const row = await tx.one('SELECT version,settings_json FROM agent_execution_settings WHERE user_id=?', [userId]);
	if (!row) {
		return null;
	}
	const value = executionDocument(row.settings_json);
	if (value.version !== row.version) {
		throw new Error('Execution settings version mismatch');
	}
	return value;
}

async function usage(tx: SqlExecutor, userId: number): Promise<{ occupiedArtifactBytes: number; activeRuns: number }> {
	const row = await tx.one(
		"SELECT (SELECT COALESCE(SUM(size_bytes),0) FROM agent_artifacts WHERE user_id=? AND status!='deleted') AS bytes,(SELECT COUNT(*) FROM agent_runs WHERE user_id=? AND status IN ('pending','running','unknown')) AS runs",
		[userId, userId],
	);
	if (!row) {
		throw new Error('Execution usage missing');
	}
	return { occupiedArtifactBytes: executionInteger(row.bytes), activeRuns: executionInteger(row.runs) };
}

function previewRow(
	row: Record<string, unknown>,
	facts: { occupiedArtifactBytes: number; activeRuns: number },
): StoredHardLimitPreview {
	if (typeof row.id !== 'string' || typeof row.proposed_json !== 'string') {
		throw new Error('Corrupt hard limit confirmation');
	}
	return {
		id: row.id,
		expectedVersion: executionInteger(row.expected_version),
		expiresAt: executionInteger(row.expires_at, 1),
		proposed: executionLimits(JSON.parse(row.proposed_json)),
		occupiedArtifactBytes: facts.occupiedArtifactBytes,
		activeRuns: facts.activeRuns,
	};
}

export class SqliteExecutionStorage implements ExecutionStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Execution identity reader already installed');
		}
		this.readIdentity = read;
	}

	private async facts(tx: SqlExecutor, actor: StoredExecutionActor): Promise<StoredExecutionFacts> {
		if (!this.readIdentity) {
			throw new Error('Execution identity reader unavailable');
		}
		const totals = await usage(tx, actor.userId);
		return {
			identityUserId: await this.readIdentity(tx, actor.digest),
			settings: await executionSettings(tx, actor.userId),
			occupiedArtifactBytes: totals.occupiedArtifactBytes,
			activeRuns: totals.activeRuns,
		};
	}

	frozen(userId: number, appId: string, runId: string): Promise<StoredExecutionSettings | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				'SELECT s.settings_json FROM agent_run_execution_settings s JOIN agent_runs r ON r.id=s.run_id WHERE r.id=? AND r.user_id=? AND r.app_id=?',
				[runId, userId, appId],
			);
			return row === null ? null : executionDocument(row.settings_json);
		});
	}

	get(userId: number): Promise<StoredExecutionSettings | null> {
		return this.db.transaction((tx) => executionSettings(tx, userId));
	}

	private async save(
		tx: SqlExecutor,
		userId: number,
		current: StoredExecutionSettings | null,
		next: StoredExecutionSettings,
	): Promise<void> {
		if (next.version !== (current?.version ?? 0) + 1) {
			throw new Error('Invalid execution version decision');
		}
		executionDocument(JSON.stringify(next));
		const apps = await tx.all('SELECT id FROM agent_apps WHERE user_id=?', [userId]);
		for (const app of apps) {
			if (typeof app.id !== 'string') {
				throw new Error('Invalid execution revocation scope');
			}
			await cancelRunsInScope(tx, userId, app.id, next.updatedAt);
		}
		if (current) {
			const result = await tx.run(
				'UPDATE agent_execution_settings SET version=?,settings_json=? WHERE user_id=? AND version=?',
				[next.version, JSON.stringify(next), userId, current.version],
			);
			if (result.changes !== 1) {
				throw new ExecutionStorageRefusal('version_conflict');
			}
		} else {
			await tx.run('INSERT INTO agent_execution_settings(user_id,version,settings_json) VALUES(?,?,?)', [
				userId,
				next.version,
				JSON.stringify(next),
			]);
		}
	}

	update(
		actor: StoredExecutionActor,
		expectedVersion: number,
		decide: (facts: StoredExecutionFacts) => StoredExecutionSettings,
	): Promise<StoredExecutionSettings> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, actor);
			if ((facts.settings?.version ?? 0) !== expectedVersion) {
				throw new ExecutionStorageRefusal('version_conflict');
			}
			const next = decide(facts);
			await this.save(tx, actor.userId, facts.settings, next);
			return next;
		});
	}

	preview(
		actor: StoredExecutionActor,
		id: string,
		expiresAt: number,
		now: number,
		decide: (facts: StoredExecutionFacts, confirmations: number) => StoredHardLimitPreview,
	): Promise<StoredHardLimitPreview> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, actor);
			await tx.run('DELETE FROM agent_hard_limit_confirmations WHERE expires_at<=?', [now]);
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_hard_limit_confirmations WHERE user_id=?', [
				actor.userId,
			]);
			if (!count) {
				throw new Error('Confirmation count missing');
			}
			const selected = decide(facts, executionInteger(count.count));
			await tx.run(
				'INSERT INTO agent_hard_limit_confirmations(id,user_id,expected_version,proposed_json,expires_at) VALUES(?,?,?,?,?)',
				[id, actor.userId, selected.expectedVersion, JSON.stringify(selected.proposed), expiresAt],
			);
			return selected;
		});
	}

	confirm(
		actor: StoredExecutionActor,
		id: string,
		now: number,
		decide: (facts: StoredExecutionFacts, preview: StoredHardLimitPreview) => StoredExecutionSettings,
	): Promise<StoredExecutionSettings> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, actor);
			const row = await tx.one('SELECT * FROM agent_hard_limit_confirmations WHERE id=? AND user_id=?', [
				id,
				actor.userId,
			]);
			if (!row) {
				throw new ExecutionStorageRefusal('not_found');
			}
			if (
				row.consumed_at !== null ||
				executionInteger(row.expires_at) <= now ||
				(facts.settings?.version ?? 0) !== row.expected_version
			) {
				throw new ExecutionStorageRefusal('version_conflict');
			}
			const plan = previewRow(row, facts);
			const next = decide(facts, plan);
			await this.save(tx, actor.userId, facts.settings, next);
			await tx.run('UPDATE agent_hard_limit_confirmations SET consumed_at=? WHERE id=? AND consumed_at IS NULL', [
				now,
				id,
			]);
			return next;
		});
	}
}
