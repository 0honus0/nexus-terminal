import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

/** V2 converts existing results once; runtime readers accept only the batch representation. */
export async function migrateToolJobBatchResults(tx: SqlExecutor): Promise<void> {
	await tx.run(`UPDATE agent_tool_jobs SET result_text = json_object(
		'status', json_extract(result_text, '$.status'),
		'commands', json_array(json_object(
			'index', 0,
			'status', json_extract(result_text, '$.status'),
			'exitCode', json_extract(result_text, '$.exitCode'),
			'signal', json_extract(result_text, '$.signal'),
			'stdout', json_extract(result_text, '$.stdout'),
			'stderr', json_extract(result_text, '$.stderr'),
			'truncated', json(CASE WHEN json_extract(result_text, '$.truncated') = 1 THEN 'true' ELSE 'false' END)
		))
	) WHERE result_text IS NOT NULL AND json_extract(result_text, '$.status') IN ('completed', 'nonzero')`);
}
