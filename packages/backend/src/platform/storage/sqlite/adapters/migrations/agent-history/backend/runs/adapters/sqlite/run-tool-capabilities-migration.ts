// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function persistToolRequiredCapabilities(tx: SqlExecutor): Promise<void> {
	await tx.exec(`ALTER TABLE agent_run_tools ADD COLUMN required_capabilities_json TEXT NOT NULL DEFAULT '[]';
	 UPDATE agent_run_tools SET required_capabilities_json='["artifacts.write"]' WHERE tool_name='file_deliver';`);
}
