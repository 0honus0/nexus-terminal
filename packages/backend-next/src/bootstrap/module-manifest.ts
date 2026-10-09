import { registerTargets } from '../modules/targets/register.js';
import type { SqliteRuntime } from '../platform/storage/sqlite/sqlite-runtime.js';
import type { SecretBox } from '../platform/security/secret-box.js';

/** Future independent lifecycle domains register here, never in Platform. */
export function registerModules(sqlite: SqliteRuntime, secrets: SecretBox | null) {
	const targets = registerTargets({ sqlite, secrets });
	return { targets: targets.publicApi, trustedSshTargets: targets.trustedSshTargets };
}
