import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	HtmlThemeStorage,
	StoredHtmlTheme,
	StoredHtmlThemeListing,
	HtmlThemeWrite,
	HtmlThemeAuthorization,
	StoredHtmlThemeFacts,
} from '../../storage/html-theme-storage.js';
import { htmlThemeRow, htmlThemeListing } from './html-theme-row.js';

export class SqliteHtmlThemeStorage implements HtmlThemeStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('HTML theme identity already installed');
		}
		this.readIdentity = read;
	}

	async list(userId: number): Promise<StoredHtmlThemeListing[]> {
		return (
			await this.db.all(
				'SELECT name,version,updated_at FROM preferences_html_themes WHERE user_id=? ORDER BY name',
				[userId],
			)
		).map(htmlThemeListing);
	}

	async get(userId: number, name: string): Promise<StoredHtmlTheme | null> {
		const row = await this.db.one('SELECT * FROM preferences_html_themes WHERE user_id=? AND name=?', [
			userId,
			name,
		]);
		return row === null ? null : htmlThemeRow(row);
	}

	write(
		command: HtmlThemeWrite,
		authorization: HtmlThemeAuthorization,
		admit: (facts: StoredHtmlThemeFacts) => void,
	): Promise<StoredHtmlTheme | null> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('HTML theme identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			const row = await tx.one('SELECT * FROM preferences_html_themes WHERE user_id=? AND name=?', [
				command.userId,
				command.name,
			]);
			const current = row === null ? null : htmlThemeRow(row);
			const total = await tx.one(
				'SELECT COUNT(*) AS count,MAX(version) AS max_version FROM preferences_html_themes WHERE user_id=?',
				[command.userId],
			);
			if (!total || typeof total.count !== 'number' || !Number.isSafeInteger(total.count) || total.count < 0) {
				throw new Error('Corrupt HTML theme count');
			}
			admit({ current, count: total.count });
			const revision = await tx.one('SELECT version FROM preferences_html_revisions WHERE user_id=?', [
				command.userId,
			]);
			if (
				revision !== null &&
				(typeof revision.version !== 'number' ||
					!Number.isSafeInteger(revision.version) ||
					revision.version < 1 ||
					revision.version >= Number.MAX_SAFE_INTEGER)
			) {
				throw new Error('HTML theme revision exhausted');
			}
			if (
				total.count > 0 &&
				(revision === null ||
					typeof total.max_version !== 'number' ||
					!Number.isSafeInteger(total.max_version) ||
					total.max_version < 1 ||
					Number(revision.version) < total.max_version)
			) {
				throw new Error('HTML theme revision does not cover stored content');
			}
			const version = revision === null ? 1 : Number(revision.version) + 1;
			await tx.run(
				'INSERT INTO preferences_html_revisions(user_id,version) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version',
				[command.userId, version],
			);
			if (command.action === 'delete') {
				const result = await tx.run('DELETE FROM preferences_html_themes WHERE user_id=? AND name=?', [
					command.userId,
					command.name,
				]);
				if (result.changes !== 1) {
					throw new Error('HTML theme delete did not affect one row');
				}
				return null;
			}
			if (command.content === null) {
				throw new Error('Missing HTML theme content');
			}
			const at = Math.max(Date.now(), current?.updatedAt ?? 0);
			if (command.action === 'create') {
				await tx.run(
					'INSERT INTO preferences_html_themes(user_id,name,content,version,updated_at) VALUES(?,?,?,?,?)',
					[command.userId, command.name, command.content, version, at],
				);
			} else {
				if (!current || current.version >= Number.MAX_SAFE_INTEGER) {
					throw new Error('HTML theme version exhausted');
				}
				const result = await tx.run(
					'UPDATE preferences_html_themes SET content=?,version=?,updated_at=? WHERE user_id=? AND name=? AND version=?',
					[command.content, version, at, command.userId, command.name, current.version],
				);
				if (result.changes !== 1) {
					throw new Error('HTML theme update did not affect one row');
				}
			}
			const saved = await tx.one('SELECT * FROM preferences_html_themes WHERE user_id=? AND name=?', [
				command.userId,
				command.name,
			]);
			if (!saved) {
				throw new Error('HTML theme write missing');
			}
			return htmlThemeRow(saved);
		});
	}
}
