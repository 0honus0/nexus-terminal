import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import { readThreadEntries, readPreviousThreadEntries } from './thread-entry-sql.js';
import type {
	ContextStorage,
	StoredThreadEntries,
	StoredThreadEntryCursor,
	StoredThreadEntryHistory,
} from '../../storage/context-storage.js';

export class SqliteContextStorage implements ContextStorage {
	constructor(private readonly db: SqliteRuntime) {}

	readPreviousEntries(
		userId: number,
		appId: string,
		threadId: string,
		before: StoredThreadEntryCursor | null,
		limit: number,
	): Promise<StoredThreadEntryHistory | null> {
		return this.db.transaction((tx) => readPreviousThreadEntries(tx, userId, appId, threadId, before, limit));
	}

	readEntries(
		userId: number,
		appId: string,
		threadId: string,
		after: StoredThreadEntryCursor,
		limit: number,
	): Promise<StoredThreadEntries | null> {
		return this.db.transaction((tx) => readThreadEntries(tx, userId, appId, threadId, after, limit));
	}
}
