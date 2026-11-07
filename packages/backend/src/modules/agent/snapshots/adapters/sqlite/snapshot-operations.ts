import { AGENT_RUN_FAILURE_CODES } from '@nexus-terminal/shared/agent/runs/values';
import { createHash } from 'node:crypto';
import { readAgentPluginContentReference } from '@nexus-terminal/shared/agent/plugins/content';
import { readAgentPluginAppOutcome } from '@nexus-terminal/shared/agent/plugins/app-outcome';
import { readAgentPluginDataRecord } from '@nexus-terminal/shared/agent/plugins/data';
import { readAgentId } from '@nexus-terminal/shared/agent/http-codec';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { operationRow } from '../../../operations/adapters/sqlite/operation-row.js';
import { operationAuthority } from '../../../operations/adapters/sqlite/operation-authority-row.js';
import { readStoredContentDraft } from '../../../operations/adapters/sqlite/operation-content-sql.js';
import { readStoredAppCheckpoint } from '../../../runs/adapters/sqlite/run-app-state-sql.js';
import { readStoredOperationApproval } from '../../../governance/adapters/sqlite/operation-approval-sql.js';
import { readStoredPluginConfiguration } from '../../../plugins/adapters/sqlite/plugin-instance-sql.js';
import { readStoredPluginConnector } from '../../../plugins/adapters/sqlite/plugin-connection-sql.js';

function assert(condition: unknown): asserts condition {
	if (!condition) {
		throw new SnapshotFailure('unavailable');
	}
}

function text(value: unknown): string {
	assert(typeof value === 'string');
	return value;
}

function integer(value: unknown, minimum = 0): number {
	assert(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum);
	return value;
}

