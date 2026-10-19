import { initializePreferencesHtmlThemes } from './appearance/adapters/sqlite/html-theme-schema.js';
import { initializePreferencesPresentation } from './presentation/adapters/sqlite/presentation-schema.js';
import { initializePreferencesThemes } from './themes/adapters/sqlite/theme-schema.js';
import { initializePreferencesBackgrounds } from './appearance/adapters/sqlite/background-schema.js';
import { initializePreferencesAppearance } from './appearance/adapters/sqlite/appearance-schema.js';
import { initializePreferencesCommands } from './commands/adapters/sqlite/command-schema.js';
import { initializePreferencesFavorites } from './favorites/adapters/sqlite/favorite-schema.js';
import { initializePreferencesHistory } from './history/adapters/sqlite/history-schema.js';
import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializePreferencesConfiguration } from './configuration/adapters/sqlite/configuration-schema.js';

export async function initializePreferencesSchema(tx: SqlExecutor): Promise<void> {
	await initializePreferencesConfiguration(tx);
	await initializePreferencesHistory(tx);
	await initializePreferencesFavorites(tx);
	await initializePreferencesCommands(tx);
	await initializePreferencesPresentation(tx);
	await initializePreferencesThemes(tx);
	await initializePreferencesAppearance(tx);
	await initializePreferencesBackgrounds(tx);
	await initializePreferencesHtmlThemes(tx);
}
