import type { HistoryKind } from '@nexus-terminal/shared/preferences/history/values';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import type { HistoryStorage, StoredHistory, HistoryAuthorization } from '../storage/history-storage.js';
import type { HistoryActor, HistoryIdentity, HistoryRecord, HistoryQuery, HistoryInsert } from './history-types.js';
import { HistoryFailure } from '../../history-failure.js';

function fromStorage(value: StoredHistory): HistoryRecord {
	return { id: value.id, text: value.text, recordedAt: value.recordedAt };
}

async function storage<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof HistoryFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			const unknown = cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed';
			throw new HistoryFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
		throw new HistoryFailure('internal_failure', { cause });
	}
}

export class HistoryModel {
	constructor(
		private readonly storage: HistoryStorage,
		private readonly tokens: SessionTokens,
	) {}

	private authorization(actor: HistoryActor, admit: (identity: HistoryIdentity) => void): HistoryAuthorization {
		return {
			sessionDigest: this.tokens.digest(actor.token),

			admit: (userId) => admit({ userId }),
		};
	}

	async list(userId: number, query: HistoryQuery): Promise<HistoryRecord[]> {
		return (await storage(() => this.storage.list(userId, query.kind, query.offset, query.limit))).map(fromStorage);
	}

	async add(
		actor: HistoryActor,
		command: HistoryInsert,
		admit: (identity: HistoryIdentity) => void,
	): Promise<HistoryRecord> {
		const saved = await storage(() =>
			this.storage.add(
				{
					userId: actor.userId,
					kind: command.kind,
					text: command.text,
					recordedAt: command.recordedAt,
					retain: command.retain,
				},
				this.authorization(actor, admit),
			),
		);
		try {
			return fromStorage(saved);
		} catch (cause) {
			throw new HistoryFailure('operation_unknown', { cause });
		}
	}

	delete(
		actor: HistoryActor,
		kind: HistoryKind,
		id: number,
		admit: (identity: HistoryIdentity) => void,
	): Promise<boolean> {
		return storage(() => this.storage.delete(actor.userId, kind, id, this.authorization(actor, admit)));
	}

	clear(actor: HistoryActor, kind: HistoryKind, admit: (identity: HistoryIdentity) => void): Promise<number> {
		return storage(() => this.storage.clear(actor.userId, kind, this.authorization(actor, admit)));
	}
}
