// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

export async function migrateToolOutputBatches(tx: SqlExecutor): Promise<void> {
	await tx.run(
		`UPDATE agent_run_tools SET result_text=json_object('items',json_array(json_object('index',0,'status','completed','value',json(result_text)))) WHERE tool_name IN ('file_deliver','artifact_present') AND state='completed'`,
	);
}
