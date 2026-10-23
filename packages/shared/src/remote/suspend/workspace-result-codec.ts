import { readWorkspaceAttachment } from '../workspace/workspace-codec.js';
import { readSuspendedSessionId } from './http-codec.js';
import {
	SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
	SUSPENDED_REVOCATION_REASONS,
	SUSPENDED_TERMINATION_REASONS,
	WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES,
} from './values.js';
import type {
	WorkspaceSuspendMarkResponse,
	WorkspaceSuspendResumeResponse,
	WorkspaceSuspendOwnerRenewResponse,
	WorkspaceSuspendHistoryPreviousResponse,
	WorkspaceSuspendHistoryResetResponse,
	WorkspaceSuspendAutoTerminatedEvent,
	WorkspaceSuspendRevokedEvent,
	WorkspaceSuspendUnmarkedEvent,
} from './workspace.js';

export class InvalidWorkspaceSuspendResult extends Error {
	constructor() {
		super('Invalid suspended workspace result');
		this.name = 'InvalidWorkspaceSuspendResult';
	}
}

function invalid(): never {
	throw new InvalidWorkspaceSuspendResult();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key))) {
		return invalid();
	}
	let json: string;
	try {
		json = JSON.stringify(value);
	} catch {
		return invalid();
	}
	if (new TextEncoder().encode(json).byteLength > SUSPENDED_MANAGEMENT_MAX_JSON_BYTES) {
		return invalid();
	}
	return value;
}

function positive(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		return invalid();
	}
	return value;
}

function boolean(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		return invalid();
	}
	return value;
}

function choice<T extends string>(value: unknown, options: readonly T[]): T {
	for (const option of options) {
		if (option === value) {
			return option;
		}
	}
	return invalid();
}

export function readWorkspaceSuspendMarkResponse(value: unknown): WorkspaceSuspendMarkResponse {
	return { suspendedSessionId: readSuspendedSessionId(object(value, ['suspendedSessionId']).suspendedSessionId) };
}

export function readWorkspaceSuspendResumeResponse(value: unknown): WorkspaceSuspendResumeResponse {
	const row = object(value, [
		'workspaceId',
		'connectionId',
		'connectionName',
		'binaryProtocolVersion',
		'resumeToken',
		'attachmentGeneration',
		'terminalOffset',
		'lastConnectedAt',
		'resumedFrom',
		'historyAvailable',
		'ownershipGeneration',
		'ownershipLeaseExpiresAt',
	]);
	const attachment = readWorkspaceAttachment(row);
	if (attachment.terminalOffset > WORKSPACE_SUSPEND_MAX_SNAPSHOT_BYTES) {
		return invalid();
	}
	return {
		workspaceId: attachment.workspaceId,
		connectionId: attachment.connectionId,
		connectionName: attachment.connectionName,
		binaryProtocolVersion: attachment.binaryProtocolVersion,
		resumeToken: attachment.resumeToken,
		attachmentGeneration: attachment.attachmentGeneration,
		terminalOffset: attachment.terminalOffset,
		lastConnectedAt: attachment.lastConnectedAt,
		resumedFrom: readSuspendedSessionId(row.resumedFrom),
		historyAvailable: boolean(row.historyAvailable),
		ownershipGeneration: positive(row.ownershipGeneration),
		ownershipLeaseExpiresAt: positive(row.ownershipLeaseExpiresAt),
	};
}

export function readWorkspaceSuspendOwnerRenew(value: unknown): WorkspaceSuspendOwnerRenewResponse {
	const row = object(value, ['generation', 'leaseExpiresAt']);
	return { generation: positive(row.generation), leaseExpiresAt: positive(row.leaseExpiresAt) };
}

export function readWorkspaceSuspendHistoryResponse(value: unknown): WorkspaceSuspendHistoryPreviousResponse {
	return { hasMore: boolean(object(value, ['hasMore']).hasMore) };
}

export function readWorkspaceSuspendHistoryReset(value: unknown): WorkspaceSuspendHistoryResetResponse {
	return { available: boolean(object(value, ['available']).available) };
}

export function readWorkspaceSuspendAutoTerminated(value: unknown): WorkspaceSuspendAutoTerminatedEvent {
	const row = object(value, ['suspendedSessionId', 'reason']);
	return {
		suspendedSessionId: readSuspendedSessionId(row.suspendedSessionId),
		reason: choice(row.reason, SUSPENDED_TERMINATION_REASONS),
	};
}

export function readWorkspaceSuspendRevoked(value: unknown): WorkspaceSuspendRevokedEvent {
	const row = object(value, ['suspendedSessionId', 'generation', 'reason']);
	return {
		suspendedSessionId: readSuspendedSessionId(row.suspendedSessionId),
		generation: positive(row.generation),
		reason: choice(row.reason, SUSPENDED_REVOCATION_REASONS),
	};
}

export function readWorkspaceSuspendUnmarked(value: unknown): WorkspaceSuspendUnmarkedEvent {
	const row = object(value, ['suspendedSessionId', 'generation']);
	return {
		suspendedSessionId: readSuspendedSessionId(row.suspendedSessionId),
		generation: positive(row.generation),
	};
}
