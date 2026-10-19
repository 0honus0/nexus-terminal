import { TERMINAL_THEME_COLOR_KEYS } from '@nexus-terminal/shared/preferences/themes/values';
import type { SessionTokens } from '../../../../platform/security/session-tokens.js';
import { SqliteFailure } from '../../../../platform/storage/sqlite/sqlite-errors.js';
import { ThemeFailure } from '../../theme-failure.js';
import type { ThemeStorage, StoredTheme, StoredThemeColors } from '../storage/theme-storage.js';
import type {
	ThemeActor,
	ThemeColors,
	ThemeRecord,
	ThemeInput,
	ThemeVersion,
	ThemeMutationFacts,
	ThemePreset,
	ThemeSeedFacts,
	ThemeSeedDecision,
} from './theme-types.js';

function fromColors(colors: StoredThemeColors): ThemeColors {
	const result: ThemeColors = { foreground: colors.foreground, background: colors.background };
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		const value = colors[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

function toColors(colors: ThemeColors): StoredThemeColors {
	const result: StoredThemeColors = { foreground: colors.foreground, background: colors.background };
	for (const key of TERMINAL_THEME_COLOR_KEYS) {
		const value = colors[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

function fromStorage(row: StoredTheme): ThemeRecord {
	return {
		id: row.id,
		version: row.version,
		name: row.name,
		colors: fromColors(row.colors),
		presetKey: row.presetKey,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function boundary<T>(work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (cause) {
		if (cause instanceof ThemeFailure) {
			throw cause;
		}
		if (cause instanceof SqliteFailure) {
			const unknown = cause.kind === 'commit_unknown' || cause.kind === 'rollback_failed';
			throw new ThemeFailure(unknown ? 'operation_unknown' : 'storage_unavailable', { cause });
		}
		throw new ThemeFailure('internal_failure', { cause });
	}
}

export class ThemeModel {
	constructor(
		private readonly storage: ThemeStorage,
		private readonly tokens: SessionTokens,
	) {}

	list(userId: number): Promise<ThemeRecord[]> {
		return boundary(async () => (await this.storage.list(userId)).map(fromStorage));
	}

	get(userId: number, id: number): Promise<ThemeRecord | null> {
		return boundary(async () => {
			const row = await this.storage.get(userId, id);
			return row === null ? null : fromStorage(row);
		});
	}

	async write(
		actor: ThemeActor,
		action: 'create' | 'update' | 'delete',
		version: ThemeVersion | null,
		input: ThemeInput | null,
		admit: (userId: number | null, facts: ThemeMutationFacts) => void,
	): Promise<ThemeRecord | null> {
		const result = await boundary(() => {
			let identity: number | null = null;
			return this.storage.write(
				{
					action,
					userId: actor.userId,
					id: version?.id ?? null,
					expectedVersion: version?.expectedVersion ?? null,
					name: input?.name ?? null,
					colors: input === null ? null : toColors(input.colors),
				},
				{
					sessionDigest: this.tokens.digest(actor.token),

					admit: (userId) => {
						identity = userId;
					},
				},
				(facts) =>
					admit(identity, {
						current: facts.current === null ? null : fromStorage(facts.current),
						nameTaken: facts.nameTaken,
						count: facts.count,
					}),
			);
		});
		try {
			return result === null ? null : fromStorage(result);
		} catch (cause) {
			throw new ThemeFailure('operation_unknown', { cause });
		}
	}

	seed(
		presets: ThemePreset[],
		plan: (preset: ThemePreset, facts: ThemeSeedFacts) => ThemeSeedDecision,
	): Promise<void> {
		return boundary(() =>
			this.storage.seed(
				presets.map((preset) => ({ key: preset.key, name: preset.name, colors: toColors(preset.colors) })),
				(preset, facts) => {
					const decision = plan(
						{ key: preset.key, name: preset.name, colors: fromColors(preset.colors) },
						{
							current: facts.current === null ? null : fromStorage(facts.current),
							conflicts: facts.conflicts.map((row) => ({
								id: row.id,
								userId: row.userId,
								version: row.version,
								names: row.names.map((name) => name),
							})),
						},
					);
					return {
						update: decision.update,
						renames: decision.renames.map((row) => ({ id: row.id, version: row.version, name: row.name })),
					};
				},
			),
		);
	}
}
