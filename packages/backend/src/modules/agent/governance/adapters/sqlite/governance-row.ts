import { AGENT_RUN_STATUSES } from '@nexus-terminal/shared/agent/runs/values';
import type { AgentRunStatus } from '@nexus-terminal/shared/agent/runs/values';
import {
	AGENT_CAPABILITIES,
	AGENT_EXECUTION_INTEGER_KEYS,
	AGENT_TARGET_CAPABILITIES,
	AGENT_GRANT_MAX_ID_BYTES,
} from '@nexus-terminal/shared/agent/governance/values';
import type {
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
	exact(row, AGENT_EXECUTION_INTEGER_KEYS);
	const result: StoredPolicyOverrides = {};
	for (const key of AGENT_EXECUTION_INTEGER_KEYS) {
		if (row[key] !== undefined) {
			result[key] = integer(row[key], 1);
		}
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

export function readRunStatus(value: unknown): AgentRunStatus {
	const status = AGENT_RUN_STATUSES.find((item) => item === value);
	return status === undefined ? invalid() : status;
}
