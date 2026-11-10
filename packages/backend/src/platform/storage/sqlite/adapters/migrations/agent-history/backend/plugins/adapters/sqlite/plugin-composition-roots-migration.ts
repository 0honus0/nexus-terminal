// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Record future explicit choices without guessing selections from retired closures. */
export async function initializePluginCompositionRoots(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_plugin_app_packages
	 ADD COLUMN selected_root INTEGER NOT NULL DEFAULT 0 CHECK(selected_root IN (0,1));
	 UPDATE agent_plugin_app_packages SET selected_root=1 WHERE kind='app';`);
}
