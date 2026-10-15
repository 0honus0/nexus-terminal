import { FetchFailure } from '../../../../platform/network/bounded-fetch.js';
import type { HtmlThemeCatalog } from '../storage/html-theme-catalog.js';
import type { HtmlThemeRepository, HtmlThemeDirectoryEntry } from './html-theme-types.js';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { HtmlThemeFailure, HtmlThemeResourceFailure } from '../../html-theme-failure.js';
import type { HtmlThemeStorage, StoredHtmlTheme } from '../storage/html-theme-storage.js';
import type {
	HtmlThemeActor,
	HtmlThemeRecord,
	HtmlThemeListing,
	HtmlThemeInput,
	HtmlThemeWriteFacts,
} from './html-theme-types.js';

function fromStorage(row: StoredHtmlTheme): HtmlThemeRecord {
	return { name: row.name, kind: 'custom', version: row.version, content: row.content, updatedAt: row.updatedAt };
}

async function boundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof HtmlThemeFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			throw new HtmlThemeFailure(
				cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed'
					? 'operation_unknown'
					: 'storage_unavailable',
				{ cause },
			);
		}
		if (cause instanceof FetchFailure) {
			if (cause.kind === 'cleanup_failed') {
				throw new HtmlThemeResourceFailure({ cause });
			}
			throw new HtmlThemeFailure(cause.kind === 'limit_exceeded' ? 'limit_exceeded' : 'source_unavailable', {
				cause,
			});
		}
		throw new HtmlThemeFailure('internal_failure', { cause });
	}
}

export class HtmlThemeModel {
	constructor(
		private readonly storage: HtmlThemeStorage,
		private readonly tokens: SessionTokens,
		private readonly catalog: HtmlThemeCatalog,
	) {}

	listRemote(repository: HtmlThemeRepository, signal: AbortSignal): Promise<HtmlThemeDirectoryEntry[]> {
		return boundary(async () =>
			(
				await this.catalog.list(
					{
						owner: repository.owner,
						repository: repository.repository,
						ref: repository.ref,
						path: repository.path,
					},
					signal,
				)
			).map((row) => ({ name: row.name, regularFile: row.regularFile, url: row.url })),
		);
	}

	readRemote(url: string, signal: AbortSignal): Promise<string> {
		return boundary(() => this.catalog.read(url, signal));
	}

	list(userId: number): Promise<HtmlThemeListing[]> {
		return boundary(async () =>
			(await this.storage.list(userId)).map((row) => ({
				name: row.name,
				kind: 'custom',
				version: row.version,
				updatedAt: row.updatedAt,
			})),
		);
	}

	get(userId: number, name: string): Promise<HtmlThemeRecord | null> {
		return boundary(async () => {
			const row = await this.storage.get(userId, name);
			return row === null ? null : fromStorage(row);
		});
	}

	async write(
		actor: HtmlThemeActor,
		action: 'create' | 'update' | 'delete',
		name: string,
		input: HtmlThemeInput | null,
		admit: (userId: number | null, facts: HtmlThemeWriteFacts) => void,
	): Promise<HtmlThemeRecord | null> {
		let identity: number | null = null;
		const row = await boundary(() =>
			this.storage.write(
				{ action, userId: actor.userId, name, content: input?.content ?? null },
				{
					sessionDigest: this.tokens.digest(actor.token),

					admit: (userId) => {
						identity = userId;
					},
				},
				(facts) =>
					admit(identity, {
						current: facts.current === null ? null : fromStorage(facts.current),
						count: facts.count,
					}),
			),
		);
		try {
			return row === null ? null : fromStorage(row);
		} catch (cause) {
			throw new HtmlThemeFailure('operation_unknown', { cause });
		}
	}
}
