import { TargetFailure } from '../../target-failure.js';
import type { ConnectionImport } from '../model/import-types.js';
import type { ConnectionSnapshot } from '../../connections/model/connection-types.js';
import type { ConnectionImportModel } from '../model/import-model.js';
import { validateConnection } from '../../connections/model/connection-validation.js';
import { validateProxyMetadata } from '../../proxies/model/proxy-validation.js';

export class ConnectionImportService {
	constructor(private readonly model: ConnectionImportModel) {}

	importOne(command: ConnectionImport): Promise<ConnectionSnapshot> {
		const proxy = command.inlineProxy === undefined ? undefined : validateProxyMetadata({
			name: command.inlineProxy.name,
			type: command.inlineProxy.type,
			host: command.inlineProxy.host,
			port: command.inlineProxy.port,
			username: command.inlineProxy.username,
		});
		if (command.tagNames?.some((name) => !name.trim())) {
			throw new TargetFailure('invalid_input');
		}
		const normalized: ConnectionImport = { connection: validateConnection(command.connection) };
		if (proxy !== undefined) {
			normalized.inlineProxy = proxy;
		}
		if (command.tagNames !== undefined) {
			normalized.tagNames = [...command.tagNames];
		}
		return this.model.importOne(normalized);
	}

	// TODO: upload parsing, credential protection and post-commit audit.
}
