import { validateSnapshotPluginVersions } from './snapshot-plugin-versions.js';
import { validateSnapshotPluginComposition } from './snapshot-plugin-composition.js';
import { validateSnapshotPluginData } from './snapshot-plugin-data.js';
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

import { frozenFromRun } from '../../../runs/adapters/sqlite/run-sql.js';
import { readBrowserConfiguration } from '../../../integrations/adapters/sqlite/browser-sql.js';
import { validateSnapshotDeclarations } from './snapshot-declarations.js';
import { validateSnapshotHistory } from './snapshot-history.js';
import { validateSnapshotRunExecution } from './snapshot-run-execution.js';
import { validateSnapshotOperations } from './snapshot-operations.js';

function secretColumns(table: string, row: SqlRow): ReadonlyMap<string, string> {
	if (table === 'agent_plugin_connections') {
		if (
			typeof row.user_id !== 'number' ||
			!Number.isSafeInteger(row.user_id) ||
			row.user_id < 1 ||
			typeof row.app_id !== 'string' ||
			typeof row.instance_id !== 'string'
		) {
			throw new SnapshotFailure('invalid_archive');
		}
		return new Map([
			['encrypted_credential', 'plugin-connection:' + row.user_id + ':' + row.app_id + ':' + row.instance_id],
		]);
	}
	if (table !== 'agent_providers') {
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
	return new Map([['protected_credential', 'agent-provider:' + row.user_id + ':' + row.id]]);
}

/** Fixed current table/column coverage owned by agent; no runtime schema discovery. */
export function registerAgentSnapshot(
	secrets: SecretBox | null,
	admitPackage: (value: DecodedPluginPackage) => void,
): SnapshotRegistration {
	const packageReader = new NativePackageReader();
	const packageSignature = new NativePackageSignature();
	const packages = new NativePluginPackageDecoder(packageReader, packageSignature);
	const tables: SnapshotTable[] = [
		{ name: 'agent_artifact_blob_removals', columns: ['id'] },
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
		{ name: 'agent_execution_settings', columns: ['user_id', 'version', 'settings_json'] },
		{
			name: 'agent_hard_limit_confirmations',
			columns: ['id', 'user_id', 'expected_version', 'proposed_json', 'expires_at', 'consumed_at'],
		},
		{ name: 'agent_run_execution_settings', columns: ['run_id', 'settings_json'] },
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
		{ name: 'agent_browser_configuration', columns: ['user_id', 'version', 'targets_json'] },
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
			columns: [
				'user_id',
				'definition_id',
				'version',
				'package_hash',
				'publisher_key_id',
				'stage_id',
				'manifest_json',
			],
		},
		{
			name: 'agent_plugin_packages',
			columns: [
				'user_id',
				'package_id',
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
			name: 'agent_plugin_package_updates',
			columns: ['user_id', 'package_id', 'stage_id', 'stage_version', 'created_at', 'data_migrated'],
		},
		{ name: 'agent_plugin_app_bindings', columns: ['user_id', 'app_id', 'execution_revision', 'ui_revision'] },
		{
			name: 'agent_plugin_app_packages',
			columns: [
				'user_id',
				'app_id',
				'package_id',
				'kind',
				'version',
				'package_hash',
				'publisher_key_id',
				'selected_root',
			],
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
				'package_id',
				'logical_instance_id',
				'instance_id',
				'generation',
				'revision',
				'configuration_revision',
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
				'package_id',
				'logical_instance_id',
				'generation',
				'configuration_revision',
			],
		},
		{
			name: 'agent_plugin_extension_data',
			columns: ['user_id', 'app_id', 'package_id', 'key', 'version', 'value_json', 'updated_at'],
		},
		{
			name: 'agent_plugin_extension_operations',
			columns: [
				'user_id',
				'app_id',
				'package_id',
				'operation_id',
				'content_hash',
				'key',
				'version',
				'value_json',
				'updated_at',
				'retired',
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
				'approval_mode',
				'version',
				'input_text',
				'deadline_at',
				'selected_connections_json',
				'created_at',
				'updated_at',
				'status',
			],
		},
		{ name: 'agent_run_events', columns: ['run_id', 'sequence', 'run_version', 'created_at', 'event_type'] },
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
			name: 'agent_app_definitions',
			columns: ['id', 'version', 'display_name', 'content_hash'],
		},
		{
			name: 'agent_app_definition_packages',
			columns: [
				'user_id',
				'definition_id',
				'definition_version',
				'package_id',
				'kind',
				'version',
				'package_hash',
				'publisher_key_id',
			],
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
				'created_at',
			],
		},
		{
			name: 'agent_threads',
			columns: ['id', 'user_id', 'app_id', 'title', 'title_origin', 'version', 'created_at', 'updated_at'],
		},
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
		{ name: 'agent_run_inputs', columns: ['run_id', 'app_execution_json', 'input_json', 'output_json'] },
		{ name: 'agent_run_executions', columns: ['run_id', 'generation', 'state', 'created_at', 'updated_at'] },
		{
			name: 'agent_operations',
			columns: [
				'id',
				'user_id',
				'app_id',
				'run_id',
				'execution_generation',
				'parent_id',
				'caller_id',
				'operation_key',
				'request_hash',
				'kind',
				'label',
				'binding_json',
				'arguments_json',
				'state',
				'revision',
				'result_json',
				'failure_code',
				'created_at',
				'updated_at',
				'sequence',
			],
		},
		{
			name: 'agent_operation_diagnostics',
			columns: ['operation_id', 'code'],
		},
		{
			name: 'agent_operation_model_reservations',
			columns: ['operation_id', 'root_id', 'provider_id', 'reserved_tokens', 'input_tokens', 'output_tokens'],
		},
		{
			name: 'agent_operation_approvals',
			columns: [
				'id',
				'operation_id',
				'operation_hash',
				'policy_revision',
				'status',
				'version',
				'expires_at',
				'consumed_at',
				'capability',
				'risk',
				'summary',
				'target_id',
				'requested_at',
				'decided_at',
				'decided_by',
				'sequence',
			],
		},
		{
			name: 'agent_operation_approval_commands',
			columns: [
				'user_id',
				'app_id',
				'operation_key',
				'request_hash',
				'approval_id',
				'result_json',
				'feedback',
				'created_at',
			],
		},
		{ name: 'agent_operation_authorities', columns: ['operation_id', 'proof_json'] },
		{
			name: 'agent_operation_artifacts',
			columns: ['operation_id', 'artifact_id', 'artifact_version', 'sha256', 'size_bytes'],
		},
		{
			name: 'agent_operation_contents',
			columns: [
				'id',
				'user_id',
				'app_id',
				'run_id',
				'owner_id',
				'content_key',
				'media_type',
				'chunks',
				'sealed',
				'sha256',
				'size_bytes',
			],
		},
		{
			name: 'agent_operation_content_chunks',
			columns: ['content_id', 'chunk_index', 'text', 'sha256', 'size_bytes'],
		},
		{
			name: 'agent_app_checkpoints',
			columns: ['run_id', 'execution_generation', 'version', 'document_json', 'updated_at'],
		},
		{
			name: 'agent_app_messages',
			columns: [
				'id',
				'run_id',
				'owner_id',
				'message_key',
				'ordinal',
				'operation_id',
				'chunks',
				'created_at',
				'operation_sequence',
			],
		},
		{ name: 'agent_app_message_chunks', columns: ['message_id', 'chunk_index', 'text', 'sha256', 'created_at'] },
		{
			name: 'agent_plugin_instances',
			columns: [
				'id',
				'user_id',
				'app_id',
				'package_id',
				'name',
				'selected',
				'enabled',
				'revision',
				'configuration_revision',
				'schema_revision',
				'configuration_json',
				'created_at',
				'updated_at',
			],
		},
		{
			name: 'agent_plugin_configuration_mutations',
			columns: [
				'user_id',
				'app_id',
				'instance_id',
				'caller_id',
				'operation_key',
				'request_hash',
				'result_json',
				'created_at',
				'retired',
			],
		},
		{
			name: 'agent_plugin_connections',
			columns: [
				'instance_id',
				'user_id',
				'app_id',
				'revision',
				'connector_json',
				'encrypted_credential',
				'updated_at',
			],
		},
		{
			name: 'agent_plugin_private_data',
			columns: [
				'user_id',
				'app_id',
				'publisher_key_id',
				'package_id',
				'instance_id',
				'namespace',
				'key',
				'revision',
				'document_json',
				'updated_at',
			],
		},
		{
			name: 'agent_run_suspensions',
			columns: [
				'run_id',
				'run_version',
				'execution_generation',
				'checkpoint_version',
				'input_request_json',
				'suspended_at',
				'resumed_at',
				'resume_input_json',
			],
		},
		{
			name: 'agent_run_resume_commands',
			columns: ['user_id', 'app_id', 'operation_key', 'run_id', 'request_hash', 'result_json'],
		},
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
				if (!(await frozenFromRun(reader, row.user_id, row.app_id, row.id))) {
					throw new SnapshotFailure('unavailable');
				}
				await frozenExecution(reader, row.id);
			}
		},

		validate(rows) {
			if ((rows.get('agent_artifact_blob_removals') ?? []).length > 0) {
				throw new SnapshotFailure('source_changed');
			}
			validateAgentSnapshotDocuments(rows);
			validateSnapshotHistory(rows);
			validateSnapshotRunExecution(rows);
			validateSnapshotOperations(rows);
			validateSnapshotPluginVersions(rows);
			validateSnapshotPluginComposition(rows);
			validateSnapshotPluginData(rows);
			validateSnapshotDeclarations(rows);

			for (const row of rows.get('agent_artifacts') ?? []) {
				artifactRow(row);
				if (row.status === 'staging' || row.status === 'deleting') {
					throw new SnapshotFailure('source_changed');
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
