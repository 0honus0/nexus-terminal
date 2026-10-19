import { PreferencesTasks } from '../../preferences-lifecycle.js';
import {
	FAVORITE_NAME_MAX_BYTES,
	FAVORITE_PATH_MAX_BYTES,
	FAVORITE_PAGE_MAX_ENTRIES,
} from '@nexus-terminal/shared/preferences/favorites/values';
import type { FavoriteModel } from '../model/favorite-model.js';
import type {
	FavoriteActor,
	FavoriteIdentity,
	FavoriteRecord,
	FavoritePage,
	FavoriteQuery,
	FavoriteInput,
	FavoriteUpdate,
} from '../model/favorite-types.js';
import { FavoriteFailure } from '../../favorite-failure.js';

const MAX_FAVORITES = 2000;

function admit(actor: FavoriteActor, identity: FavoriteIdentity): void {
	if (identity.userId === null) {
		throw new FavoriteFailure('unauthenticated');
	}
	if (identity.userId !== actor.userId) {
		throw new FavoriteFailure('forbidden');
	}
}

function validateId(id: number): void {
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new FavoriteFailure('invalid_input');
	}
}

function validateVersion(version: number): void {
	if (!Number.isSafeInteger(version) || version < 1 || version >= Number.MAX_SAFE_INTEGER) {
		throw new FavoriteFailure('invalid_input');
	}
}

function validateInput(input: FavoriteInput): void {
	const validText = (value: string, max: number) =>
		!value.includes('\0') &&
		Buffer.byteLength(value, 'utf8') <= max &&
		Buffer.from(value, 'utf8').toString('utf8') === value;

	if (
		!input.path.trim() ||
		!validText(input.path, FAVORITE_PATH_MAX_BYTES) ||
		(input.name !== null && !validText(input.name, FAVORITE_NAME_MAX_BYTES))
	) {
		throw new FavoriteFailure('invalid_input');
	}
}

export class FavoriteService {
	private accepting = true;
	private readonly tasks = new PreferencesTasks();
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: FavoriteModel) {}

	private run<T>(actor: FavoriteActor, work: () => Promise<T>): Promise<T> {
		if (!this.accepting || this.tasks.size >= 16) {
			return Promise.reject(new FavoriteFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new FavoriteFailure('unauthenticated'));
		}
		return this.tasks.run(work);
	}

	list(actor: FavoriteActor, query: FavoriteQuery): Promise<FavoritePage> {
		return this.run(actor, async () => {
			if (
				!Number.isSafeInteger(query.offset) ||
				query.offset < 0 ||
				query.offset > MAX_FAVORITES ||
				!Number.isSafeInteger(query.limit) ||
				query.limit < 1 ||
				query.limit > FAVORITE_PAGE_MAX_ENTRIES
			) {
				throw new FavoriteFailure('invalid_input');
			}
			const rows = await this.model.list(actor.userId, {
				sortBy: query.sortBy,
				offset: query.offset,
				limit: query.limit + 1,
			});
			return {
				entries: rows.slice(0, query.limit),
				nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
			};
		});
	}

	get(actor: FavoriteActor, id: number): Promise<FavoriteRecord> {
		return this.run(actor, async () => {
			validateId(id);
			const row = await this.model.get(actor.userId, id);
			if (!row) {
				throw new FavoriteFailure('not_found');
			}
			return row;
		});
	}

	create(actor: FavoriteActor, input: FavoriteInput): Promise<FavoriteRecord> {
		return this.run(actor, () => {
			validateInput(input);
			return this.model.create(
				actor,
				input,
				(identity) => admit(actor, identity),
				(facts) => {
					if (facts.count >= MAX_FAVORITES) {
						throw new FavoriteFailure('limit_exceeded');
					}
				},
			);
		});
	}

	update(actor: FavoriteActor, command: FavoriteUpdate): Promise<FavoriteRecord> {
		return this.run(actor, () => {
			validateId(command.id);
			validateVersion(command.expectedVersion);
			validateInput(command.input);
			return this.model.update(actor, command, (identity) => admit(actor, identity));
		});
	}

	touch(actor: FavoriteActor, id: number, version: number): Promise<FavoriteRecord> {
		return this.run(actor, () => {
			validateId(id);
			validateVersion(version);
			return this.model.touch(actor, { id, expectedVersion: version }, (identity) => admit(actor, identity));
		});
	}

	delete(actor: FavoriteActor, id: number, version: number): Promise<void> {
		return this.run(actor, () => {
			validateId(id);
			validateVersion(version);
			return this.model.delete(actor, { id, expectedVersion: version }, (identity) => admit(actor, identity));
		});
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = this.tasks.drain();
		}
		return this.closePromise;
	}
}
