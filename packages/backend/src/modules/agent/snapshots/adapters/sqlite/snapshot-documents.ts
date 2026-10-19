import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { decodeProviderRow } from '../../../providers/adapters/sqlite/provider-row.js';
import { integrationRow, integrationReceipt } from '../../../integrations/adapters/sqlite/integration-row.js';
import { threadRow } from '../../../scope/adapters/sqlite/thread-row.js';
import { memoryRow, memoryImportRow } from '../../../memory/adapters/sqlite/memory-row.js';
import { readContextSnapshot } from '../../../context/adapters/sqlite/context-row.js';
import { executionDocument, executionLimits } from '../../../execution/adapters/sqlite/execution-row.js';
import { readApproval } from '../../../governance/adapters/sqlite/governance-row.js';
import { readToolOperation, readToolEvent } from '../../../runs/adapters/sqlite/run-tool-row.js';
import { pluginRuntimeRow } from '../../../plugins/adapters/sqlite/plugin-runtime-row.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { decodeRun, decodeEvent } from '../../../runs/adapters/sqlite/run-sql.js';
import { decodeStep, readStepEvent } from '../../../runs/adapters/sqlite/run-step-sql.js';
import { readRunSelection } from '../../../runs/adapters/sqlite/run-selection.js';
import { pluginDataRow } from '../../../plugins/adapters/sqlite/plugin-data-sql.js';
import { readRepositorySettings } from '../../../plugins/adapters/sqlite/plugin-repository-sql.js';
import { readPluginIntentReceipt } from '../../../plugins/adapters/sqlite/plugin-intent-sql.js';
import { readToolJob } from '../../../tools/adapters/sqlite/tool-job-sql.js';

/** Reuse the actual persistent document owners; backup does not invent a permissive parallel schema. */
export function validateAgentSnapshotDocuments(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const readers = new Map<string, (row: SqlRow) => unknown>([
		['agent_providers', decodeProviderRow],
		['agent_integrations', integrationRow],
		['agent_integration_intents', integrationReceipt],
		['agent_threads', threadRow],
		['agent_memories', memoryRow],
		['agent_memory_imports', memoryImportRow],
		['agent_model_contexts', readContextSnapshot],
		['agent_governance_approvals', readApproval],
		['agent_run_tools', readToolOperation],
		['agent_plugin_runtime_instances', pluginRuntimeRow],
		['agent_plugin_runtime_history', pluginRuntimeRow],
		['agent_execution_settings', (row) => executionDocument(row.settings_json)],
		['agent_run_execution_settings', (row) => executionDocument(row.settings_json)],
		['agent_runs', decodeRun],
		['agent_run_events', decodeEvent],
		['agent_run_model_steps', decodeStep],
		['agent_run_model_step_events', readStepEvent],
		['agent_plugin_data', pluginDataRow],
		['agent_plugin_data_operations', pluginDataRow],
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
	const tools = new Map((rows.get('agent_run_tools') ?? []).map((row) => [row.id, row]));
	for (const row of rows.get('agent_run_tool_events') ?? []) {
		const tool = tools.get(row.tool_call_id);
		if (!tool) {
			throw new SnapshotFailure('unavailable');
		}
		// Normal storage reads join the parent Run identity; reconstruct that same decoder input.
		readToolEvent({
			tool_call_id: row.tool_call_id,
			run_id: tool.run_id,
			revision: row.revision,
			operation_revision: row.operation_revision,
			state: row.state,
			operation_hash: row.operation_hash,
			created_at: row.created_at,
		});
	}
}
