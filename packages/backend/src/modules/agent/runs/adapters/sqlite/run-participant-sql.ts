import { AGENT_EXECUTION_LIMIT_MAXIMA } from '@nexus-terminal/shared/agent/execution/values';
import { AGENT_CHILD_PROFILES } from '@nexus-terminal/shared/agent/collaboration/values';
import { CollaborationStorageRefusal } from '../../storage/run-collaboration-storage.js';
import type { StoredCollaborationAuthority } from '../../storage/run-collaboration-storage.js';
import { toolOperation } from './run-tool-row.js';
import { AGENT_RUN_STATUSES, AGENT_RUN_STEP_MAX_COUNT } from '@nexus-terminal/shared/agent/runs/values';
import type { SqlExecutor, SqlReader } from '../../../../../platform/storage/sqlite/sql-types.js';
import type { StoredParticipant, StoredParticipantScope } from '../../storage/run-collaboration-storage.js';

export function storedStrings(value: unknown): string[] {
	if (typeof value !== 'string') {
		throw new Error('Corrupt participant list');
	}
	if (Buffer.byteLength(value, 'utf8') > 16 * 1024) {
		throw new Error('Participant list exceeded its stored bound');
	}
	const parsed: unknown = JSON.parse(value);
	if (
		!Array.isArray(parsed) ||
		parsed.some((item) => typeof item !== 'string') ||
		new Set(parsed).size !== parsed.length
	) {
		throw new Error('Corrupt participant list');
	}
	return parsed.map((item) => {
		if (typeof item !== 'string') {
			throw new Error('Corrupt participant list entry');
		}
		return item;
	});
}

export function storedInteger(value: unknown, minimum = 0): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
		throw new Error('Corrupt collaboration integer');
	}
	return value;
}

export function assertRunRevisionAvailable(value: unknown, increments = 1): void {
	if (storedInteger(value) > Number.MAX_SAFE_INTEGER - increments) {
		throw new Error('Agent Run revision exhausted');
	}
}

export function storedText(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Corrupt collaboration text');
	}
	return value;
}

export async function participant(tx: SqlReader, scope: StoredParticipantScope): Promise<StoredParticipant | null> {
	const row = await tx.one(
		`SELECT r.id,r.version,r.run_kind,r.status,r.created_at,r.deadline_at,c.parent_id,c.profile,c.output_text,c.tools_json,c.max_requests,c.dependencies_json,c.dependency_mode
		 FROM agent_runs r LEFT JOIN agent_run_children c ON c.run_id=r.id WHERE r.id=? AND r.user_id=? AND r.app_id=?`,
		[scope.runId, scope.userId, scope.appId],
	);
	if (!row) {
		return null;
	}
	const status = AGENT_RUN_STATUSES.find((value) => value === row.status);
	if (!status) {
		throw new Error('Corrupt participant status');
	}
	if (row.run_kind === 'root' && row.parent_id === null) {
		return {
			id: scope.runId,
			version: storedInteger(row.version, 1),
			rootId: scope.runId,
			parentId: null,
			status,
			profile: 'root',
			output: null,
			tools: [],
			maxRequests: AGENT_RUN_STEP_MAX_COUNT,
			deadline: storedInteger(row.deadline_at, 1),
			dependencies: [],
			dependencyMode: 'success',
		};
	}
	if (
		row.run_kind !== 'child' ||
		typeof row.parent_id !== 'string' ||
		(row.dependency_mode !== 'success' && row.dependency_mode !== 'settled')
	) {
		throw new Error('Corrupt participant relation');
	}
	const profile = AGENT_CHILD_PROFILES.find((value) => value === row.profile);
	if (
		!profile ||
		storedInteger(row.max_requests, 1) > AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests ||
		(status === 'completed') !== (row.output_text !== null) ||
		(row.output_text !== null && Buffer.byteLength(storedText(row.output_text), 'utf8') > 8192) ||
		storedStrings(row.dependencies_json).length > 4
	) {
		throw new Error('Corrupt participant limits or terminal output');
	}
	return {
		id: scope.runId,
		version: storedInteger(row.version, 1),
		rootId: row.parent_id,
		parentId: row.parent_id,
		status,
		profile,
		output: row.output_text === null ? null : storedText(row.output_text),
		tools: storedStrings(row.tools_json),
		maxRequests: storedInteger(row.max_requests, 1),
		deadline: storedInteger(row.deadline_at, 1),
		dependencies: storedStrings(row.dependencies_json),
		dependencyMode: row.dependency_mode,
	};
}

/** A persisted restriction is intersected with live Root authority, never substituted for it. */
export async function currentParticipant(
	tx: SqlExecutor,
	scope: StoredParticipantScope,
	clock: () => number,
	toolName?: string,
	stepIndex?: number,
	allowExpired = false,
): Promise<boolean> {
	const current = await participant(tx, scope);
	if (!current || (current.status !== 'pending' && current.status !== 'running')) {
		return false;
	}
	if (current.parentId === null) {
		return allowExpired || clock() < current.deadline;
	}
	const allowedTool =
		toolName === undefined ||
		(toolName === 'acp_inner_permission'
			? current.tools.includes('acp_execute') || current.tools.includes('acp_integration_execute')
			: current.tools.includes(toolName));
	if (!allowedTool || (stepIndex !== undefined && stepIndex > current.maxRequests)) {
		return false;
	}
	const parent = await tx.one('SELECT run_kind,status FROM agent_runs WHERE id=? AND user_id=? AND app_id=?', [
		current.parentId,
		scope.userId,
		scope.appId,
	]);
	return (
		parent !== null &&
		parent.run_kind === 'root' &&
		parent.status === 'running' &&
		(allowExpired || clock() < current.deadline)
	);
}

export async function collaborationAuthority(
	tx: SqlExecutor,
	input: StoredCollaborationAuthority,
): Promise<StoredParticipant> {
	const operation = await toolOperation(
		tx,
		input.scope.userId,
		input.scope.appId,
		input.scope.runId,
		input.operationId,
	);
	if (
		!operation ||
		operation.state !== 'dispatched' ||
		operation.operationHash !== input.operationHash ||
		!(await currentParticipant(tx, input.scope, Date.now, operation.toolName))
	) {
		throw new CollaborationStorageRefusal('version_conflict');
	}
	const owner = await participant(tx, input.scope);
	if (!owner) {
		throw new Error('Collaboration participant missing');
	}
	return owner;
}
