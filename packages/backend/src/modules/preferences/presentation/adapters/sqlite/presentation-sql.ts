import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	PresentationStorage,
	StoredPresentationView,
	StoredPresentationData,
	PresentationAuthorization,
} from '../../storage/presentation-storage.js';
import { presentationRow } from './presentation-row.js';

export class SqlitePresentationStorage implements PresentationStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Presentation identity already installed');
		}
		this.readIdentity = read;
	}

	async get(userId: number): Promise<StoredPresentationView | null> {
		const row = await this.db.one('SELECT version,value_json FROM preferences_presentation WHERE user_id=?', [
			userId,
		]);
		return row === null ? null : presentationRow(row);
	}

	update(
		userId: number,
		expectedVersion: number,
		value: StoredPresentationData,
		authorization: PresentationAuthorization,
	): Promise<StoredPresentationView | null> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('Presentation identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			const encoded = JSON.stringify(value);
			if (expectedVersion === 0) {
				const existing = await tx.one('SELECT version FROM preferences_presentation WHERE user_id=?', [userId]);
				if (existing) {
					return null;
				}
				await tx.run('INSERT INTO preferences_presentation(user_id,version,value_json) VALUES(?,1,?)', [
					userId,
					encoded,
				]);
			} else {
				const changed = await tx.run(
					'UPDATE preferences_presentation SET version=version+1,value_json=? WHERE user_id=? AND version=?',
					[encoded, userId, expectedVersion],
				);
				if (changed.changes !== 1) {
					return null;
				}
			}
			const row = await tx.one('SELECT version,value_json FROM preferences_presentation WHERE user_id=?', [
				userId,
			]);
			if (!row) {
				throw new Error('Missing presentation after write');
			}
			return presentationRow(row);
		});
	}
}
