import type { BackupImportResponse } from '@nexus-terminal/shared/system/backups/http';
import type { RestoreReceipt } from './backup-types';

export function fromRestoreReceipt(value: BackupImportResponse): RestoreReceipt {
	return {
		restoredTables: value.restoredTables,
		restoredRows: value.restoredRows,
		restoredFiles: value.restoredFiles,
		cleanupPending: value.cleanupPending,
	};
}
