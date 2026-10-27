import { SecretBoxFailure } from '../../../platform/security/secret-box.js';
import type { SecretBox } from '../../../platform/security/secret-box.js';
import { SqliteFailure, SQLITE_CONSTRAINT_FOREIGNKEY } from '../../../platform/storage/sqlite/sqlite-errors.js';
import { TargetFailure } from '../target-failure.js';
import { TargetReferenceInUse } from '../storage/target-storage-refusal.js';

/** Synchronous encryption can fail before a storage Promise exists. */
export function encryptTargetSecret(secrets: SecretBox | null, value: string, scope: string): string {
	if (!secrets) {
		throw new TargetFailure('unresolvable');
	}
	try {
		return secrets.encrypt(value, scope);
	} catch (cause) {
		throw new TargetFailure('internal_failure', { cause });
	}
}

/** Module-wide Model conversion; application refusals from transaction callbacks remain intact. */
export function targetModelFailure(cause: unknown): never {
	if (cause instanceof TargetReferenceInUse) {
		throw new TargetFailure('reference_in_use', { cause });
	}
	if (cause instanceof SecretBoxFailure) {
		throw new TargetFailure('unresolvable', { cause });
	}
	if (cause instanceof SqliteFailure) {
		switch (cause.kind) {
			case 'commit_unknown':
			case 'rollback_failed':
				throw new TargetFailure('operation_unknown', { cause });
			case 'constraint':
				throw new TargetFailure(
					cause.sqliteCode === SQLITE_CONSTRAINT_FOREIGNKEY ? 'reference_in_use' : 'conflict',
					{ cause },
				);
			case 'closed':
			case 'unavailable':
			case 'worker_exit':
			case 'busy':
				throw new TargetFailure('storage_unavailable', { cause });
			case 'sql':
			case 'transaction':
				throw new TargetFailure('internal_failure', { cause });
		}
	}
	throw cause;
}
