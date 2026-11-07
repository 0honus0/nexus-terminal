import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

export function readToolOutputArtifactIds(value: unknown): string[] {
	if (typeof value !== 'string') {
		throw new Error('Corrupt tool Artifact references');
	}
	const values: unknown = JSON.parse(value);
	if (!Array.isArray(values) || values.some((id) => typeof id !== 'string' || !AGENT_ID_PATTERN.test(id))) {
		throw new Error('Corrupt tool Artifact references');
	}
	const ids = values.map((id) => {
		if (typeof id !== 'string') {
			throw new Error('Corrupt tool Artifact reference');
		}
		return id;
	});
	if (new Set(ids).size !== ids.length) {
		throw new Error('Duplicate tool Artifact references');
	}
	return ids;
}

/** Persist confirmed Host output even when a later aggregate outcome is unknown. */
export async function collectToolOutputArtifacts(
	tx: SqlExecutor,
	parentId: string,
	outputArtifactIds: string[],
): Promise<string[]> {
	const ids = new Set(readToolOutputArtifactIds(JSON.stringify(outputArtifactIds)));
	const rows = await tx.all(
		`WITH RECURSIVE descendants(id) AS (
		 SELECT tool_id FROM agent_tool_children WHERE parent_id=?
		 UNION SELECT c.tool_id FROM agent_tool_children c JOIN descendants d ON c.parent_id=d.id
		) SELECT output_artifact_ids_json FROM agent_run_tools WHERE id IN (SELECT id FROM descendants)
		 ORDER BY created_at,id`,
		[parentId],
	);
	for (const row of rows) {
		for (const id of readToolOutputArtifactIds(row.output_artifact_ids_json)) {
			ids.add(id);
		}
	}
	return [...ids];
}
