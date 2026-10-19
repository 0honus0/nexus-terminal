import type { TargetImportErrorCode } from '@nexus-terminal/shared/targets/connections/values';
import type { ConnectionImport, ImportItemResult } from './model/import-types.js';
import type { ConnectionSnapshot } from '../connections/model/connection-types.js';
import { TargetFailure } from '../target-failure.js';

function importFailure(error: unknown): TargetImportErrorCode {
	if (!(error instanceof TargetFailure)) {
		return 'internal_failure';
	}
	switch (error.code) {
		case 'unauthenticated':
		case 'forbidden':
			throw error;
		default:
			return error.code;
	}
}

/** Each item has its own transaction; authentication loss stops the remaining batch. */
export async function importConnections(
	commands: readonly ConnectionImport[],
	importOne: (command: ConnectionImport) => Promise<ConnectionSnapshot>,
): Promise<ImportItemResult[]> {
	const results: ImportItemResult[] = [];
	for (const command of commands) {
		try {
			const result = await importOne(command);
			results.push({ status: 'ok', id: result.id });
		} catch (error) {
			results.push({ status: 'error', code: importFailure(error) });
		}
	}
	return results;
}
