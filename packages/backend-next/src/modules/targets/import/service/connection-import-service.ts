import { TargetFailure } from '../../target-failure.js';
import type { ConnectionImport } from '../model/import-types.js';
import type { ConnectionSnapshot } from '../../connections/model/connection-types.js';
import type { ConnectionImportModel } from '../model/import-model.js';
import { validateConnection } from '../../connections/model/connection-validation.js';

export class ConnectionImportService {
	constructor(private readonly model: ConnectionImportModel) {}

	importOne(command: ConnectionImport): Promise<ConnectionSnapshot> {
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
				throw new TargetFailure('invalid_input');
			}
		}
		if (command.tagNames?.some((name) => !name.trim())) {
			throw new TargetFailure('invalid_input');
		}
		return this.model.importOne({ ...command, connection: validateConnection(command.connection) });
	}

	// TODO: upload parsing, credential protection and post-commit audit.
}
