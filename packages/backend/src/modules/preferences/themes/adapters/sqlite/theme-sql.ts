import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	ThemeStorage,
	StoredTheme,
	ThemeWrite,
	ThemeAuthorization,
	ThemeStorageFacts,
	StoredThemePreset,
	StoredThemeSeedFacts,
	StoredThemeSeedDecision,
} from '../../storage/theme-storage.js';
import { themeRow } from './theme-row.js';

export class SqliteThemeStorage implements ThemeStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Theme identity already installed');
		}
		this.readIdentity = read;
	}

	async list(userId: number): Promise<StoredTheme[]> {
		return (
			await this.db.all(
				'SELECT * FROM preferences_themes WHERE user_id IS NULL OR user_id=? ORDER BY user_id IS NOT NULL,name,id',
				[userId],
			)
		).map(themeRow);
	}

	async get(userId: number, id: number): Promise<StoredTheme | null> {
		const row = await this.db.one(
			'SELECT * FROM preferences_themes WHERE id=? AND (user_id IS NULL OR user_id=?)',
			[id, userId],
		);
		return row === null ? null : themeRow(row);
	}

	private async required(tx: SqlExecutor, id: number): Promise<StoredTheme> {
		const row = await tx.one('SELECT * FROM preferences_themes WHERE id=?', [id]);
		if (!row) {
			throw new Error('Theme missing after write');
		}
		return themeRow(row);
	}

	write(
		command: ThemeWrite,
		authorization: ThemeAuthorization,
		admit: (facts: ThemeStorageFacts) => void,
	): Promise<StoredTheme | null> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('Theme identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			const row =
				command.id === null
					? null
					: await tx.one('SELECT * FROM preferences_themes WHERE id=? AND (user_id IS NULL OR user_id=?)', [
							command.id,
							command.userId,
						]);
			const count = await tx.one('SELECT COUNT(*) AS count FROM preferences_themes WHERE user_id=?', [
				command.userId,
			]);
			if (!count || typeof count.count !== 'number' || !Number.isSafeInteger(count.count) || count.count < 0) {
				throw new Error('Corrupt theme count');
			}
			const taken =
				command.name === null
					? null
					: await tx.one(
							'SELECT id FROM preferences_themes WHERE name=? AND (user_id IS NULL OR user_id=?) AND (? IS NULL OR id<>?)',
							[command.name, command.userId, command.id, command.id],
						);
			admit({ current: row === null ? null : themeRow(row), count: count.count, nameTaken: taken !== null });
			const at = Math.max(Date.now(), row === null ? 0 : themeRow(row).updatedAt);
			if (command.action === 'delete') {
				const references = await tx.all('SELECT version FROM preferences_appearance WHERE active_theme_id=?', [
					command.id,
				]);
				if (
					references.some(
						(row) =>
							typeof row.version !== 'number' ||
							!Number.isSafeInteger(row.version) ||
							row.version >= Number.MAX_SAFE_INTEGER,
					)
				) {
					throw new Error('Appearance version exhausted');
				}
				await tx.run(
					'UPDATE preferences_appearance SET active_theme_id=NULL,version=version+1,updated_at=MAX(updated_at,?) WHERE active_theme_id=?',
					[at, command.id],
				);
				await tx.run('DELETE FROM preferences_themes WHERE id=? AND user_id=? AND version=?', [
					command.id,
					command.userId,
					command.expectedVersion,
				]);
				return null;
			}
			if (command.name === null || command.colors === null) {
				throw new Error('Missing theme write payload');
			}
			const json = JSON.stringify(command.colors);
			if (command.action === 'create') {
				const result = await tx.run(
					'INSERT INTO preferences_themes(user_id,version,name,colors_json,preset_key,created_at,updated_at) VALUES(?,1,?,?,NULL,?,?)',
					[command.userId, command.name, json, at, at],
				);
				return this.required(tx, result.lastId);
			}
			await tx.run(
				'UPDATE preferences_themes SET name=?,colors_json=?,version=version+1,updated_at=? WHERE id=? AND user_id=? AND version=?',
				[command.name, json, at, command.id, command.userId, command.expectedVersion],
			);
			if (command.id === null) {
				throw new Error('Missing theme id');
			}
			return this.required(tx, command.id);
		});
	}

	seed(
		presets: StoredThemePreset[],
		plan: (preset: StoredThemePreset, facts: StoredThemeSeedFacts) => StoredThemeSeedDecision,
	): Promise<void> {
		return this.db.transaction(async (tx) => {
			for (const preset of presets) {
				const current = await tx.one('SELECT * FROM preferences_themes WHERE preset_key=?', [preset.key]);
				const collisions = await tx.all(
					'SELECT * FROM preferences_themes WHERE user_id IS NOT NULL AND name=?',
					[preset.name],
				);
				const conflicts = [];
				for (const row of collisions) {
					const theme = themeRow(row);
					const userId = row.user_id;
					if (theme.version >= Number.MAX_SAFE_INTEGER) {
						throw new Error('Theme version exhausted');
					}
					if (typeof userId !== 'number') {
						throw new Error('Corrupt theme owner');
					}
					const names = (
						await tx.all('SELECT name FROM preferences_themes WHERE user_id=? OR user_id IS NULL', [userId])
					).map((row) => {
						if (typeof row.name !== 'string') {
							throw new Error('Corrupt theme name');
						}
						return row.name;
					});
					conflicts.push({ id: theme.id, userId, version: theme.version, names });
				}
				const decision = plan(preset, { current: current === null ? null : themeRow(current), conflicts });
				const at = Math.max(Date.now(), current === null ? 0 : themeRow(current).updatedAt);
				for (const rename of decision.renames) {
					await tx.run(
						'UPDATE preferences_themes SET name=?,version=version+1,updated_at=MAX(updated_at,?) WHERE id=? AND version=?',
						[rename.name, at, rename.id, rename.version],
					);
				}
				if (current !== null && decision.update && themeRow(current).version >= Number.MAX_SAFE_INTEGER) {
					throw new Error('Theme version exhausted');
				}
				if (current === null) {
					await tx.run(
						'INSERT INTO preferences_themes(user_id,version,name,colors_json,preset_key,created_at,updated_at) VALUES(NULL,1,?,?,?,?,?)',
						[preset.name, JSON.stringify(preset.colors), preset.key, at, at],
					);
				} else if (decision.update) {
					await tx.run(
						'UPDATE preferences_themes SET name=?,colors_json=?,version=version+1,updated_at=? WHERE preset_key=?',
						[preset.name, JSON.stringify(preset.colors), at, preset.key],
					);
				}
			}
		});
	}
}
