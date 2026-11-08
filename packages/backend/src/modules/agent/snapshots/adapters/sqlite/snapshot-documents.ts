import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { decodeProviderRow } from '../../../providers/adapters/sqlite/provider-row.js';
import { threadRow } from '../../../scope/adapters/sqlite/thread-row.js';
import { memoryRow } from '../../../memory/adapters/sqlite/memory-row.js';
import { executionDocument, executionLimits } from '../../../execution/adapters/sqlite/execution-row.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { decodeRun, decodeEvent } from '../../../runs/adapters/sqlite/run-row.js';
import { readRunSelection } from '../../../runs/adapters/sqlite/run-selection.js';
import { readRepositorySettings } from '../../../plugins/adapters/sqlite/plugin-repository-sql.js';
import { readPluginIntentReceipt } from '../../../plugins/adapters/sqlite/plugin-intent-sql.js';
import { readToolJob } from '../../../tools/adapters/sqlite/tool-job-sql.js';

/** Reuse the actual persistent document owners; backup does not invent a permissive parallel schema. */
export function validateAgentSnapshotDocuments(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const readers = new Map<string, (row: SqlRow) => unknown>([
		['agent_providers', decodeProviderRow],
		['agent_threads', threadRow],
		['agent_memories', memoryRow],
		['agent_execution_settings', (row) => executionDocument(row.settings_json)],
		['agent_run_execution_settings', (row) => executionDocument(row.settings_json)],
		['agent_runs', decodeRun],
		['agent_run_events', decodeEvent],
		['agent_plugin_intents', readPluginIntentReceipt],
		['agent_tool_jobs', readToolJob],
		[
			'agent_hard_limit_confirmations',
			(row) => {
				if (typeof row.proposed_json !== 'string') {
					throw new SnapshotFailure('unavailable');
				}
				return executionLimits(JSON.parse(row.proposed_json));
			},
		],
		['agent_plugin_repositories', readRepositorySettings],
	]);
	for (const [table, read] of readers) {
		for (const row of rows.get(table) ?? []) {
			read(row);
		}
	}
	for (const row of rows.get('agent_runs') ?? []) {
		readRunSelection(row.selected_connections_json);
	}
	const runs = new Map((rows.get('agent_runs') ?? []).map((row) => [row.id, row]));
	const children = new Map((rows.get('agent_run_children') ?? []).map((row) => [row.run_id, row]));
	for (const child of children.values()) {
		const run = runs.get(child.run_id);
		const parent = runs.get(child.parent_id);
		if (!run || !parent || run.approval_mode !== parent.approval_mode) {
			throw new SnapshotFailure('unavailable');
		}
	}
}
