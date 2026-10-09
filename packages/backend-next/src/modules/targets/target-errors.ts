import { SqliteFailure, SQLITE_CONSTRAINT_FOREIGNKEY } from '../../platform/storage/sqlite/sqlite-errors.js';

export type TargetErrorCode =
	| 'invalid_input'
	| 'reference_not_found'
	| 'reference_in_use'
	| 'conflict'
	| 'unresolvable'
	| 'storage_unavailable'
	| 'internal_failure';

/** Safe cross-module failure: never contains SQL, worker text or credential input. */
export class TargetOperationError extends Error {
	constructor(readonly code: TargetErrorCode) {
		super('Targets operation failed: ' + code);
		this.name = 'TargetOperationError';
	}
}

const invalidInputs = new Set([
	'Invalid ID',
	'Invalid ID/version',
	'Invalid target ID',
	'Invalid SSH key ID',
	'Invalid tag name',
	'Invalid inline proxy',
	'Invalid proxy route',
	'Invalid proxy metadata',
	'Invalid proxy username',
	'Invalid SSH key name',
	'Invalid SSH private key',
	'Invalid SSH password',
	'Invalid host key trust',
	'Invalid connection metadata',
	'Invalid type or route',
	'Invalid RemoteApp settings',
	'RemoteApp options are only valid on RDP connections with an application',
	'Empty name',
	'Empty proxy password',
	'Unexpected jump chain',
	'Jump requires SSH chain',
	'Duplicate relations',
	'Invalid SSH jump reference',
	'Invalid SSH jump chain',
]);
const unavailableTarget = new Set([
	'SSH credentials not configured',
	'Target is not SSH',
	'Invalid target route',
	'SSH jump chain empty',
	'Invalid jump order',
	'SSH jump chain cycle or excessive depth',
	'SSH jump chain contains a cycle or exceeds 16 hops',
]);
const inUse = new Set([
	'Tag is in use',
	'Connection is referenced as SSH jump',
	'Remove SSH credentials before changing connection type',
]);
const missing = new Set(['SSH target not found', 'SSH key not found']);

export function targetErrorCode(error: unknown): TargetErrorCode {
	if (error instanceof TargetOperationError) {
		return error.code;
	}
	if (error instanceof SqliteFailure) {
		if (error.kind === 'constraint') {
			if (error.sqliteCode === SQLITE_CONSTRAINT_FOREIGNKEY) {
				return 'reference_in_use';
			}
			return 'conflict';
		}
		if (
			error.kind === 'closed' ||
			error.kind === 'unavailable' ||
			error.kind === 'worker_exit' ||
			error.kind === 'commit_unknown' ||
			error.kind === 'rollback_failed' ||
			error.kind === 'busy'
		) {
			return 'storage_unavailable';
		}
		return 'internal_failure';
	}
	// Legacy domain code currently throws Error with constant messages. Recognize only
	// these exact, non-sensitive messages; everything else fails closed.
	if (error instanceof Error) {
		if (invalidInputs.has(error.message)) {
			return 'invalid_input';
		}
		if (missing.has(error.message)) {
			return 'reference_not_found';
		}
		if (inUse.has(error.message)) {
			return 'reference_in_use';
		}
		if (unavailableTarget.has(error.message)) {
			return 'unresolvable';
		}
		if (error.message === 'Encryption key required' || error.message === 'Credential authentication failed') {
			return 'unresolvable';
		}
	}
	return 'internal_failure';
}

/** Also catches synchronous Service validation failures. */
export async function targetsBoundary<T>(work: () => Promise<T> | T): Promise<T> {
	try {
		return await work();
	} catch (error) {
		throw new TargetOperationError(targetErrorCode(error));
	}
}
