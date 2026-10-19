import { AGENT_ID_PATTERN } from '@nexus-terminal/shared/agent/values';
import { AGENT_RUN_STATUSES } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import {
	AGENT_CAPABILITIES,
	AGENT_APPROVAL_STATUSES,
	AGENT_APPROVAL_KINDS,
	AGENT_APPROVAL_RISKS,
	AGENT_APPROVAL_OPERATION_HASH_PATTERN,
	AGENT_APPROVAL_MAX_TOOL_NAME_BYTES,
	AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES,
	AGENT_APPROVAL_MAX_SUMMARY_BYTES,
	AGENT_APPROVAL_MAX_FEEDBACK_BYTES,
	AGENT_EXECUTION_INTEGER_KEYS,
	AGENT_EXECUTION_COMPACTION_MODES,
	AGENT_EXECUTION_CONTEXT_PROFILES,
	AGENT_TARGET_CAPABILITIES,
	AGENT_GRANT_MAX_TARGET_IDS,
	AGENT_GRANT_MAX_ID_BYTES,
} from '@nexus-terminal/shared/agent/governance/values';
import type {
	StoredApproval,
	StoredGrant,
	StoredPolicy,
	StoredScope,
	StoredPolicyOverrides,
	StoredAppPolicyFacts,
} from '../../storage/governance-storage.js';

const invalid = (): never => {
	throw new Error('Corrupt Agent governance row');
};

export const integer = (v: unknown, min = 0): number =>
	typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : invalid();

export function assertRevisionAvailable(value: unknown, minimum = 0, increments = 1): void {
	if (integer(value, minimum) > Number.MAX_SAFE_INTEGER - increments) {
		throw new Error('Agent governance revision exhausted');
	}
}

export const string = (v: unknown): string => (typeof v === 'string' ? v : invalid());

const nullableNumber = (v: unknown): number | null => (v === null ? null : integer(v));

function isRecord(v: unknown): v is Record<string, unknown> {
	return v !== null && typeof v === 'object' && !Array.isArray(v);
}

const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : invalid());

function exact(row: Record<string, unknown>, keys: readonly string[]): void {
	if (Object.keys(row).some((key) => !keys.includes(key))) {
		invalid();
	}
}

function parse(raw: unknown): unknown {
	try {
		return JSON.parse(string(raw));
	} catch {
		return invalid();
	}
}

function readScope(value: unknown): StoredScope {
	const row = record(parse(value));
	if (row.kind === 'global') {
		exact(row, ['kind']);
		return { kind: 'global' };
	}
	if (row.kind !== 'targets') {
		invalid();
	}
	exact(row, ['kind', 'targets']);
	const targets = record(row.targets);
	exact(targets, ['ssh']);
	if (targets.ssh === undefined) {
		return { kind: 'targets' };
	}
	const ssh = record(targets.ssh);
	if (ssh.mode === 'all') {
		exact(ssh, ['mode']);
		return { kind: 'targets', sshMode: 'all' };
	}
	exact(ssh, ['mode', 'ids']);
	if (
		ssh.mode !== 'ids' ||
		!Array.isArray(ssh.ids) ||
		ssh.ids.length > AGENT_GRANT_MAX_TARGET_IDS ||
		ssh.ids.some(
			(id) =>
				typeof id !== 'string' ||
				!/^[1-9][0-9]*$/u.test(id) ||
				!Number.isSafeInteger(Number(id)) ||
				new TextEncoder().encode(id).length > AGENT_GRANT_MAX_ID_BYTES,
		) ||
		new Set(ssh.ids).size !== ssh.ids.length
	) {
		return invalid();
	}
	return { kind: 'targets', sshMode: 'ids', sshIds: ssh.ids.map((id) => string(id)) };
}

export function scopeJson(value: StoredScope): string {
	if (value.kind === 'global') {
		return JSON.stringify({ kind: 'global' });
	}
	if (value.sshMode === undefined) {
		return JSON.stringify({ kind: 'targets', targets: {} });
	}
	if (value.sshMode === 'all') {
		return JSON.stringify({ kind: 'targets', targets: { ssh: { mode: 'all' } } });
	}
	return JSON.stringify({ kind: 'targets', targets: { ssh: { mode: 'ids', ids: value.sshIds.map((id) => id) } } });
}

export function readOverrides(value: unknown): StoredPolicyOverrides {
	const row = record(parse(value));
	exact(row, [...AGENT_EXECUTION_INTEGER_KEYS, 'contextCompactionMode', 'contextProfile']);
	const result: StoredPolicyOverrides = {};
	for (const key of AGENT_EXECUTION_INTEGER_KEYS) {
		if (row[key] !== undefined) {
			result[key] = integer(row[key], 1);
		}
	}
	if (row.contextCompactionMode !== undefined) {
		const mode = AGENT_EXECUTION_COMPACTION_MODES.find((m) => m === row.contextCompactionMode);
		if (mode === undefined) {
			return invalid();
		}
		result.contextCompactionMode = mode;
	}
	if (row.contextProfile !== undefined) {
		const profile = AGENT_EXECUTION_CONTEXT_PROFILES.find((p) => p === row.contextProfile);
		if (profile === undefined) {
			return invalid();
		}
		result.contextProfile = profile;
	}
	return result;
}

