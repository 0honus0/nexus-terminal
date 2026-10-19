import { frozenExecution } from '../../../execution/adapters/sqlite/execution-budget-sql.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	StoredArtifactScope,
	StoredArtifactAuthorization,
	StoredArtifact,
	StoredArtifactFacts,
	StoredArtifactCreation,
	StoredArtifactChange,
	StoredArtifactQuery,
	StoredArtifactAttach,
	StoredArtifactCleanup,
	StoredArtifactSummary,
	ArtifactStorage,
} from '../../storage/artifact-storage.js';
import { ArtifactStorageRefusal } from '../../storage/artifact-storage.js';
import { artifactRow, artifactInteger } from './artifact-row.js';
import { currentParticipant } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { toolOperation } from '../../../runs/adapters/sqlite/run-tool-row.js';

async function record(tx: SqlExecutor, scope: StoredArtifactScope, id: string): Promise<StoredArtifact | null> {
	const row = await tx.one('SELECT * FROM agent_artifacts WHERE user_id=? AND app_id=? AND id=?', [
		scope.userId,
		scope.appId,
		id,
	]);
	return row === null ? null : artifactRow(row);
}

async function required(
	tx: SqlExecutor,
	scope: StoredArtifactScope,
	id: string,
	version: number,
): Promise<StoredArtifact> {
	const current = await record(tx, scope, id);
	if (!current) {
		throw new ArtifactStorageRefusal('not_found');
	}
	if (current.version !== version) {
		throw new ArtifactStorageRefusal('version_conflict');
	}
	return current;
}

async function refs(tx: SqlExecutor, id: string, now: number): Promise<number> {
	const row = await tx.one(
		`SELECT (SELECT COUNT(*) FROM agent_artifact_attachments WHERE artifact_id=?) + (SELECT COUNT(*) FROM agent_artifact_grants WHERE artifact_id=? AND revoked_at IS NULL AND expires_at>?) AS count`,
		[id, id, now],
	);
	if (!row) {
		throw new Error('Artifact references missing');
	}
	return artifactInteger(row.count);
}

async function saved(tx: SqlExecutor, scope: StoredArtifactScope, id: string): Promise<StoredArtifact> {
	const value = await record(tx, scope, id);
	if (!value) {
		throw new Error('Artifact disappeared');
	}
	return value;
}

function requireVersionCapacity(version: number, increments = 1): void {
	if (version > Number.MAX_SAFE_INTEGER - increments) {
		throw new ArtifactStorageRefusal('version_conflict');
	}
}

