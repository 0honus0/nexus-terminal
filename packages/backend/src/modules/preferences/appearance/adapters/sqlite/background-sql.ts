import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { BackgroundKind } from '@nexus-terminal/shared/preferences/appearance/values';
import type { BackgroundStorage, StoredBackground, StoredBackgroundFacts } from '../../storage/background-storage.js';
import type { AppearanceAuthorization, StoredAppearance } from '../../storage/appearance-storage.js';
import { backgroundRow } from './background-row.js';
import { appearanceRow } from './appearance-row.js';

export class SqliteBackgroundStorage implements BackgroundStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Background identity already installed');
		}
		this.readIdentity = read;
	}

	private async facts(
		tx: SqlExecutor,
		userId: number,
		authorization: AppearanceAuthorization,
	): Promise<StoredBackgroundFacts> {
		const read = this.readIdentity;
		if (!read) {
			throw new Error('Background identity not installed');
		}
		authorization.admit(await read(tx, authorization.sessionDigest));
		const row = await tx.one('SELECT * FROM preferences_appearance WHERE user_id=?', [userId]);
		const count = await tx.one('SELECT COUNT(*) AS count FROM preferences_backgrounds');
		if (
			count === null ||
			typeof count.count !== 'number' ||
			!Number.isSafeInteger(count.count) ||
			count.count < 0
		) {
			throw new Error('Corrupt background count');
		}
		return { appearance: row === null ? null : appearanceRow(row), totalCount: count.count };
	}

	stage(
		record: StoredBackground,
		authorization: AppearanceAuthorization,
		admit: (facts: StoredBackgroundFacts) => void,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			admit(await this.facts(tx, record.userId, authorization));
			await tx.run(
				"INSERT INTO preferences_backgrounds(id,user_id,kind,media_type,size_bytes,sha256,status) VALUES(?,?,?,?,?,?,'pending')",
				[record.id, record.userId, record.kind, record.mediaType, record.sizeBytes, record.sha256],
			);
		});
	}

	private async replace(
		tx: SqlExecutor,
		userId: number,
		kind: BackgroundKind,
		newId: string | null,
		current: StoredAppearance,
	): Promise<StoredAppearance> {
		if (current.version >= Number.MAX_SAFE_INTEGER) {
			throw new Error('Appearance version exhausted');
		}
		const field = kind === 'page' ? 'pageBackgroundId' : 'terminalBackgroundId';
		const oldId = current.settings[field];
		if (oldId !== null) {
			const old = await tx.one('SELECT * FROM preferences_backgrounds WHERE id=? AND user_id=? AND kind=?', [
				oldId,
				userId,
				kind,
			]);
			if (old === null || old.status !== 'ready') {
				throw new Error('Active background missing');
			}
			backgroundRow(old);
			await tx.run("UPDATE preferences_backgrounds SET status='retired' WHERE id=? AND status='ready'", [oldId]);
		}
		await tx.run(
			'UPDATE preferences_appearance SET settings_json=json_set(settings_json,?,?),version=version+1,updated_at=MAX(updated_at,?) WHERE user_id=? AND version=?',
			['$.' + field, newId, Date.now(), userId, current.version],
		);
		const saved = await tx.one('SELECT * FROM preferences_appearance WHERE user_id=?', [userId]);
		if (saved === null) {
			throw new Error('Appearance missing after background write');
		}
		return appearanceRow(saved);
	}

	activate(
		id: string,
		userId: number,
		expectedVersion: number,
		authorization: AppearanceAuthorization,
		admit: (facts: StoredBackgroundFacts) => void,
	): Promise<StoredAppearance> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, userId, authorization);
			admit(facts);
			if (facts.appearance === null || facts.appearance.version !== expectedVersion) {
				throw new Error('Background admission incomplete');
			}
			const row = await tx.one('SELECT * FROM preferences_backgrounds WHERE id=? AND user_id=?', [id, userId]);
			if (row === null || row.status !== 'pending') {
				throw new Error('Background stage missing');
			}
			const item = backgroundRow(row);
			const saved = await this.replace(tx, userId, item.kind, id, facts.appearance);
			await tx.run("UPDATE preferences_backgrounds SET status='ready' WHERE id=? AND status='pending'", [id]);
			return saved;
		});
	}

	clear(
		kind: BackgroundKind,
		userId: number,
		authorization: AppearanceAuthorization,
		admit: (facts: StoredBackgroundFacts) => void,
	): Promise<StoredAppearance> {
		return this.db.transaction(async (tx) => {
			const facts = await this.facts(tx, userId, authorization);
			admit(facts);
			if (facts.appearance === null) {
				throw new Error('Appearance admission incomplete');
			}
			return this.replace(tx, userId, kind, null, facts.appearance);
		});
	}

	get(userId: number, id: string): Promise<StoredBackground | null> {
		return this.db.transaction(async (tx) => {
			const row = await tx.one(
				"SELECT * FROM preferences_backgrounds WHERE id=? AND user_id=? AND status='ready'",
				[id, userId],
			);
			if (row === null) {
				return null;
			}
			const item = backgroundRow(row);
			const appearance = await tx.one('SELECT * FROM preferences_appearance WHERE user_id=?', [userId]);
			if (appearance === null) {
				throw new Error('Background appearance missing');
			}
			const current = appearanceRow(appearance);
			const reference =
				item.kind === 'page' ? current.settings.pageBackgroundId : current.settings.terminalBackgroundId;
			if (reference !== id) {
				throw new Error('Background reference mismatch');
			}
			return item;
		});
	}

	cleanupCandidates(limit: number): Promise<string[]> {
		return this.db.transaction(async (tx) => {
			if (!Number.isSafeInteger(limit) || limit < 1) {
				throw new Error('Invalid background cleanup limit');
			}
			const rows = await tx.all(
				"SELECT * FROM preferences_backgrounds WHERE status IN('pending','retired') ORDER BY id LIMIT ?",
				[limit],
			);
			const ids: string[] = [];
			for (const row of rows) {
				const item = backgroundRow(row);
				const reference = await tx.one(
					"SELECT user_id FROM preferences_appearance WHERE json_extract(settings_json,'$.pageBackgroundId')=? OR json_extract(settings_json,'$.terminalBackgroundId')=?",
					[item.id, item.id],
				);
				if (reference !== null) {
					throw new Error('Inactive background still referenced');
				}
				ids.push(item.id);
			}
			return ids;
		});
	}

	async finishCleanup(id: string): Promise<void> {
		await this.db.run("DELETE FROM preferences_backgrounds WHERE id=? AND status IN('pending','retired')", [id]);
	}
}