function indexed(rows: readonly SqlRow[], key: (row: SqlRow) => string): Map<string, SqlRow> {
	const map = new Map<string, SqlRow>();
	for (const row of rows) {
		const id = key(row);
		assert(!map.has(id));
		map.set(id, row);
	}
	return map;
}

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Validate the actual generic ledgers and retained bytes, independently of any App's private schema. */
export function validateSnapshotOperations(rows: ReadonlyMap<string, readonly SqlRow[]>): void {
	const runs = indexed(rows.get('agent_runs') ?? [], (row) => readAgentId(row.id));
	const executions = indexed(rows.get('agent_run_executions') ?? [], (row) => readAgentId(row.generation));
	const operations = new Map(
		(rows.get('agent_operations') ?? []).map((row) => {
			const value = operationRow(row);
			return [value.id, value];
		}),
	);
	assert(operations.size === (rows.get('agent_operations') ?? []).length);
	for (const row of rows.get('agent_operation_diagnostics') ?? []) {
		const operation = operations.get(text(row.operation_id));
		assert(operation && ['failed', 'unknown'].includes(operation.state));
		assert(AGENT_RUN_FAILURE_CODES.some((code) => code === row.code));
	}
	const identities = new Set<string>();
	const sequences = new Set<number>();
	const liveExecutions = new Set<string>();
	for (const execution of executions.values()) {
		assert(
			runs.has(readAgentId(execution.run_id)) && ['open', 'draining', 'closed'].includes(text(execution.state)),
		);
		assert(integer(execution.updated_at) >= integer(execution.created_at));
		if (execution.state !== 'closed') {
			assert(!liveExecutions.has(text(execution.run_id)));
			liveExecutions.add(text(execution.run_id));
		}
	}
	for (const operation of operations.values()) {
		const run = runs.get(operation.scope.runId);
		const execution = executions.get(operation.scope.executionGeneration);
		assert(
			run &&
				execution &&
				execution.run_id === run.id &&
				run.app_id === operation.scope.appId &&
				run.user_id === operation.scope.userId,
		);
		const identity = JSON.stringify([operation.scope.runId, operation.callerId, operation.operationKey]);
		assert(!identities.has(identity) && !sequences.has(operation.sequence));
		identities.add(identity);
		sequences.add(operation.sequence);
		if (operation.parentId !== null) {
			const parent = operations.get(operation.parentId);
			assert(
				parent &&
					parent.scope.runId === operation.scope.runId &&
					parent.sequence < operation.sequence &&
					parent.scope.executionGeneration === operation.scope.executionGeneration,
			);
			assert(parent.state !== 'completed' || !['accepted', 'dispatched', 'unknown'].includes(operation.state));
		}
		assert(run.status !== 'completed' || !['accepted', 'dispatched', 'unknown'].includes(operation.state));
	}
	const approvals = indexed(rows.get('agent_operation_approvals') ?? [], (row) => readAgentId(row.id));
	const approvalOperations = new Set<string>();
	const approvalSequences = new Set<number>();
	for (const row of approvals.values()) {
		const operation = operations.get(readAgentId(row.operation_id));
		assert(operation && !approvalOperations.has(operation.id));
		approvalOperations.add(operation.id);
		const value = readStoredOperationApproval({
			id: row.id,
			operation_id: row.operation_id,
			operation_hash: row.operation_hash,
			policy_revision: row.policy_revision,
			status: row.status,
			version: row.version,
			expires_at: row.expires_at,
			consumed_at: row.consumed_at,
			capability: row.capability,
			risk: row.risk,
			summary: row.summary,
			target_id: row.target_id,
			requested_at: row.requested_at,
			decided_at: row.decided_at,
			decided_by: row.decided_by,
			sequence: row.sequence,
			run_id: operation.scope.runId,
			app_id: operation.scope.appId,
			parent_id: operation.parentId,
			label: operation.label,
		});
		assert(!approvalSequences.has(value.sequence));
		approvalSequences.add(value.sequence);
		assert(value.operationHash === operation.requestHash && value.expiresAt > value.requestedAt);
		assert((value.decidedAt === null) === (value.decidedBy === null));
		assert(value.decidedAt === null || value.decidedAt >= value.requestedAt);
		assert(!['approved', 'denied'].includes(value.status) || value.decidedAt !== null);
		assert(
			value.consumedAt === null ||
				(value.status === 'approved' &&
					value.decidedAt !== null &&
					value.consumedAt >= value.decidedAt &&
					value.consumedAt < value.expiresAt),
		);
	}
	const authorities = indexed(rows.get('agent_operation_authorities') ?? [], (row) => readAgentId(row.operation_id));
	for (const row of authorities.values()) {
		const operation = operations.get(text(row.operation_id));
		assert(operation && operation.state !== 'accepted');
		const proof = operationAuthority(row.proof_json);
		if (proof.approval) {
			const approval = approvals.get(proof.approval.id);
			assert(
				approval &&
					approval.operation_id === operation.id &&
					approval.status === 'approved' &&
					approval.consumed_at !== null &&
					approval.version === proof.approval.version + 1 &&
					approval.policy_revision === proof.policyRevision,
			);
		}
		if (proof.modelReservation) {
			const reservation = (rows.get('agent_operation_model_reservations') ?? []).find(
				(item) => item.operation_id === operation.id,
			);
			assert(
				operation.kind === 'model' &&
					proof.provider &&
					reservation &&
					reservation.provider_id === proof.provider.id &&
					reservation.reserved_tokens === proof.modelReservation.tokens,
			);
		}
	}
	for (const operation of operations.values()) {
		assert(!['dispatched', 'completed', 'unknown'].includes(operation.state) || authorities.has(operation.id));
	}
	for (const row of rows.get('agent_operation_model_reservations') ?? []) {
		const operation = operations.get(readAgentId(row.operation_id));
		assert(operation?.kind === 'model' && runs.has(readAgentId(row.root_id)));
		assert(
			(rows.get('agent_providers') ?? []).some(
				(provider) => provider.id === row.provider_id && provider.user_id === operation.scope.userId,
			),
		);
		integer(row.reserved_tokens, 1);
		assert((row.input_tokens === null) === (row.output_tokens === null));
		if (row.input_tokens !== null) {
			integer(row.input_tokens);
			integer(row.output_tokens);
		}
	}
	for (const row of rows.get('agent_operation_artifacts') ?? []) {
		const operation = operations.get(readAgentId(row.operation_id));
		const artifact = (rows.get('agent_artifacts') ?? []).find((item) => item.id === row.artifact_id);
		assert(
			operation &&
				artifact &&
				artifact.user_id === operation.scope.userId &&
				artifact.app_id === operation.scope.appId,
		);
		integer(row.artifact_version, 1);
		integer(row.size_bytes);
		assert(/^[a-f0-9]{64}$/u.test(text(row.sha256)));
	}
	for (const row of rows.get('agent_operation_approval_commands') ?? []) {
		const approved = approvals.get(readAgentId(row.approval_id));
		const operation = approved && operations.get(text(approved.operation_id));
		assert(operation && operation.scope.userId === row.user_id && operation.scope.appId === row.app_id);
		assert(/^[a-f0-9]{64}$/u.test(text(row.request_hash)));
		text(row.operation_key);
		integer(row.created_at);
		const receipt = readStoredOperationApproval(JSON.parse(text(row.result_json)));
		assert(
			receipt.id === row.approval_id &&
				receipt.runId === operation.scope.runId &&
				receipt.appId === row.app_id &&
				receipt.operationId === operation.id &&
				receipt.operationHash === operation.requestHash,
		);
	}

	const contents = indexed(rows.get('agent_operation_contents') ?? [], (row) => readAgentId(row.id));
	const chunks = new Map<string, SqlRow[]>();
	for (const row of rows.get('agent_operation_content_chunks') ?? []) {
		const id = readAgentId(row.content_id);
		assert(contents.has(id));
		const group = chunks.get(id) ?? [];
		group.push(row);
		chunks.set(id, group);
	}
	identities.clear();
	for (const row of contents.values()) {
		const value = readStoredContentDraft(row);
		const run = runs.get(value.runId);
		assert(run && row.user_id === run.user_id && row.app_id === run.app_id);
		const identity = JSON.stringify([value.runId, value.ownerId, value.key]);
		assert(!identities.has(identity));
		identities.add(identity);
		const group = (chunks.get(value.id) ?? []).sort((a, b) => integer(a.chunk_index) - integer(b.chunk_index));
		assert(group.length === value.chunks);
		const hash = createHash('sha256');
		let bytes = 0;
		for (const [index, chunk] of group.entries()) {
			const body = text(chunk.text);
			const size = Buffer.byteLength(body);
			assert(
				integer(chunk.chunk_index) === index &&
					chunk.sha256 === digest(body) &&
					integer(chunk.size_bytes) === size,
			);
			hash.update(body);
			bytes += size;
		}
		assert(bytes === value.sizeBytes && (!value.sealed || hash.digest('hex') === value.sha256));
	}

	const reference = (runId: string, raw: unknown, ownOnly: boolean) => {
		const ref = readAgentPluginContentReference(raw);
		const stored = contents.get(ref.id);
		const reader = runs.get(runId);
		assert(
			stored &&
				reader &&
				stored.user_id === reader.user_id &&
				stored.app_id === reader.app_id &&
				stored.sealed === 1 &&
				stored.sha256 === ref.sha256 &&
				stored.size_bytes === ref.sizeBytes &&
				stored.media_type === ref.mediaType,
		);
		if (stored.run_id !== runId) {
			assert(!ownOnly);
			const child = (rows.get('agent_run_children') ?? []).find(
				(item) => item.run_id === stored.run_id && item.parent_id === runId,
			);
			const childRun = runs.get(text(stored.run_id));
			const exported = (rows.get('agent_run_inputs') ?? []).find((item) => item.run_id === stored.run_id);
			assert(child && childRun?.status === 'completed' && exported && typeof exported.output_json === 'string');
			const result = readAgentPluginAppOutcome(JSON.parse(exported.output_json));
			assert(
				result.kind === 'complete' &&
					result.outputs.some(
						(item) =>
							item.id === ref.id &&
							item.sha256 === ref.sha256 &&
							item.sizeBytes === ref.sizeBytes &&
							item.mediaType === ref.mediaType,
					),
			);
		}
	};

	for (const row of rows.get('agent_run_inputs') ?? []) {
		const runId = readAgentId(row.run_id);
		assert(runs.has(runId));
		JSON.parse(text(row.input_json));
		if (row.output_json !== null) {
			const outcome = readAgentPluginAppOutcome(JSON.parse(text(row.output_json)));
			assert(outcome.kind === 'complete' && runs.get(runId)?.status === 'completed');
			for (const ref of outcome.outputs) {
				reference(runId, ref, false);
			}
		}
	}
	const checkpoints = indexed(rows.get('agent_app_checkpoints') ?? [], (row) => readAgentId(row.run_id));
	for (const [runId, row] of checkpoints) {
		const value = readStoredAppCheckpoint(row.document_json);
		assert(
			runs.has(runId) &&
				executions.get(readAgentId(row.execution_generation))?.run_id === runId &&
				value.version === integer(row.version, 1),
		);
		reference(runId, value.state, true);
		for (const id of value.consumedOperationIds) {
			const operation = operations.get(id);
			assert(operation?.scope.runId === runId && ['completed', 'failed', 'cancelled'].includes(operation.state));
		}
	}
	const messages = indexed(rows.get('agent_app_messages') ?? [], (row) => readAgentId(row.id));
	const messageChunks = new Map<string, SqlRow[]>();
	for (const row of rows.get('agent_app_message_chunks') ?? []) {
		const id = readAgentId(row.message_id);
		assert(messages.has(id));
		const group = messageChunks.get(id) ?? [];
		group.push(row);
		messageChunks.set(id, group);
	}
	identities.clear();
	const ordinals = new Set<string>();
	for (const [id, row] of messages) {
		const runId = readAgentId(row.run_id);
		assert(runs.has(runId));
		const identity = JSON.stringify([runId, text(row.owner_id), text(row.message_key)]);
		const ordinal = JSON.stringify([runId, integer(row.ordinal, 1)]);
		assert(!identities.has(identity) && !ordinals.has(ordinal));
		identities.add(identity);
		ordinals.add(ordinal);
		if (row.operation_id !== null) {
			const operation = operations.get(readAgentId(row.operation_id));
			assert(operation?.scope.runId === runId && operation.sequence === integer(row.operation_sequence));
		} else {
			integer(row.operation_sequence);
		}
		const group = (messageChunks.get(id) ?? []).sort((a, b) => integer(a.chunk_index) - integer(b.chunk_index));
		assert(group.length === integer(row.chunks));
		for (const [index, chunk] of group.entries()) {
			assert(integer(chunk.chunk_index) === index && chunk.sha256 === digest(text(chunk.text)));
		}
	}
	for (const row of rows.get('agent_run_suspensions') ?? []) {
		const runId = readAgentId(row.run_id);
		const run = runs.get(runId);
		const checkpoint = checkpoints.get(runId);
		assert(
			run &&
				checkpoint &&
				integer(row.checkpoint_version, 1) <= integer(checkpoint.version, 1) &&
				executions.get(readAgentId(row.execution_generation))?.run_id === runId,
		);
		reference(runId, JSON.parse(text(row.input_request_json)), false);
		assert(integer(row.run_version, 1) <= integer(run.version, 1));
		if (row.resumed_at === null) {
			assert(
				row.resume_input_json === null &&
					(run.status === 'suspended'
						? run.version === row.run_version && checkpoint.version === row.checkpoint_version
						: ['cancelled', 'failed', 'unknown'].includes(text(run.status)) &&
							integer(run.version, 1) > integer(row.run_version, 1)),
			);
		} else {
			assert(integer(row.resumed_at) >= integer(row.suspended_at));
			JSON.parse(text(row.resume_input_json));
		}
	}
	const instances = indexed(rows.get('agent_plugin_instances') ?? [], (row) =>
		JSON.stringify([row.user_id, row.app_id, row.id]),
	);
	for (const row of instances.values()) {
		readStoredPluginConfiguration(row);
		integer(row.revision, 1);
		integer(row.updated_at, integer(row.created_at));
		assert((row.selected === 0 || row.selected === 1) && (row.enabled === 0 || row.enabled === 1));
	}
	for (const row of rows.get('agent_plugin_connections') ?? []) {
		assert(instances.has(JSON.stringify([row.user_id, row.app_id, row.instance_id])));
		integer(row.revision, 1);
		integer(row.updated_at);
		const connector = readStoredPluginConnector(row.connector_json);
		assert(
			row.encrypted_credential === null ||
				(typeof row.encrypted_credential === 'string' && connector.kind === 'http'),
		);
	}
	for (const row of rows.get('agent_plugin_configuration_mutations') ?? []) {
		assert(instances.has(JSON.stringify([row.user_id, row.app_id, row.instance_id])));
		assert(/^[a-f0-9]{64}$/u.test(text(row.request_hash)));
		text(row.operation_key);
		text(row.caller_id);
		integer(row.created_at);
		const receipt: unknown = JSON.parse(text(row.result_json));
		assert(row.retired === 0 || row.retired === 1);
		if (row.retired === 1) {
			assert(JSON.stringify(receipt) === '{}');
		} else {
			assert(receipt !== null && typeof receipt === 'object' && !Array.isArray(receipt));
			readStoredPluginConfiguration({
				id: row.instance_id,
				package_id: 'package_id' in receipt ? receipt.package_id : null,
				configuration_json: 'configuration_json' in receipt ? receipt.configuration_json : null,
				configuration_revision: 'configuration_revision' in receipt ? receipt.configuration_revision : null,
				schema_revision: 'schema_revision' in receipt ? receipt.schema_revision : null,
			});
			assert('changed' in receipt && typeof receipt.changed === 'boolean');
		}
	}
	for (const row of rows.get('agent_plugin_private_data') ?? []) {
		const instance = instances.get(JSON.stringify([row.user_id, row.app_id, row.instance_id]));
		assert(
			instance &&
				instance.package_id === row.package_id &&
				typeof row.publisher_key_id === 'string' &&
				(rows.get('agent_plugin_publishers') ?? []).some(
					(publisher) => publisher.user_id === row.user_id && publisher.key_id === row.publisher_key_id,
				),
		);
		assert(text(row.namespace).trim() && text(row.key).trim());
		integer(row.updated_at);
		readAgentPluginDataRecord({ key: row.key, revision: row.revision, documentJson: row.document_json });
	}
}
