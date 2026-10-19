import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { HistoryKind } from '@nexus-terminal/shared/preferences/history/values';
import type {
	HistoryStorage,
	HistoryAuthorization,
	HistoryInsertCommand,
	StoredHistory,
} from '../../storage/history-storage.js';
import { historyRow } from './history-row.js';

export class SqliteHistoryStorage implements HistoryStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('History identity already installed');
		}
		this.readIdentity = read;
	}

	private write<T>(authorization: HistoryAuthorization, work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('History identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			return work(tx);
		});
	}

	async list(userId: number, kind: HistoryKind, offset: number, limit: number): Promise<StoredHistory[]> {
		return (
			await this.db.all(
				'SELECT id,text,recorded_at FROM preferences_history WHERE user_id=? AND kind=? ORDER BY recorded_at ASC,id ASC LIMIT ? OFFSET ?',
				[userId, kind, limit, offset],
			)
		).map(historyRow);
	}

	add(command: HistoryInsertCommand, authorization: HistoryAuthorization): Promise<StoredHistory> {
		const { userId, kind, text, retain } = command;
		return this.write(authorization, async (tx) => {
			const latest = await tx.one(
				'SELECT MAX(recorded_at) AS at FROM preferences_history WHERE user_id=? AND kind=?',
				[userId, kind],
			);
			if (
				!latest ||
				(latest.at !== null &&
					(typeof latest.at !== 'number' || !Number.isSafeInteger(latest.at) || latest.at < 0))
			) {
				throw new Error('Corrupt history time');
			}
			const recordedAt = Math.max(Math.floor(Date.now() / 1000), latest.at ?? 0);
			await tx.run(
				`INSERT INTO preferences_history(user_id,kind,text,recorded_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id,kind,text) DO UPDATE SET recorded_at=excluded.recorded_at`,
				[userId, kind, text, recordedAt],
			);
			const saved = historyRow(
				await tx.one(
					'SELECT id,text,recorded_at FROM preferences_history WHERE user_id=? AND kind=? AND text=?',
					[userId, kind, text],
				),
			);
			await tx.run(
				`DELETE FROM preferences_history WHERE user_id=? AND kind=? AND id IN (
    SELECT id FROM preferences_history WHERE user_id=? AND kind=?
    ORDER BY recorded_at DESC,(id=?) DESC,id DESC LIMIT -1 OFFSET ?)`,
				[userId, kind, userId, kind, saved.id, retain],
			);
			return saved;
		});
	}

	delete(userId: number, kind: HistoryKind, id: number, authorization: HistoryAuthorization): Promise<boolean> {
		return this.write(
			authorization,
			async (tx) =>
				(
					await tx.run('DELETE FROM preferences_history WHERE user_id=? AND kind=? AND id=?', [
						userId,
						kind,
						id,
					])
				).changes === 1,
		);
	}

	clear(userId: number, kind: HistoryKind, authorization: HistoryAuthorization): Promise<number> {
		return this.write(
			authorization,
			async (tx) =>
				(await tx.run('DELETE FROM preferences_history WHERE user_id=? AND kind=?', [userId, kind])).changes,
		);
	}
}
