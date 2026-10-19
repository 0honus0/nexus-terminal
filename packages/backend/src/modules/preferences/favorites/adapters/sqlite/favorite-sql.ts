import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { FavoritePathSort } from '@nexus-terminal/shared/preferences/favorites/values';
import type {
	FavoriteStorage,
	StoredFavorite,
	FavoriteAuthorization,
	FavoriteCreateCommand,
	FavoriteUpdateCommand,
	FavoriteTouchCommand,
	FavoriteVersionCommand,
	FavoriteMutation,
	FavoriteDeletion,
} from '../../storage/favorite-storage.js';
import { favoriteRow } from './favorite-row.js';

export class SqliteFavoriteStorage implements FavoriteStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Favorite identity already installed');
		}
		this.readIdentity = read;
	}

	private write<T>(authorization: FavoriteAuthorization, work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('Favorite identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			return work(tx);
		});
	}

	async list(userId: number, sortBy: FavoritePathSort, offset: number, limit: number): Promise<StoredFavorite[]> {
		const order = sortBy === 'lastUsedAt' ? 'last_used_at DESC,name ASC,id ASC' : 'name ASC,id ASC';
		return (
			await this.db.all(
				`SELECT * FROM preferences_favorites WHERE user_id=? ORDER BY ${order} LIMIT ? OFFSET ?`,
				[userId, limit, offset],
			)
		).map(favoriteRow);
	}

	async get(userId: number, id: number): Promise<StoredFavorite | null> {
		const row = await this.db.one('SELECT * FROM preferences_favorites WHERE user_id=? AND id=?', [userId, id]);
		return row === null ? null : favoriteRow(row);
	}

	create(
		command: FavoriteCreateCommand,
		authorization: FavoriteAuthorization,
		admitCount: (count: number) => void,
	): Promise<StoredFavorite> {
		return this.write(authorization, async (tx) => {
			const count = await tx.one('SELECT COUNT(*) AS count FROM preferences_favorites WHERE user_id=?', [
				command.userId,
			]);
			if (!count || typeof count.count !== 'number' || !Number.isSafeInteger(count.count) || count.count < 0) {
				throw new Error('Corrupt favorite count');
			}
			admitCount(count.count);
			const at = Math.floor(Date.now() / 1000);
			const inserted = await tx.run(
				'INSERT INTO preferences_favorites(user_id,version,name,path,created_at,updated_at) VALUES(?,1,?,?,?,?)',
				[command.userId, command.input.name, command.input.path, at, at],
			);
			return this.readRequired(tx, command.userId, inserted.lastId);
		});
	}

	private async readRequired(tx: SqlExecutor, userId: number, id: number): Promise<StoredFavorite> {
		const row = await tx.one('SELECT * FROM preferences_favorites WHERE user_id=? AND id=?', [userId, id]);
		if (!row) {
			throw new Error('Missing favorite after write');
		}
		return favoriteRow(row);
	}

	private async current(
		tx: SqlExecutor,
		command: FavoriteVersionCommand,
	): Promise<StoredFavorite | 'not_found' | 'version_conflict'> {
		const row = await tx.one('SELECT * FROM preferences_favorites WHERE user_id=? AND id=?', [
			command.userId,
			command.id,
		]);
		if (!row) {
			return 'not_found';
		}
		const value = favoriteRow(row);
		return value.version === command.expectedVersion ? value : 'version_conflict';
	}

	update(command: FavoriteUpdateCommand, authorization: FavoriteAuthorization): Promise<FavoriteMutation> {
		return this.write(authorization, async (tx) => {
			const current = await this.current(tx, {
				userId: command.userId,
				id: command.id,
				expectedVersion: command.expectedVersion,
			});
			if (typeof current === 'string') {
				return { status: current };
			}
			const at = Math.max(Math.floor(Date.now() / 1000), current.updatedAt);
			await tx.run(
				'UPDATE preferences_favorites SET version=version+1,name=?,path=?,updated_at=? WHERE user_id=? AND id=?',
				[command.input.name, command.input.path, at, command.userId, command.id],
			);
			return { status: 'updated', value: await this.readRequired(tx, command.userId, command.id) };
		});
	}

	touch(command: FavoriteTouchCommand, authorization: FavoriteAuthorization): Promise<FavoriteMutation> {
		return this.write(authorization, async (tx) => {
			const current = await this.current(tx, {
				userId: command.userId,
				id: command.id,
				expectedVersion: command.expectedVersion,
			});
			if (typeof current === 'string') {
				return { status: current };
			}
			const at = Math.max(Math.floor(Date.now() / 1000), current.updatedAt);
			await tx.run(
				'UPDATE preferences_favorites SET version=version+1,last_used_at=?,updated_at=? WHERE user_id=? AND id=?',
				[at, at, command.userId, command.id],
			);
			return { status: 'updated', value: await this.readRequired(tx, command.userId, command.id) };
		});
	}

	delete(command: FavoriteVersionCommand, authorization: FavoriteAuthorization): Promise<FavoriteDeletion> {
		return this.write(authorization, async (tx) => {
			const current = await this.current(tx, command);
			if (typeof current === 'string') {
				return { status: current };
			}
			await tx.run('DELETE FROM preferences_favorites WHERE user_id=? AND id=?', [command.userId, command.id]);
			return { status: 'deleted' };
		});
	}
}
