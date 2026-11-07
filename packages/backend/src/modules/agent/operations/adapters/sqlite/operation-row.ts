import { AGENT_OPERATION_KINDS, AGENT_OPERATION_STATES } from '@nexus-terminal/shared/agent/operations/values';
import { AGENT_OPERATION_ERROR_CODES, AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import type { StoredOperation } from '../../storage/operation-storage.js';

function integer(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt operation integer');
	}
	return value;
}

function text(value: unknown): string {
	if (typeof value !== 'string' || value.includes('\0')) {
		throw new Error('Corrupt operation text');
	}
	return value;
}

function id(value: unknown): string {
	const valueText = text(value);
	if (!AGENT_ID_PATTERN.test(valueText)) {
		throw new Error('Corrupt operation identity');
	}
	return valueText;
}

function json(value: unknown): string {
	const encoded = text(value);
	JSON.parse(encoded);
	return encoded;
}

export function operationRow(row: Record<string, unknown>): StoredOperation {
	const state = AGENT_OPERATION_STATES.find((value) => value === row.state);
	const kind = AGENT_OPERATION_KINDS.find((value) => value === row.kind);
	const failureCode =
		row.failure_code === null ? null : AGENT_OPERATION_ERROR_CODES.find((code) => code === row.failure_code);
	const requestHash = text(row.request_hash);
	const resultJson = row.result_json === null ? null : json(row.result_json);
	const createdAt = integer(row.created_at);
	const updatedAt = integer(row.updated_at, createdAt);
	if (
		!state ||
		!kind ||
		failureCode === undefined ||
		!/^[a-f0-9]{64}$/u.test(requestHash) ||
		(state === 'completed') !== (resultJson !== null) ||
		(state === 'failed') !== (failureCode !== null)
	) {
		throw new Error('Corrupt operation state');
	}
	return {
		id: id(row.id),
		sequence: integer(row.sequence, 1),
		scope: {
			userId: integer(row.user_id, 1),
			appId: id(row.app_id),
			runId: id(row.run_id),
			executionGeneration: id(row.execution_generation),
		},
		parentId: row.parent_id === null ? null : id(row.parent_id),
		callerId: text(row.caller_id),
		operationKey: text(row.operation_key),
		requestHash,
		kind,
		label: text(row.label),
		bindingJson: json(row.binding_json),
		argumentsJson: json(row.arguments_json),
		state,
		revision: integer(row.revision, 1),
		resultJson,
		failureCode,
		createdAt,
		updatedAt,
	};
}
