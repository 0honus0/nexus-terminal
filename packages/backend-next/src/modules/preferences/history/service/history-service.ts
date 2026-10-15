import { drainPreferences } from '../../preferences-lifecycle.js';
import {
	HISTORY_TEXT_MAX_BYTES,
	HISTORY_PAGE_MAX_ENTRIES,
	type HistoryKind,
} from '@nexus-terminal/shared/preferences/history/values';
import type { HistoryModel } from '../model/history-model.js';
import type {
	HistoryActor,
	HistoryIdentity,
	HistoryPage,
	HistoryQuery,
	HistoryAdd,
	HistoryRecord,
} from '../model/history-types.js';
import { HistoryFailure } from '../../history-failure.js';

const RETENTION: Record<HistoryKind, number> = { command: 10000, path: 2000 };

function admit(actor: HistoryActor, identity: HistoryIdentity): void {
	if (identity.userId === null) {
		throw new HistoryFailure('unauthenticated');
	}
	if (identity.userId !== actor.userId) {
		throw new HistoryFailure('forbidden');
	}
}

export class HistoryService {
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();
	private closePromise: Promise<void> | null = null;

	constructor(private readonly model: HistoryModel) {}

	private run<T>(actor: HistoryActor, work: () => Promise<T>): Promise<T> {
		if (!this.accepting || this.pending.size >= 16) {
			return Promise.reject(new HistoryFailure('unavailable'));
		}
		if (!Number.isSafeInteger(actor.userId) || actor.userId < 1 || !actor.token) {
			return Promise.reject(new HistoryFailure('unauthenticated'));
		}
		const task = Promise.resolve().then(work);
		this.pending.add(task);
		void task.finally(() => this.pending.delete(task)).catch(() => undefined);
		return task;
	}

	list(actor: HistoryActor, query: HistoryQuery): Promise<HistoryPage> {
		return this.run(actor, async () => {
			if (
				!Number.isSafeInteger(query.offset) ||
				query.offset < 0 ||
				query.offset > RETENTION[query.kind] ||
				!Number.isSafeInteger(query.limit) ||
				query.limit < 1 ||
				query.limit > HISTORY_PAGE_MAX_ENTRIES
			) {
				throw new HistoryFailure('invalid_input');
			}
			const rows = await this.model.list(actor.userId, {
				kind: query.kind,
				offset: query.offset,
				limit: query.limit + 1,
			});
			return {
				entries: rows.slice(0, query.limit),
				nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
			};
		});
	}

	add(actor: HistoryActor, command: HistoryAdd): Promise<HistoryRecord> {
		return this.run(actor, () => {
			const text = command.text;
			if (
				!text.trim() ||
				text.includes('\0') ||
				Buffer.byteLength(text, 'utf8') > HISTORY_TEXT_MAX_BYTES ||
				Buffer.from(text, 'utf8').toString('utf8') !== text
			) {
				throw new HistoryFailure('invalid_input');
			}
			return this.model.add(
				actor,
				{
					kind: command.kind,
					text,
					recordedAt: Math.floor(Date.now() / 1000),
					retain: RETENTION[command.kind],
				},
				(identity) => admit(actor, identity),
			);
		});
	}

	delete(actor: HistoryActor, kind: HistoryKind, id: number): Promise<void> {
		return this.run(actor, async () => {
			if (!Number.isSafeInteger(id) || id < 1) {
				throw new HistoryFailure('invalid_input');
			}
			if (!(await this.model.delete(actor, kind, id, (identity) => admit(actor, identity)))) {
				throw new HistoryFailure('not_found');
			}
		});
	}

	clear(actor: HistoryActor, kind: HistoryKind): Promise<number> {
		return this.run(actor, () => this.model.clear(actor, kind, (identity) => admit(actor, identity)));
	}

	quiesce(): void {
		this.accepting = false;
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.quiesce();
			this.closePromise = drainPreferences([...this.pending]);
		}
		return this.closePromise;
	}
}