function readGrant(row: Record<string, unknown>): StoredGrant {
	const capability = AGENT_CAPABILITIES.find((v) => v === row.capability);
	if (capability === undefined || integer(row.schema_version, 2) !== 2) {
		return invalid();
	}
	const scope = readScope(row.scope_json);
	if ((scope.kind === 'targets') !== AGENT_TARGET_CAPABILITIES.includes(capability)) {
		return invalid();
	}
	return { capability, schemaVersion: 2, scope, grantedAt: integer(row.granted_at) };
}

export function readPolicy(
	userId: number,
	appId: string,
	head: Record<string, unknown>,
	grants: readonly Record<string, unknown>[],
	app: StoredAppPolicyFacts,
): StoredPolicy {
	const policy: StoredPolicy = {
		app,
		userId,
		appId,
		revision: integer(head.policy_revision),
		executionVersion: integer(head.execution_version),
		overrides: readOverrides(head.execution_overrides_json),
		grants: grants.map(readGrant),
	};
	return policy;
}

function readInspection(value: unknown): StoredApproval['inspection'] {
	const row = record(parse(value));
	exact(row, ['toolName', 'toolVersion', 'risk', 'mutation', 'targetConnectionId', 'summary']);
	const risk = AGENT_APPROVAL_RISKS.find((r) => r === row.risk);
	const toolName = string(row.toolName);
	const toolVersion = string(row.toolVersion);
	const summary = string(row.summary);
	const mutation = row.mutation;
	if (
		!risk ||
		!toolName.trim() ||
		new TextEncoder().encode(toolName).length > AGENT_APPROVAL_MAX_TOOL_NAME_BYTES ||
		!toolVersion.trim() ||
		new TextEncoder().encode(toolVersion).length > AGENT_APPROVAL_MAX_TOOL_VERSION_BYTES ||
		!summary.trim() ||
		new TextEncoder().encode(summary).length > AGENT_APPROVAL_MAX_SUMMARY_BYTES ||
		typeof mutation !== 'boolean' ||
		(row.targetConnectionId !== null &&
			!(
				typeof row.targetConnectionId === 'number' &&
				Number.isSafeInteger(row.targetConnectionId) &&
				row.targetConnectionId > 0
			))
	) {
		return invalid();
	}
	return {
		toolName,
		toolVersion,
		risk,
		mutation,
		targetConnectionId: row.targetConnectionId === null ? null : integer(row.targetConnectionId, 1),
		summary,
	};
}

function id(value: unknown): string {
	const result = string(value);
	return AGENT_ID_PATTERN.test(result) ? result : invalid();
}

export function readApproval(row: Record<string, unknown>): StoredApproval {
	const status = AGENT_APPROVAL_STATUSES.find((s) => s === row.status);
	const kind = AGENT_APPROVAL_KINDS.find((s) => s === row.kind);
	if (
		status === undefined ||
		kind === undefined ||
		!AGENT_APPROVAL_OPERATION_HASH_PATTERN.test(string(row.operation_hash))
	) {
		return invalid();
	}
	if (
		row.feedback !== null &&
		(!string(row.feedback).trim() ||
			new TextEncoder().encode(string(row.feedback)).length > AGENT_APPROVAL_MAX_FEEDBACK_BYTES)
	) {
		return invalid();
	}
	const capability = AGENT_CAPABILITIES.find((item) => item === row.capability);
	if (capability === undefined) {
		return invalid();
	}
	const result: StoredApproval = {
		capability,
		targetVersion: row.target_version === null ? null : integer(row.target_version, 1),
		id: id(row.id),
		userId: integer(row.user_id, 1),
		appId: id(row.app_id),
		runId: id(row.run_id),
		toolCallId: id(row.tool_call_id),
		operationHash: string(row.operation_hash),
		kind,
		status,
		policyRevision: integer(row.policy_revision),
		inputRevision: integer(row.input_revision, 1),
		version: integer(row.version, 1),
		requestedAt: integer(row.requested_at),
		expiresAt: integer(row.expires_at),
		decidedAt: nullableNumber(row.decided_at),
		decidedByUserId: row.decided_by_user_id === null ? null : integer(row.decided_by_user_id, 1),
		consumedAt: nullableNumber(row.consumed_at),
		feedback: row.feedback === null ? null : string(row.feedback),
		inspection: readInspection(row.inspection_json),
	};

	if ((result.targetVersion === null) !== (result.inspection.targetConnectionId === null)) {
		return invalid();
	}
	const decided = result.status === 'approved' || result.status === 'denied';
	if (
		result.expiresAt <= result.requestedAt ||
		result.inputRevision < 1 ||
		(decided
			? result.decidedAt === null || result.decidedByUserId === null
			: result.decidedAt !== null || result.decidedByUserId !== null) ||
		(result.decidedAt !== null &&
			(result.decidedAt < result.requestedAt || result.decidedAt >= result.expiresAt)) ||
		(result.consumedAt !== null &&
			(result.status !== 'approved' ||
				result.decidedAt === null ||
				result.consumedAt < result.decidedAt ||
				result.consumedAt >= result.expiresAt))
	) {
		return invalid();
	}
	return result;
}

/** An idempotency reply is its original committed projection, not a later mutable approval row. */
export function readApprovalSnapshot(raw: unknown): StoredApproval {
	const row = record(parse(raw));
	exact(row, [
		'id',
		'user_id',
		'app_id',
		'run_id',
		'tool_call_id',
		'operation_hash',
		'capability',
		'target_version',
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
	]);
	return readApproval(row);
}

export function readRunStatus(value: unknown): AgentRunStatus {
	const status = AGENT_RUN_STATUSES.find((item) => item === value);
	return status === undefined ? invalid() : status;
}
