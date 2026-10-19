import { TARGET_CONNECTION_NAME_MAX_BYTES } from '../../targets/connections/values.js';
import {
	SUSPENDED_SESSION_ID_PATTERN,
	SUSPENDED_SESSION_STATUSES,
	SUSPENDED_OWNERSHIP_STATES,
	SUSPENDED_HTTP_ERROR_CODES,
	SUSPENDED_CATALOG_MAX_ENTRIES,
	SUSPENDED_CATALOG_MAX_JSON_BYTES,
	SUSPENDED_MANAGEMENT_MAX_JSON_BYTES,
	WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS,
} from './values.js';
import type {
	SuspendedSessionView,
	SuspendedSessionRenameRequest,
	SuspendedSessionRenameResponse,
	SuspendedSessionTerminatedResponse,
	SuspendedSessionRemovedResponse,
	SuspendedSessionHttpError,
} from './http.js';
import { isWellFormedFileText } from '../files/text-codec.js';

export class InvalidSuspendedHttpPayload extends Error {
	constructor() {
		super('Invalid suspended session HTTP payload');
	}
}

function reject(): never {
	throw new InvalidSuspendedHttpPayload();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!isRecord(value)) {
		return reject();
	}
	if (Object.keys(value).some((key) => !fields.includes(key))) {
		return reject();
	}
	return value;
}

function budget(value: unknown, max: number): void {
	const encoded = JSON.stringify(value);
	if (encoded === undefined || new TextEncoder().encode(encoded).length > max) {
		reject();
	}
}

function text(value: unknown): string {
	if (typeof value !== 'string' || !isWellFormedFileText(value)) {
		return reject();
	}
	return value;
}

function integer(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		return reject();
	}
	return value;
}

function choice<T extends string>(value: unknown, values: readonly T[]): T {
	for (const option of values) {
		if (value === option) {
			return option;
		}
	}
	return reject();
}

function timestamp(value: unknown): string {
	const result = text(value);
	const milliseconds = Date.parse(result);
	if (!Number.isFinite(milliseconds) || milliseconds < 0 || new Date(milliseconds).toISOString() !== result) {
		return reject();
	}
	return result;
}

export function readSuspendedSessionId(value: unknown): string {
	const result = text(value);
	if (!SUSPENDED_SESSION_ID_PATTERN.test(result)) {
		return reject();
	}
	return result;
}

function view(value: unknown): SuspendedSessionView {
	const row = object(value, [
		'id',
		'originalWorkspaceId',
		'connectionId',
		'connectionName',
		'suspendedAt',
		'customName',
		'status',
		'ownershipState',
		'ownershipGeneration',
		'ownershipLeaseExpiresAt',
		'attachedWorkspaceId',
		'disconnectedAt',
	]);
	const status = choice(row.status, SUSPENDED_SESSION_STATUSES);
	const ownershipState = choice(row.ownershipState, SUSPENDED_OWNERSHIP_STATES);
	const result: SuspendedSessionView = {
		id: readSuspendedSessionId(row.id),
		originalWorkspaceId: readSuspendedSessionId(row.originalWorkspaceId),
		connectionId: integer(row.connectionId),
		connectionName: text(row.connectionName),
		suspendedAt: timestamp(row.suspendedAt),
		status,
		ownershipState,
		ownershipGeneration: integer(row.ownershipGeneration),
	};
	if (new TextEncoder().encode(result.connectionName).length > TARGET_CONNECTION_NAME_MAX_BYTES) {
		return reject();
	}
	if (row.customName !== undefined) {
		result.customName = canonicalName(row.customName);
	}
	if (row.ownershipLeaseExpiresAt !== undefined) {
		result.ownershipLeaseExpiresAt = integer(row.ownershipLeaseExpiresAt);
	}
	if (row.attachedWorkspaceId !== undefined) {
		result.attachedWorkspaceId = readSuspendedSessionId(row.attachedWorkspaceId);
	}
	if (row.disconnectedAt !== undefined) {
		result.disconnectedAt = timestamp(row.disconnectedAt);
	}
	const hasLease = result.ownershipLeaseExpiresAt !== undefined;
	const hasAttachment = result.attachedWorkspaceId !== undefined;
	if (
		hasLease !== hasAttachment ||
		(ownershipState === 'attached' && !hasLease) ||
		(ownershipState === 'available' && hasLease) ||
		(status === 'disconnected' && (ownershipState !== 'available' || hasLease || !result.disconnectedAt)) ||
		(status === 'active' && result.disconnectedAt !== undefined) ||
		(result.disconnectedAt !== undefined && Date.parse(result.disconnectedAt) < Date.parse(result.suspendedAt))
	) {
		return reject();
	}
	return result;
}

export function readSuspendedSessionCatalog(value: unknown): SuspendedSessionView[] {
	budget(value, SUSPENDED_CATALOG_MAX_JSON_BYTES);
	if (!Array.isArray(value) || value.length > SUSPENDED_CATALOG_MAX_ENTRIES) {
		return reject();
	}
	const result = value.map(view);
	if (new Set(result.map((item) => item.id)).size !== result.length) {
		return reject();
	}
	return result;
}

export function readSuspendedSessionRename(value: unknown): SuspendedSessionRenameRequest {
	budget(value, SUSPENDED_MANAGEMENT_MAX_JSON_BYTES);
	const name = text(object(value, ['customName']).customName).trim();
	if (name.length > WORKSPACE_SUSPEND_MAX_NAME_CHARACTERS || /[\u0000-\u001f\u007f-\u009f]/u.test(name)) {
		return reject();
	}
	return { customName: name };
}

function canonicalName(value: unknown): string {
	const name = readSuspendedSessionRename({ customName: value }).customName;
	if (name !== value) {
		return reject();
	}
	return name;
}

export function readSuspendedSessionRenameResponse(value: unknown): SuspendedSessionRenameResponse {
	budget(value, SUSPENDED_MANAGEMENT_MAX_JSON_BYTES);
	const row = object(value, ['message', 'customName']);
	if (row.message !== 'Suspended session name updated.') {
		return reject();
	}
	return { message: row.message, customName: canonicalName(row.customName) };
}

export function readSuspendedSessionTerminated(value: unknown): SuspendedSessionTerminatedResponse {
	budget(value, SUSPENDED_MANAGEMENT_MAX_JSON_BYTES);
	const row = object(value, ['message']);
	if (row.message !== 'Suspended session terminated and removed.') {
		return reject();
	}
	return { message: row.message };
}

export function readSuspendedSessionRemoved(value: unknown): SuspendedSessionRemovedResponse {
	const row = object(value, ['message']);
	if (row.message !== 'Disconnected suspended entry removed.') {
		return reject();
	}
	return { message: row.message };
}

export function readSuspendedSessionError(value: unknown): SuspendedSessionHttpError {
	budget(value, SUSPENDED_MANAGEMENT_MAX_JSON_BYTES);
	return { code: choice(object(value, ['code']).code, SUSPENDED_HTTP_ERROR_CODES) };
}
