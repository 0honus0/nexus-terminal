import { TargetFailure } from './target-failure.js';
import { SecretBoxFailure } from '../../platform/security/secret-box.js';
import { SqliteFailure, SQLITE_CONSTRAINT_FOREIGNKEY } from '../../platform/storage/sqlite/sqlite-errors.js';

import type { TargetErrorCode } from '@nexus-terminal/shared/targets/values';

/** Safe cross-module failure: never contains SQL, worker text or credential input. */
export class TargetOperationError extends Error {
	constructor(readonly code: TargetErrorCode) {
		super('Targets operation failed: ' + code);
		this.name = 'TargetOperationError';
	}
}

export function targetErrorCode(error: unknown): TargetErrorCode {
	if (error instanceof TargetOperationError || error instanceof TargetFailure) {
		return error.code;
	}
	if (error instanceof SecretBoxFailure) {
		return 'unresolvable';
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