export class SqliteArtifactStorage implements ArtifactStorage {
	recovery(): Promise<{ userId: number; record: StoredArtifact }[]> {
		return this.db.transaction(async (tx) => {
			const rows = await tx.all(
				"SELECT * FROM agent_artifacts WHERE status IN ('staging','unavailable','deleting') ORDER BY id",
			);
			const records = rows.map(artifactRow);
			for (const record of records) {
				requireVersionCapacity(record.version, record.status === 'deleting' ? 1 : 2);
			}
			const values: { userId: number; record: StoredArtifact }[] = [];
			for (let index = 0; index < rows.length; index++) {
				const row = rows[index];
				const record = records[index];
				if (record.status !== 'deleting') {
					await tx.run(
						"UPDATE agent_artifacts SET status='deleting',version=version+1 WHERE id=? AND version=?",
						[record.id, record.version],
					);
				}
				values.push({
					userId: artifactInteger(row.user_id, 1),
					record: await saved(
						tx,
						{ userId: artifactInteger(row.user_id, 1), appId: record.appId },
						record.id,
					),
				});
			}
			return values;
		});
	}

	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Artifact identity reader already installed');
		}
		this.readIdentity = read;
	}

	private async identity(
		tx: SqlExecutor,
		userId: number,
		appId: string | null,
		auth: StoredArtifactAuthorization,
	): Promise<number | null> {
		if (auth.kind === 'session') {
			if (!this.readIdentity) {
				throw new Error('Artifact identity reader unavailable');
			}
			return this.readIdentity(tx, auth.digest);
		}
		if (appId === null) {
			return null;
		}
		const operation = await toolOperation(tx, userId, appId, auth.runId, auth.operationId);
		const current =
			operation !== null &&
			operation.state === 'dispatched' &&
			operation.operationHash === auth.operationHash &&
			(await currentParticipant(
				tx,
				{ userId, appId, runId: auth.runId },
				Date.now,
				operation.toolName,
				operation.modelStepIndex,
			));
		return current ? userId : null;
	}

	private async facts(
		tx: SqlExecutor,
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
	): Promise<StoredArtifactFacts> {
		const app = await tx.one('SELECT enabled FROM agent_apps WHERE id=? AND user_id=?', [
			scope.appId,
			scope.userId,
		]);
		const totals = await tx.one(
			"SELECT COALESCE(SUM(size_bytes),0) AS bytes,COUNT(*) AS count FROM agent_artifacts WHERE user_id=? AND status!='deleted'",
			[scope.userId],
		);
		if (!totals) {
			throw new Error('Artifact totals missing');
		}
		const settingsRow =
			auth.kind === 'session'
				? await tx.one('SELECT version FROM agent_execution_settings WHERE user_id=?', [scope.userId])
				: null;
		const settingsVersion =
			auth.kind === 'session'
				? settingsRow === null
					? 0
					: artifactInteger(settingsRow.version)
				: (await frozenExecution(tx, auth.runId)).version;
		return {
			settingsVersion,
			identityUserId: await this.identity(tx, scope.userId, scope.appId, auth),
			appExists: app !== null,
			appEnabled: app?.enabled === 1,
			totalBytes: artifactInteger(totals.bytes),
			totalCount: artifactInteger(totals.count),
		};
	}

	create(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		input: StoredArtifactCreation,
		admit: (facts: StoredArtifactFacts) => void,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth));
			await tx.run(
				"INSERT INTO agent_artifacts(id,user_id,app_id,name,media_type,kind,size_bytes,status,retained,version,created_at,expires_at,upload_claimed) VALUES(?,?,?,?,?,?,?,'staging',0,1,?,?,0)",
				[
					input.id,
					scope.userId,
					scope.appId,
					input.name,
					input.mediaType,
					input.kind,
					input.sizeBytes,
					input.now,
					input.expiresAt,
				],
			);
			return saved(tx, scope, input.id);
		});
	}

	getAccessible(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		admit: (facts: StoredArtifactFacts) => void,
		decide: (record: StoredArtifact, sourceEnabled: boolean) => void,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, scope, auth);
			admit(facts);
			if (auth.kind === 'session') {
				const row = await record(tx, scope, id);
				if (!row) {
					throw new ArtifactStorageRefusal('not_found');
				}
				decide(row, facts.appEnabled);
				return row;
			}
			const row = await tx.one(
				`SELECT f.*,a.enabled AS source_enabled FROM agent_artifacts f JOIN agent_apps a ON a.id=f.app_id AND a.user_id=f.user_id
    WHERE f.id=? AND f.user_id=? AND (f.app_id=? OR EXISTS(SELECT 1 FROM agent_artifact_attachments x JOIN agent_runs r ON r.thread_id=x.thread_id AND r.user_id=x.user_id AND r.app_id=x.target_app_id WHERE x.artifact_id=f.id AND r.id=? AND r.user_id=? AND r.app_id=? AND (x.run_id IS NULL OR x.run_id=r.id)))`,
				[id, scope.userId, scope.appId, auth.runId, scope.userId, scope.appId],
			);
			if (!row) {
				throw new ArtifactStorageRefusal('not_found');
			}
			const item = artifactRow(row);
			decide(item, row.source_enabled === 1);
			return item;
		});
	}

	get(scope: StoredArtifactScope, id: string): Promise<StoredArtifact | null> {
		return this.db.transaction((tx) => record(tx, scope, id));
	}

	list(userId: number, query: StoredArtifactQuery): Promise<StoredArtifact[]> {
		return this.db.transaction(async (tx) =>
			(
				await tx.all(
					"SELECT * FROM agent_artifacts WHERE user_id=? AND status!='deleted' AND (? IS NULL OR app_id=?) AND (? IS NULL OR retained=?) AND (? IS NULL OR kind=?) AND instr(lower(name),lower(?))>0 ORDER BY created_at DESC,id LIMIT ? OFFSET ?",
					[
						userId,
						query.appId,
						query.appId,
						query.retained === null ? null : query.retained ? 1 : 0,
						query.retained === null ? null : query.retained ? 1 : 0,
						query.kind,
						query.kind,
						query.q,
						query.limit,
						query.offset,
					],
				)
			).map(artifactRow),
		);
	}

	summary(userId: number, now: number): Promise<StoredArtifactSummary> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				`SELECT COALESCE(SUM(size_bytes),0) AS total,
    COALESCE(SUM(CASE WHEN retained=1 THEN size_bytes ELSE 0 END),0) AS retained,
    COALESCE(SUM(CASE WHEN (EXISTS(SELECT 1 FROM agent_artifact_attachments a WHERE a.artifact_id=f.id) OR EXISTS(SELECT 1 FROM agent_artifact_grants g WHERE g.artifact_id=f.id AND g.revoked_at IS NULL AND g.expires_at>?)) THEN size_bytes ELSE 0 END),0) AS protected,
    COALESCE(SUM(CASE WHEN status='ready' AND retained=0 AND expires_at<=? AND NOT (EXISTS(SELECT 1 FROM agent_artifact_attachments a WHERE a.artifact_id=f.id) OR EXISTS(SELECT 1 FROM agent_artifact_grants g WHERE g.artifact_id=f.id AND g.revoked_at IS NULL AND g.expires_at>?)) THEN size_bytes ELSE 0 END),0) AS reclaimable,
    COALESCE(SUM(CASE WHEN status='staging' THEN size_bytes ELSE 0 END),0) AS staging,
    COALESCE(SUM(CASE WHEN status IN ('deleting','unavailable') THEN size_bytes ELSE 0 END),0) AS unavailable
    FROM agent_artifacts f WHERE user_id=? AND status!='deleted'`,
				[now, now, now, userId],
			);
			if (!row) {
				throw new Error('Artifact summary missing');
			}
			const stagingBytes = artifactInteger(row.staging);
			return {
				totalBytes: artifactInteger(row.total),
				retainedBytes: artifactInteger(row.retained),
				protectedBytes: artifactInteger(row.protected),
				reclaimableBytes: artifactInteger(row.reclaimable),
				stagingBytes,
				unavailableBytes: artifactInteger(row.unavailable),
				reservedBytes: stagingBytes,
			};
		});
	}

	mutate(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		version: number,
		clock: () => number,
		task: StoredArtifactChange,
		admit: (facts: StoredArtifactFacts) => void,
		decide: (record: StoredArtifact, references: number, now: number) => void,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth));
			const current = await required(tx, scope, id, version);
			requireVersionCapacity(current.version, task.kind === 'retain' ? 1 : 2);
			const references = await refs(tx, id, clock());
			decide(current, references, clock());
			let change;
			if (task.kind === 'upload') {
				change = await tx.run(
					'UPDATE agent_artifacts SET upload_claimed=1,version=version+1 WHERE id=? AND version=? AND upload_claimed=0',
					[id, version],
				);
			} else if (task.kind === 'retain') {
				change = await tx.run(
					'UPDATE agent_artifacts SET retained=?,version=version+1 WHERE id=? AND version=?',
					[task.retained ? 1 : 0, id, version],
				);
			} else {
				change = await tx.run(
					"UPDATE agent_artifacts SET status='deleting',version=version+1 WHERE id=? AND version=?",
					[id, version],
				);
			}
			if (change.changes !== 1) {
				throw new ArtifactStorageRefusal('version_conflict');
			}
			return saved(tx, scope, id);
		});
	}

	settle(
		scope: StoredArtifactScope,
		id: string,
		version: number,
		status: 'ready' | 'deleted' | 'unavailable',
		hash: string | null,
		now: number,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			const previous = await required(tx, scope, id, version);
			requireVersionCapacity(previous.version);
			if (
				(status === 'ready' && previous.status !== 'staging') ||
				(status === 'deleted' && previous.status !== 'deleting') ||
				(status === 'unavailable' && previous.status !== 'staging' && previous.status !== 'deleting')
			) {
				throw new ArtifactStorageRefusal('version_conflict');
			}
			await tx.run(
				'UPDATE agent_artifacts SET status=?,sha256=?,ready_at=?,deleted_at=?,version=version+1 WHERE id=? AND version=?',
				[
					status,
					hash,
					status === 'ready' ? now : previous.readyAt,
					status === 'deleted' ? now : null,
					id,
					version,
				],
			);
			return saved(tx, scope, id);
		});
	}

	attach(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		version: number,
		input: StoredArtifactAttach,
		clock: () => number,
		admit: (facts: StoredArtifactFacts) => void,
		decide: (record: StoredArtifact, targetEnabled: boolean, now: number) => void,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth));
			const current = await required(tx, scope, id, version);
			const thread = await tx.one(
				'SELECT a.enabled FROM agent_threads t JOIN agent_apps a ON a.id=t.app_id AND a.user_id=t.user_id WHERE t.id=? AND t.app_id=? AND t.user_id=?',
				[input.threadId, input.targetAppId, scope.userId],
			);
			const run =
				input.runId === null
					? null
					: await tx.one('SELECT id FROM agent_runs WHERE id=? AND thread_id=? AND user_id=? AND app_id=?', [
							input.runId,
							input.threadId,
							scope.userId,
							input.targetAppId,
						]);
			if (!thread || (input.runId !== null && !run)) {
				throw new ArtifactStorageRefusal('not_found');
			}
			requireVersionCapacity(current.version);
			const now = clock();
			decide(current, thread.enabled === 1, now);
			const previous = await tx.one(
				'SELECT artifact_id FROM agent_artifact_attachments WHERE artifact_id=? AND thread_id=?',
				[id, input.threadId],
			);
			if (previous) {
				throw new ArtifactStorageRefusal('version_conflict');
			}
			await tx.run(
				'INSERT INTO agent_artifact_attachments(artifact_id,user_id,target_app_id,thread_id,run_id,created_at) VALUES(?,?,?,?,?,?)',
				[id, scope.userId, input.targetAppId, input.threadId, input.runId, now],
			);
			await tx.run('UPDATE agent_artifacts SET version=version+1 WHERE id=? AND version=?', [id, version]);
			return saved(tx, scope, id);
		});
	}

	detach(
		scope: StoredArtifactScope,
		auth: StoredArtifactAuthorization,
		id: string,
		version: number,
		threadId: string,
		now: number,
		admit: (facts: StoredArtifactFacts) => void,
	): Promise<StoredArtifact> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, scope, auth));
			const current = await required(tx, scope, id, version);
			requireVersionCapacity(current.version);
			const deleted = await tx.run(
				'DELETE FROM agent_artifact_attachments WHERE artifact_id=? AND thread_id=? AND user_id=?',
				[id, threadId, scope.userId],
			);
			if (deleted.changes !== 1) {
				throw new ArtifactStorageRefusal('not_found');
			}
			await tx.run('UPDATE agent_artifacts SET version=version+1 WHERE id=? AND version=?', [id, version]);
			return saved(tx, scope, id);
		});
	}

	previewCleanup(
		userId: number,
		auth: StoredArtifactAuthorization,
		id: string,
		ttlMs: number,
		clock: () => number,
		admit: (identity: number | null, confirmations: number) => void,
		limit: number,
	): Promise<StoredArtifactCleanup> {
		return this.db.transaction(async (tx) => {
			const identity = await this.identity(tx, userId, null, auth);
			const now = clock();
			const expiresAt = now + ttlMs;
			await tx.run('DELETE FROM agent_artifact_cleanup WHERE expires_at<=?', [now]);
			const count = await tx.one('SELECT COUNT(*) AS count FROM agent_artifact_cleanup WHERE user_id=?', [
				userId,
			]);
			if (!count) {
				throw new Error('Artifact confirmation count missing');
			}
			admit(identity, artifactInteger(count.count));
			const items = (
				await tx.all(
					"SELECT * FROM agent_artifacts f WHERE user_id=? AND status='ready' AND retained=0 AND expires_at<=? AND NOT (EXISTS(SELECT 1 FROM agent_artifact_attachments a WHERE a.artifact_id=f.id) OR EXISTS(SELECT 1 FROM agent_artifact_grants g WHERE g.artifact_id=f.id AND g.revoked_at IS NULL AND g.expires_at>?)) ORDER BY expires_at,id LIMIT ?",
					[userId, now, now, limit],
				)
			).map(artifactRow);
			const protectedRow = await tx.one(
				"SELECT COUNT(*) AS count FROM agent_artifacts f WHERE user_id=? AND status!='deleted' AND (EXISTS(SELECT 1 FROM agent_artifact_attachments a WHERE a.artifact_id=f.id) OR EXISTS(SELECT 1 FROM agent_artifact_grants g WHERE g.artifact_id=f.id AND g.revoked_at IS NULL AND g.expires_at>?))",
				[userId, now],
			);
			if (!protectedRow) {
				throw new Error('Protected artifacts count missing');
			}
			await tx.run('INSERT INTO agent_artifact_cleanup(id,user_id,expires_at) VALUES(?,?,?)', [
				id,
				userId,
				expiresAt,
			]);
			for (const item of items) {
				await tx.run(
					'INSERT INTO agent_artifact_cleanup_items(confirmation_id,artifact_id,version) VALUES(?,?,?)',
					[id, item.id, item.version],
				);
			}
			return { id, expiresAt, items, protectedCount: artifactInteger(protectedRow.count) };
		});
	}

	claimCleanup(
		userId: number,
		auth: StoredArtifactAuthorization,
		id: string,
		clock: () => number,
		admit: (identity: number | null) => void,
		decide: (record: StoredArtifact, references: number, now: number) => void,
	): Promise<StoredArtifact[]> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, userId, null, auth));
			const confirmation = await tx.one(
				'SELECT expires_at,consumed_at FROM agent_artifact_cleanup WHERE id=? AND user_id=?',
				[id, userId],
			);
			if (!confirmation) {
				throw new ArtifactStorageRefusal('not_found');
			}
			const rows = await tx.all(
				'SELECT f.*,i.version AS expected_version FROM agent_artifact_cleanup_items i JOIN agent_artifacts f ON f.id=i.artifact_id WHERE i.confirmation_id=? AND f.user_id=?',
				[id, userId],
			);
			const items = rows.map((row) => {
				const item = artifactRow(row);
				if (item.version !== artifactInteger(row.expected_version, 1)) {
					throw new ArtifactStorageRefusal('version_conflict');
				}
				return item;
			});
			const references: number[] = [];
			for (const item of items) {
				references.push(await refs(tx, item.id, clock()));
			}
			const now = clock();
			if (artifactInteger(confirmation.expires_at, 1) <= now || confirmation.consumed_at !== null) {
				throw new ArtifactStorageRefusal('version_conflict');
			}
			// Validate the complete plan before the first claimed deletion.
			for (let index = 0; index < items.length; index++) {
				const item = items[index];
				requireVersionCapacity(item.version, 2);
				decide(item, references[index], now);
			}
			const consumed = await tx.run(
				'UPDATE agent_artifact_cleanup SET consumed_at=? WHERE id=? AND consumed_at IS NULL',
				[now, id],
			);
			if (consumed.changes !== 1) {
				throw new Error('Lost artifact cleanup CAS');
			}
			const claimed: StoredArtifact[] = [];
			for (const item of items) {
				await tx.run(
					"UPDATE agent_artifacts SET status='deleting',version=version+1 WHERE id=? AND version=?",
					[item.id, item.version],
				);
				claimed.push(await saved(tx, { userId, appId: item.appId }, item.id));
			}
			return claimed;
		});
	}
}
