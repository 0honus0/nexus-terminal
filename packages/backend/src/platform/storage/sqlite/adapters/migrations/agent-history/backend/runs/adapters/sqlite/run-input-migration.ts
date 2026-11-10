// Frozen published database migration dependency. Not an application API.
import type { SqlExecutor } from '../../../../../../../sql-types.js';

/** Retain history without treating a retired scheduling implementation as a resumable App. */
export async function initializeRunInputs(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE agent_run_inputs (
	 run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
	 app_execution_json TEXT NOT NULL CHECK(json_valid(app_execution_json)),
	 input_json TEXT NOT NULL CHECK(json_valid(input_json)),
	 output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json))
	) STRICT;
	INSERT INTO agent_run_inputs(run_id,app_execution_json,input_json,output_json)
	 SELECT id,json_object('kind','retired'),json_object('message',input_text),NULL FROM agent_runs;`);
}
