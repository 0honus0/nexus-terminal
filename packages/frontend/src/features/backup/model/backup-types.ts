import type { BackupErrorCode } from '@nexus-terminal/shared/system/backups/values';
import type { HttpRequestFailureCode, RequestOutcome } from '@/client/http/request-failure';

export interface RestoreReceipt {
	restoredTables: number;
	restoredRows: number;
	restoredFiles: number;
	cleanupPending: boolean;
}

export type RestoreState =
	| { status: 'idle' }
	| { status: 'restoring' }
	| { status: 'restored'; receipt: RestoreReceipt }
	| { status: 'unknown' };

export class BackupRequestFailure extends Error {
	constructor(
		readonly code: BackupErrorCode | HttpRequestFailureCode,
		readonly outcome: RequestOutcome,
		options?: ErrorOptions,
	) {
		super('Backup operation failed', options);
		this.name = 'BackupRequestFailure';
	}
}
