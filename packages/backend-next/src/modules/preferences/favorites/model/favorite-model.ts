import type {
	FavoriteStorage,
	StoredFavorite,
	FavoriteMutation,
	FavoriteAuthorization,
} from '../storage/favorite-storage.js';
import type {
	FavoriteRecord,
	FavoriteActor,
	FavoriteIdentity,
	FavoriteQuery,
	FavoriteCreate,
	FavoriteCreationFacts,
	FavoriteChange,
	FavoriteTouch,
	FavoriteDelete,
} from './favorite-types.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { FavoriteFailure } from '../../favorite-failure.js';

function fromStorage(value: StoredFavorite): FavoriteRecord {
	return {
		id: value.id,
		version: value.version,
		name: value.name,
		path: value.path,
		lastUsedAt: value.lastUsedAt,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof FavoriteFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			const unknown = cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed';
			throw new FavoriteFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
		throw new FavoriteFailure('internal_failure', { cause });
	}
}

function committed(value: StoredFavorite): FavoriteRecord {
	try {
		return fromStorage(value);
	} catch (cause) {
		throw new FavoriteFailure('operation_unknown', { cause });
	}
}

function mutation(value: FavoriteMutation): FavoriteRecord {
	if (value.status === 'not_found') {
		throw new FavoriteFailure('not_found');
	}
	if (value.status === 'version_conflict') {
		throw new FavoriteFailure('version_conflict');
	}
	return committed(value.value);
}

export class FavoriteModel {
	constructor(
		private readonly storage: FavoriteStorage,
		private readonly tokens: SessionTokens,
	) {}

	private authorization(actor: FavoriteActor, admit: (identity: FavoriteIdentity) => void): FavoriteAuthorization {
		return {
			sessionDigest: this.tokens.digest(actor.token),

			admit: (userId) => admit({ userId }),
		};
	}

	async list(userId: number, query: FavoriteQuery): Promise<FavoriteRecord[]> {
		return (await storage(() => this.storage.list(userId, query.sortBy, query.offset, query.limit))).map(
			fromStorage,
		);
	}

	async get(userId: number, id: number): Promise<FavoriteRecord | null> {
		const row = await storage(() => this.storage.get(userId, id));
		return row === null ? null : fromStorage(row);
	}

	async create(
		actor: FavoriteActor,
		command: FavoriteCreate,
		admit: (identity: FavoriteIdentity) => void,
		admitCount: (facts: FavoriteCreationFacts) => void,
	): Promise<FavoriteRecord> {
		const saved = await storage(() =>
			this.storage.create(
				{ userId: actor.userId, input: { name: command.input.name, path: command.input.path }, at: command.at },
				this.authorization(actor, admit),
				(count) => admitCount({ count }),
			),
		);
		return committed(saved);
	}

	async update(
		actor: FavoriteActor,
		command: FavoriteChange,
		admit: (identity: FavoriteIdentity) => void,
	): Promise<FavoriteRecord> {
		return mutation(
			await storage(() =>
				this.storage.update(
					{
						userId: actor.userId,
						id: command.id,
						expectedVersion: command.expectedVersion,
						input: { name: command.input.name, path: command.input.path },
						at: command.at,
					},
					this.authorization(actor, admit),
				),
			),
		);
	}

	async touch(
		actor: FavoriteActor,
		command: FavoriteTouch,
		admit: (identity: FavoriteIdentity) => void,
	): Promise<FavoriteRecord> {
		return mutation(
			await storage(() =>
				this.storage.touch(
					{ userId: actor.userId, id: command.id, expectedVersion: command.expectedVersion, at: command.at },
					this.authorization(actor, admit),
				),
			),
		);
	}

	async delete(
		actor: FavoriteActor,
		command: FavoriteDelete,
		admit: (identity: FavoriteIdentity) => void,
	): Promise<void> {
		const result = await storage(() =>
			this.storage.delete(
				{ userId: actor.userId, id: command.id, expectedVersion: command.expectedVersion },
				this.authorization(actor, admit),
			),
		);
		if (result.status === 'not_found') {
			throw new FavoriteFailure('not_found');
		}
		if (result.status === 'version_conflict') {
			throw new FavoriteFailure('version_conflict');
		}
	}
}
