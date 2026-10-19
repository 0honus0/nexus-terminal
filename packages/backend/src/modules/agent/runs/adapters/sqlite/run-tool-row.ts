import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AGENT_TOOL_STATES } from '@nexus-terminal/shared/agent/tools/values';
import {
	TOOL_ARGUMENT_MAX_BYTES,
	TOOL_RESULT_MAX_BYTES,
	TOOL_PROVIDER_CALL_ID_MAX_BYTES,
} from '../../run-tool-limits.js';
import {
	AGENT_CAPABILITIES,
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_MAX_TOOL_NAME_BYTES,
	AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES,
	AGENT_APPROVAL_MAX_SUMMARY_BYTES,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
} from '@nexus-terminal/shared/agent/governance/values';
import type { StoredToolOperation, StoredToolEvent } from '../../storage/run-tool-storage.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';

function invalid(): never {
	throw new Error('Corrupt Agent tool operation');
}

function integer(value: unknown, minimum = 0): number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : invalid();
}

function text(value: unknown, max: number): string {
	return typeof value === 'string' && value.trim() && Buffer.byteLength(value, 'utf8') <= max ? value : invalid();
}

function id(value: unknown): string {
	return typeof value === 'string' && AGENT_ID_PATTERN.test(value) ? value : invalid();
}

export function readToolOperation(row: Record<string, unknown>): StoredToolOperation {
	const state = AGENT_TOOL_STATES.find((item) => item === row.state);
	const capability = AGENT_CAPABILITIES.find((item) => item === row.capability);
	const risk = AGENT_APPROVAL_RISKS.find((item) => item === row.risk);
	if (
		state === undefined ||
		capability === undefined ||
		risk === undefined ||
		(row.mutation !== 0 && row.mutation !== 1) ||
		!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(text(row.operation_hash, 64))
	) {
		return invalid();
	}
	const argumentsJson = text(row.arguments_json, TOOL_ARGUMENT_MAX_BYTES);
	let argumentsValue: unknown;
	try {
		argumentsValue = JSON.parse(argumentsJson);
	} catch {
		return invalid();
	}
	if (argumentsValue === null || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
		return invalid();
	}
	const targetId = row.target_id === null ? null : integer(row.target_id, 1);
	const targetVersion = row.target_version === null ? null : integer(row.target_version, 1);
	const createdAt = integer(row.created_at);
	const updatedAt = integer(row.updated_at, createdAt);
	const operationRevision = integer(row.operation_revision, 1);
	const revision = integer(row.revision, operationRevision);
	if ((targetId === null) !== (targetVersion === null)) {
		return invalid();
	}
	const resultText = row.result_text;
	if (
		resultText !== null &&
		(typeof resultText !== 'string' || Buffer.byteLength(resultText, 'utf8') > TOOL_RESULT_MAX_BYTES)
	) {
		return invalid();
	}
	if ((state === 'inspected' || state === 'dispatched') && resultText !== null) {
		return invalid();
	}
	if (state === 'completed' && resultText === null) {
		return invalid();
	}
	return {
		id: id(row.id),
		userId: integer(row.user_id, 1),
		appId: id(row.app_id),
		runId: id(row.run_id),
		modelStepIndex: integer(row.model_step_index, 1),
		providerCallId: text(row.provider_call_id, TOOL_PROVIDER_CALL_ID_MAX_BYTES),
		toolName: text(row.tool_name, AGENT_APPROVAL_MAX_TOOL_NAME_BYTES),
		toolVersion: text(row.tool_version, AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES),
		capability,
		targetId,
		targetVersion,
		risk,
		mutation: row.mutation === 1,
		summary: text(row.summary, AGENT_APPROVAL_MAX_SUMMARY_BYTES),
		argumentsJson,
		operationHash: text(row.operation_hash, 64),
		operationRevision,
		revision,
		state,
		resultText,
		createdAt,
		updatedAt,
	};
}

export async function toolOperation(
	tx: SqlExecutor,
	userId: number,
	appId: string,
	runId: string,
	id: string,
): Promise<StoredToolOperation | null> {
	const row = await tx.one('SELECT * FROM agent_run_tools WHERE user_id=? AND app_id=? AND run_id=? AND id=?', [
		userId,
		appId,
		runId,
		id,
	]);
	return row === null ? null : readToolOperation(row);
}

export function readToolEvent(row: Record<string, unknown>): StoredToolEvent {
	const state = AGENT_TOOL_STATES.find((value) => value === row.state);
	const operationHash = text(row.operation_hash, 64);
	if (state === undefined || !AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(operationHash)) {
		return invalid();
	}
	const operationRevision = integer(row.operation_revision, 1);
	return {
		toolCallId: id(row.tool_call_id),
		runId: id(row.run_id),
		revision: integer(row.revision, operationRevision),
		operationRevision,
		state,
		operationHash,
		createdAt: integer(row.created_at),
	};
}
