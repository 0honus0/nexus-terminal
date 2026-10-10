import type { ConnectionImport, ImportItemResult } from './model/import-types.js';
import type { ConnectionSnapshot } from '../connections/model/connection-types.js';
import { targetErrorCode } from '../target-errors.js';

/** Each item has its own transaction and safe failure projection; later items still run. */
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
			results.push({ status: 'error', code: targetErrorCode(error) });
		}
	}
	return results;
}
