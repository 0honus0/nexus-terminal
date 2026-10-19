import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type {
	AppearanceStorage,
	AppearanceAuthorization,
	StoredAppearance,
	StoredAppearanceFacts,
	StoredAppearanceWrite,
} from '../../storage/appearance-storage.js';
import { appearanceRow } from './appearance-row.js';

export class SqliteAppearanceStorage implements AppearanceStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Appearance identity already installed');
		}
		this.readIdentity = read;
	}

	access(
		userId: number,
		requestedThemeId: number | null,
		defaultPresetKey: string,
		authorization: AppearanceAuthorization,
		decide: (facts: StoredAppearanceFacts) => StoredAppearanceWrite | null,
	): Promise<StoredAppearance> {
		const read = this.readIdentity;
		if (!read) {
			return Promise.reject(new Error('Appearance identity not installed'));
		}
		return this.db.transaction(async (tx) => {
			authorization.admit(await read(tx, authorization.sessionDigest));
			const row = await tx.one('SELECT * FROM preferences_appearance WHERE user_id=?', [userId]);
			const current = row === null ? null : appearanceRow(row);
			const selected =
				requestedThemeId === null
					? null
					: await tx.one('SELECT id FROM preferences_themes WHERE id=? AND (user_id IS NULL OR user_id=?)', [
							requestedThemeId,
							userId,
						]);
			const preset = await tx.one('SELECT id FROM preferences_themes WHERE preset_key=?', [defaultPresetKey]);
			if (
				preset !== null &&
				(typeof preset.id !== 'number' || !Number.isSafeInteger(preset.id) || preset.id < 1)
			) {
				throw new Error('Corrupt default theme');
			}
			const defaultThemeId = preset === null ? null : Number(preset.id);
			const next = decide({ current, selectedThemeExists: selected !== null, defaultThemeId });
			if (next === null) {
				if (current === null) {
					throw new Error('Appearance initialization missing');
				}
				return current;
			}
			const at = Math.max(Date.now(), current?.updatedAt ?? 0);
			if (current === null) {
				await tx.run(
					'INSERT INTO preferences_appearance(user_id,version,active_theme_id,settings_json,updated_at) VALUES(?,1,?,?,?)',
					[userId, next.activeThemeId, JSON.stringify(next.settings), at],
				);
			} else {
				if (current.version >= Number.MAX_SAFE_INTEGER) {
					throw new Error('Appearance version exhausted');
				}
				await tx.run(
					'UPDATE preferences_appearance SET version=version+1,active_theme_id=?,settings_json=?,updated_at=? WHERE user_id=? AND version=?',
					[next.activeThemeId, JSON.stringify(next.settings), at, userId, current.version],
				);
			}
			const saved = await tx.one('SELECT * FROM preferences_appearance WHERE user_id=?', [userId]);
			if (saved === null) {
				throw new Error('Appearance write missing');
			}
			return appearanceRow(saved);
		});
	}
}
