import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { collectToolOutputArtifacts, readToolOutputArtifactIds } from './run-tool-output-sql.js';

function artifactId(value: unknown): string {
	if (typeof value !== 'string' || !AGENT_ID_PATTERN.test(value)) {
		throw new Error('Corrupt legacy tool Artifact');
	}
	return value;
}

/** Decode only the original trusted Host result shapes once, preserving confirmed partial outputs. */
export async function persistToolOutputArtifacts(tx: SqlExecutor): Promise<void> {
	await tx.exec("ALTER TABLE agent_run_tools ADD COLUMN output_artifact_ids_json TEXT NOT NULL DEFAULT '[]'");
	const rows = await tx.all(
		"SELECT id,tool_name,state,result_text FROM agent_run_tools WHERE tool_name IN ('image_generate','artifact_create','file_deliver','artifact_present') AND state IN ('completed','unknown') AND result_text IS NOT NULL",
		[],
	);
	for (const row of rows) {
		if (typeof row.result_text !== 'string' || typeof row.id !== 'string') {
			throw new Error('Corrupt legacy tool result');
		}
		let result: unknown;
		try {
			result = JSON.parse(row.result_text);
		} catch {
			if (row.state === 'unknown') {
				continue;
			}
			throw new Error('Corrupt legacy tool result');
		}
		if (result === null || typeof result !== 'object' || Array.isArray(result)) {
			if (row.state === 'unknown') {
				continue;
			}
			throw new Error('Corrupt legacy tool result');
		}
		const ids: string[] = [];
		if (row.tool_name === 'image_generate' || row.tool_name === 'artifact_create') {
			if (row.state === 'completed' && 'id' in result) {
				ids.push(artifactId(result.id));
			}
		} else if ('items' in result && Array.isArray(result.items)) {
			for (const item of result.items) {
				if (item === null || typeof item !== 'object' || !('status' in item)) {
					throw new Error('Corrupt legacy tool item');
				}
				if (item.status !== 'completed') {
					continue;
				}
				if (
					!('value' in item) ||
					item.value === null ||
					typeof item.value !== 'object' ||
					!('id' in item.value)
				) {
					throw new Error('Corrupt legacy tool output');
				}
				ids.push(artifactId(item.value.id));
			}
		} else if (row.state !== 'unknown') {
			throw new Error('Corrupt legacy tool items');
		}
		await tx.run('UPDATE agent_run_tools SET output_artifact_ids_json=? WHERE id=?', [
			JSON.stringify([...new Set(ids)]),
			row.id,
		]);
	}
	const parents = await tx.all(
		"SELECT DISTINCT t.id,t.output_artifact_ids_json FROM agent_run_tools t JOIN agent_tool_children c ON c.parent_id=t.id WHERE t.state NOT IN ('inspected','dispatched')",
		[],
	);
	for (const parent of parents) {
		if (typeof parent.id !== 'string') {
			throw new Error('Corrupt legacy tool parent');
		}
		const ids = await collectToolOutputArtifacts(
			tx,
			parent.id,
			readToolOutputArtifactIds(parent.output_artifact_ids_json),
		);
		await tx.run('UPDATE agent_run_tools SET output_artifact_ids_json=? WHERE id=?', [
			JSON.stringify(ids),
			parent.id,
		]);
	}
}
