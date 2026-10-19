import type { SnapshotRegistration, SnapshotTable } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import type { SecretBox } from '../../../../../platform/security/secret-box.js';
import {
	transferSnapshotRow,
	restoreSnapshotRow,
	snapshotFile,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { artifactRow } from '../../../artifacts/adapters/sqlite/artifact-row.js';
import { stageRow, publisherRow } from '../../../plugins/adapters/sqlite/plugin-row.js';
import { pluginInstallationRow } from '../../../plugins/adapters/sqlite/plugin-installation-row.js';
import { pluginManifest } from '../../../plugins/adapters/package/plugin-manifest.js';
import type { DecodedPluginPackage } from '../../../plugins/storage/plugin-package.js';
import { NativePluginPackageDecoder } from '../../../plugins/adapters/package/plugin-package-decoder.js';
import { NativePackageReader } from '../../../../../platform/packages/adapters/native-package-reader.js';
import { NativePackageSignature } from '../../../../../platform/packages/adapters/native-package-signature.js';
import { validateAgentSnapshotDocuments } from './snapshot-documents.js';
import { readApp } from '../../../scope/adapters/sqlite/app-row.js';
import { currentPolicy } from '../../../governance/adapters/sqlite/governance-sql.js';
import { currentDenylist } from '../../../governance/adapters/sqlite/denylist-sql.js';
import { executionSettings } from '../../../execution/adapters/sqlite/execution-sql.js';
import { frozenExecution } from '../../../execution/adapters/sqlite/execution-budget-sql.js';
import { participant } from '../../../runs/adapters/sqlite/run-participant-sql.js';
import { frozenFromRun } from '../../../runs/adapters/sqlite/run-sql.js';
import { validateRunStepRecovery } from '../../../runs/adapters/sqlite/run-step-sql.js';
import { readBrowserConfiguration } from '../../../integrations/adapters/sqlite/browser-sql.js';
import type { StoredDefinition } from '../../../scope/storage/scope-storage.js';
import { validateSnapshotDeclarations } from './snapshot-declarations.js';
import { validateSnapshotHistory } from './snapshot-history.js';

function secretColumns(table: string, row: SqlRow): ReadonlyMap<string, string> {
	if (table !== 'agent_providers' && table !== 'agent_integrations') {
		return new Map();
	}
	if (
		typeof row.user_id !== 'number' ||
		!Number.isSafeInteger(row.user_id) ||
		row.user_id < 1 ||
		typeof row.id !== 'string'
	) {
		throw new SnapshotFailure('invalid_archive');
	}
	if (table === 'agent_providers') {
		return new Map([['protected_credential', 'agent-provider:' + row.user_id + ':' + row.id]]);
	}
	if (typeof row.app_id !== 'string') {
		throw new SnapshotFailure('invalid_archive');
	}
	return new Map([['encrypted_credential', 'integration:' + row.user_id + ':' + row.app_id + ':' + row.id]]);
}

/** Fixed current table/column coverage owned by agent; no runtime schema discovery. */
export function registerAgentSnapshot(
	secrets: SecretBox | null,
	definitions: readonly StoredDefinition[],
	admitPackage: (value: DecodedPluginPackage) => void,
): SnapshotRegistration {
	const packages = new NativePluginPackageDecoder(new NativePackageReader(), new NativePackageSignature());
	const tables: SnapshotTable[] = [
		{
			name: 'agent_artifacts',
			columns: [
				'id',
				'user_id',
				'app_id',
				'name',
				'media_type',
				'kind',
				'size_bytes',
				'sha256',
				'status',
				'retained',
				'version',
				'created_at',
				'ready_at',
				'expires_at',
				'deleted_at',
				'upload_claimed',
			],
		},
		{
			name: 'agent_artifact_attachments',
			columns: ['artifact_id', 'user_id', 'target_app_id', 'thread_id', 'run_id', 'created_at'],
		},
		{
			name: 'agent_artifact_grants',
			columns: [
				'receipt_id',
				'artifact_id',
				'user_id',
				'receiver_app_id',
				'artifact_version',
				'expires_at',
				'revoked_at',
			],
		},
		{ name: 'agent_artifact_cleanup', columns: ['id', 'user_id', 'expires_at', 'consumed_at'] },
		{ name: 'agent_artifact_cleanup_items', columns: ['confirmation_id', 'artifact_id', 'version'] },
		{
			name: 'agent_context_checkpoints',
			columns: [
				'id',
				'run_id',
				'step_index',
				'tool_id',
				'source_hash',
				'source_messages',
				'summary_text',
				'created_at',
			],
		},
		{ name: 'agent_model_contexts', columns: ['run_id', 'step_index', 'content_json', 'content_hash'] },
		{ name: 'agent_execution_settings', columns: ['user_id', 'version', 'settings_json'] },
		{
			name: 'agent_hard_limit_confirmations',
			columns: ['id', 'user_id', 'expected_version', 'proposed_json', 'expires_at', 'consumed_at'],
		},
		{ name: 'agent_run_execution_settings', columns: ['run_id', 'settings_json'] },
		{ name: 'agent_run_budget_reservations', columns: ['run_id', 'step_index', 'root_id', 'tokens'] },
		{ name: 'agent_target_denylist_meta', columns: ['id', 'revision'] },
		{
			name: 'agent_target_denylist',
			columns: ['connection_id', 'connection_version', 'reason', 'changed_by', 'changed_at'],
		},
		{
			name: 'agent_governance_policies',
			columns: ['user_id', 'app_id', 'policy_revision', 'execution_version', 'execution_overrides_json'],
		},
		{
			name: 'agent_governance_grants',
			columns: ['user_id', 'app_id', 'capability', 'schema_version', 'scope_json', 'granted_at'],
		},
		{
			name: 'agent_governance_approvals',
			columns: [
				'id',
				'user_id',
				'app_id',
				'run_id',
				'tool_call_id',
				'operation_hash',
				'kind',
				'status',
				'policy_revision',
				'input_revision',
				'version',
				'requested_at',
				'expires_at',
				'decided_at',
				'decided_by_user_id',
				'consumed_at',
				'feedback',
				'inspection_json',
				'capability',
				'target_version',
			],
		},
		{
			name: 'agent_governance_resolution_keys',
			columns: [
				'user_id',
				'app_id',
				'operation_key',
				'request_hash',
				'approval_id',
				'result_status',
				'result_version',
				'result_json',
			],
		},
		{ name: 'agent_browser_configuration', columns: ['user_id', 'version', 'targets_json'] },
		{
			name: 'agent_integrations',
			columns: [
				'id',
				'user_id',
				'app_id',
				'configuration_json',
				'enabled',
				'encrypted_credential',
				'credential_revision',
				'schema_hash',
				'version',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_integration_intents',
			columns: ['user_id', 'app_id', 'operation_key', 'intent_hash', 'integration_id', 'result_json'],
		},
		{
			name: 'agent_memories',
			columns: [
				'id',
				'user_id',
				'app_id',
				'content',
				'confidence',
				'status',
				'source_run_id',
				'expires_at',
				'review_action',
				'reviewed_at',
				'version',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_memory_imports',
			columns: [
				'id',
				'user_id',
				'app_id',
				'memory_id',
				'source_app_id',
				'source_memory_id',
				'source_version',
				'expires_at',
				'consumed_at',
			],
		},
		{
			name: 'agent_plugin_intents',
			columns: [
				'id',
				'user_id',
				'sender_app_id',
				'receiver_app_id',
				'sender_version',
				'receiver_version',
				'sender_revision',
				'receiver_revision',
				'intent_id',
				'schema_version',
				'input_json',
				'artifact_ids_json',
				'created_at',
				'expires_at',
				'revoked_at',
			],
		},
		{ name: 'agent_plugin_repositories', columns: ['user_id', 'version', 'repositories_json', 'updated_at'] },
		{
			name: 'agent_plugin_publishers',
			columns: ['user_id', 'key_id', 'public_key_pem', 'label', 'version', 'created_at', 'revoked_at'],
		},
		{
			name: 'agent_plugin_stages',
			columns: [
				'id',
				'user_id',
				'package_hash',
				'size_bytes',
				'status',
				'version',
				'publisher_key_id',
				'manifest_json',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_plugin_versions',
			columns: ['definition_id', 'version', 'package_hash', 'publisher_key_id', 'stage_id', 'manifest_json'],
		},
		{
			name: 'agent_plugin_installations',
			columns: [
				'user_id',
				'app_id',
				'definition_id',
				'version',
				'package_hash',
				'publisher_key_id',
				'status',
				'revision',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_plugin_retirements',
			columns: ['user_id', 'app_id', 'stage_id', 'stage_version', 'created_at', 'base_revision'],
		},
		{
			name: 'agent_plugin_runtime_instances',
			columns: [
				'user_id',
				'app_id',
				'instance_id',
				'revision',
				'state',
				'updated_at',
				'unknown_at',
				'acknowledged_at',
			],
		},
		{
			name: 'agent_plugin_runtime_history',
			columns: [
				'user_id',
				'app_id',
				'instance_id',
				'revision',
				'state',
				'updated_at',
				'unknown_at',
				'acknowledged_at',
			],
		},
		{ name: 'agent_plugin_data', columns: ['user_id', 'app_id', 'key', 'version', 'value_json', 'updated_at'] },
		{
			name: 'agent_plugin_data_operations',
			columns: [
				'user_id',
				'app_id',
				'operation_id',
				'content_hash',
				'key',
				'version',
				'value_json',
				'updated_at',
				'retired',
			],
		},
		{
			name: 'agent_plugin_data_purges',
			columns: [
				'user_id',
				'app_id',
				'operation_id',
				'expected_revision',
				'result_revision',
				'deleted_keys',
				'updated_at',
			],
		},
		{
			name: 'agent_plugin_data_migrations',
			columns: [
				'user_id',
				'app_id',
				'operation_id',
				'request_hash',
				'result_revision',
				'changed_keys',
				'updated_at',
			],
		},
		{
			name: 'agent_providers',
			columns: [
				'id',
				'user_id',
				'display_name',
				'base_url',
				'protocol',
				'models_json',
				'observations_json',
				'protected_credential',
				'credential_revision',
				'enabled',
				'version',
				'deleted_at',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_run_frozen_inputs',
			columns: [
				'run_id',
				'provider_id',
				'provider_version',
				'credential_revision',
				'model_id',
				'base_url',
				'protocol',
				'capabilities_json',
				'execution_policy',
			],
		},
		{
			name: 'agent_run_children',
			columns: [
				'run_id',
				'parent_id',
				'operation_id',
				'request_hash',
				'profile',
				'output_text',
				'tools_json',
				'max_requests',
				'dependencies_json',
				'dependency_mode',
			],
		},
		{ name: 'agent_run_facts', columns: ['root_id', 'fact_key', 'value_text', 'version', 'author_id'] },
		{
			name: 'agent_run_mailbox',
			columns: ['root_id', 'recipient_id', 'sequence', 'message_id', 'sender_id', 'body_text', 'expires_at'],
		},
		{ name: 'agent_run_mailbox_cursors', columns: ['run_id', 'consumed_through', 'read_through'] },
		{ name: 'agent_collaboration_effects', columns: ['operation_id', 'result_json'] },
		{
			name: 'agent_runs',
			columns: [
				'id',
				'user_id',
				'app_id',
				'thread_id',
				'thread_sequence',
				'run_kind',
				'status',
				'version',
				'input_text',
				'deadline_at',
				'selected_connections_json',
				'created_at',
				'updated_at',
			],
		},
		{ name: 'agent_run_events', columns: ['run_id', 'sequence', 'event_type', 'run_version', 'created_at'] },
		{
			name: 'agent_command_idempotency',
			columns: [
				'user_id',
				'app_id',
				'command_name',
				'operation_key',
				'request_hash',
				'run_id',
				'result_status',
				'result_outcome',
				'result_version',
				'result_created_at',
				'result_updated_at',
			],
		},
		{
			name: 'agent_run_model_steps',
			columns: [
				'run_id',
				'step_index',
				'state',
				'revision',
				'expected_run_version',
				'request_hash',
				'creation_hash',
				'text_bytes',
				'input_tokens',
				'output_tokens',
				'finish_reason',
				'proposals_json',
				'failure_code',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_run_model_step_events',
			columns: [
				'run_id',
				'step_index',
				'sequence',
				'kind',
				'text_delta',
				'input_tokens',
				'output_tokens',
				'created_at',
			],
		},
		{
			name: 'agent_run_tools',
			columns: [
				'id',
				'user_id',
				'app_id',
				'run_id',
				'model_step_index',
				'provider_call_id',
				'tool_name',
				'tool_version',
				'capability',
				'target_id',
				'target_version',
				'risk',
				'mutation',
				'summary',
				'arguments_json',
				'operation_hash',
				'operation_revision',
				'revision',
				'state',
				'result_text',
				'created_at',
				'updated_at',
			],
		},
		{ name: 'agent_acp_permissions', columns: ['tool_id', 'parent_id', 'parent_hash', 'request_key'] },
		{
			name: 'agent_run_tool_events',
			columns: ['tool_call_id', 'revision', 'operation_revision', 'state', 'operation_hash', 'created_at'],
		},
		{
			name: 'agent_app_definitions',
			columns: ['id', 'version', 'display_name', 'content_hash', 'installed', 'default_enabled', 'source_kind'],
		},
		{ name: 'agent_app_declared_capabilities', columns: ['definition_id', 'definition_version', 'capability'] },
		{
			name: 'agent_apps',
			columns: [
				'id',
				'user_id',
				'name',
				'definition_id',
				'definition_version',
				'enabled',
				'version',
				'updated_at',
				'is_default',
				'created_at',
			],
		},
		{ name: 'agent_threads', columns: ['id', 'user_id', 'app_id', 'title', 'version', 'created_at', 'updated_at'] },
		{
			name: 'agent_thread_commands',
			columns: [
				'user_id',
				'app_id',
				'operation_id',
				'request_hash',
				'thread_id',
				'result_title',
				'result_version',
				'result_created_at',
				'result_updated_at',
			],
		},
		{
			name: 'agent_tool_jobs',
			columns: [
				'id',
				'user_id',
				'app_id',
				'run_id',
				'connection_id',
				'target_version',
				'fingerprint',
				'policy_revision',
				'state',
				'revision',
				'result_text',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_run_projects',
			columns: ['run_id', 'connection_id', 'directory', 'target_version', 'fingerprint'],
		},
		{ name: 'agent_project_effects', columns: ['operation_id'] },
	];
	for (const table of tables) {
		if (table.columns.includes('user_id')) {
			table.partitionColumn = 'user_id';
		}
	}
	return {
		tables,
		excludedTables: ['agent_model_capability_registry'],

		async validateStorage(reader, rows, signal) {
			await validateRunStepRecovery(reader);
			await currentDenylist(reader);
			for (const row of rows.get('agent_apps') ?? []) {
				signal.throwIfAborted();
				const app = await readApp(reader, row);
				if (!(await currentPolicy(reader, app.userId, app.id))) {
					throw new SnapshotFailure('unavailable');
				}
			}
			for (const row of rows.get('agent_execution_settings') ?? []) {
				signal.throwIfAborted();
				if (typeof row.user_id !== 'number' || !(await executionSettings(reader, row.user_id))) {
					throw new SnapshotFailure('unavailable');
				}
			}
			for (const row of rows.get('agent_browser_configuration') ?? []) {
				signal.throwIfAborted();
				if (typeof row.user_id !== 'number') {
					throw new SnapshotFailure('unavailable');
				}
				await readBrowserConfiguration(reader, row.user_id);
			}
			for (const row of rows.get('agent_runs') ?? []) {
				signal.throwIfAborted();
				if (typeof row.id !== 'string' || typeof row.app_id !== 'string' || typeof row.user_id !== 'number') {
					throw new SnapshotFailure('unavailable');
				}
				if (
					!(await participant(reader, { runId: row.id, appId: row.app_id, userId: row.user_id })) ||
					!(await frozenFromRun(reader, row.user_id, row.app_id, row.id))
				) {
					throw new SnapshotFailure('unavailable');
				}
				await frozenExecution(reader, row.id);
			}
		},

		validate(rows) {
			validateAgentSnapshotDocuments(rows);
			validateSnapshotHistory(rows);
			validateSnapshotDeclarations(rows, definitions);
			for (const row of rows.get('agent_artifacts') ?? []) {
				artifactRow(row);
				if (row.status === 'staging' || row.status === 'deleting') {
					throw new SnapshotFailure('source_changed');
				}
			}
			const stages = rows.get('agent_plugin_stages') ?? [];
			const stageIndex = new Map(stages.map((stage) => [stage.id, stage]));
			for (const row of stages) {
				stageRow(row);
				if (row.status === 'staging') {
					throw new SnapshotFailure('source_changed');
				}
			}
			for (const row of rows.get('agent_plugin_publishers') ?? []) {
				publisherRow(row);
			}
			for (const row of rows.get('agent_plugin_versions') ?? []) {
				const stage = stageIndex.get(row.stage_id);
				if (
					!stage ||
					stage.status !== 'installed' ||
					stage.package_hash !== row.package_hash ||
					stage.publisher_key_id !== row.publisher_key_id ||
					typeof row.manifest_json !== 'string'
				) {
					throw new SnapshotFailure('unavailable');
				}
				const manifest = pluginManifest(JSON.parse(row.manifest_json));
				if (
					manifest.id !== row.definition_id ||
					manifest.version !== row.version ||
					JSON.stringify(manifest) !== JSON.stringify(stageRow(stage).manifest)
				) {
					throw new SnapshotFailure('unavailable');
				}
			}
			const versions = rows.get('agent_plugin_versions') ?? [];
			const versionIndex = new Map(
				versions.map((version) => [JSON.stringify([version.definition_id, version.version]), version]),
			);
			for (const row of rows.get('agent_plugin_installations') ?? []) {
				pluginInstallationRow(row);
				const version = versionIndex.get(JSON.stringify([row.definition_id, row.version]));
				if (
					!version ||
					version.package_hash !== row.package_hash ||
					version.publisher_key_id !== row.publisher_key_id
				) {
					throw new SnapshotFailure('unavailable');
				}
			}
		},

		async validateFile(ref, bytes, rows) {
			if (ref.root !== 'plugins') {
				return;
			}
			const raw = (rows.get('agent_plugin_stages') ?? []).find((stage) => stage.id === ref.key);
			if (!raw) {
				throw new SnapshotFailure('unavailable');
			}
			const stage = stageRow(raw);
			const publishers = rows.get('agent_plugin_publishers') ?? [];
			const decoded = await packages.decode(bytes, (id) => {
				const publisher = publishers.find(
					(publisher) => publisher.key_id === id && publisher.user_id === raw.user_id,
				);
				return publisher ? publisherRow(publisher).publicKeyPem : null;
			});
			if (
				stage.status !== 'staged' &&
				(!decoded.signatureValid ||
					decoded.publisherKeyId !== stage.publisherKeyId ||
					JSON.stringify(decoded.manifest) !== JSON.stringify(stage.manifest))
			) {
				throw new SnapshotFailure('unavailable');
			}
			if (stage.status !== 'staged') {
				admitPackage(decoded);
			}
		},

		transfer(table, row) {
			return transferSnapshotRow(row, table.columns, secretColumns(table.name, row), secrets);
		},

		restore(table, row) {
			return restoreSnapshotRow(row, table.columns, secretColumns(table.name, row), secrets);
		},

		files(table, row) {
			if (table === 'agent_artifacts' && row.status === 'ready') {
				return [snapshotFile('artifacts', row, 'sha256')];
			}
			if (
				table === 'agent_plugin_stages' &&
				(row.status === 'staged' || row.status === 'verified' || row.status === 'installed')
			) {
				return [snapshotFile('plugins', row, 'package_hash')];
			}
			return [];
		},
	};
}
