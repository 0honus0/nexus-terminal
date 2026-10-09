import type { ConnectionImport, ImportItemResult } from '../model/import-types.js';
import { ConnectionImportModel } from '../model/import-model.js';
import { validateConnection } from '../../connections/service/connection-validation.js';
import { targetErrorCode } from '../../target-errors.js';

export class ConnectionImportService {
	constructor(private readonly model: ConnectionImportModel) {}

	importOne(command: ConnectionImport) {
		if (command.inlineProxy) {
			const proxy = command.inlineProxy;
			if (
				!proxy.name.trim() ||
				!proxy.host.trim() ||
				!['HTTP', 'SOCKS5'].includes(proxy.type) ||
				!Number.isInteger(proxy.port) ||
				proxy.port < 1 ||
				proxy.port > 65535
			) {
				throw new Error('Invalid inline proxy');
			}
		}
		if (command.tagNames?.some((name) => !name.trim())) throw new Error('Invalid tag name');
		return this.model.importOne({ ...command, connection: validateConnection(command.connection) });
	}

	async importMany(commands: ConnectionImport[]): Promise<ImportItemResult[]> {
		const results: ImportItemResult[] = [];
		for (const command of commands) {
			try {
				const result = await this.importOne(command);
				results.push({ status: 'ok', id: result.id });
			} catch (error) {
				results.push({ status: 'error', code: targetErrorCode(error) });
			}
		}
		return results;
	}

	// TODO: upload parsing, credential protection and post-commit audit.
}
