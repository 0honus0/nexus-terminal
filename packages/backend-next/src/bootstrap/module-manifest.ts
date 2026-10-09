import { registerTargets } from '../modules/targets/register.js';
import type { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';

/** Future independent lifecycle domains register here, never in Platform. */
export function registerModules(sqlite: SqliteRuntime) {
	return { targets: registerTargets({ sqlite }).publicApi };
}
