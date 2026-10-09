import type { ImportConnectionCommand, ConnectionImportStorage } from '../storage/import-storage.js';
import type { ConnectionImport } from './import-types.js';
import { fromStorage, toStorage } from '../../connections/model/connection-mapper.js';

export class ConnectionImportModel {
	constructor(private readonly storage: Readonly<ConnectionImportStorage>) {}

	async importOne(command: ConnectionImport) {
		const input: ImportConnectionCommand = { connection: toStorage(command.connection) };
		if (command.inlineProxy !== undefined) {
			const proxy = command.inlineProxy;
			input.inlineProxy = {
				name: proxy.name,
				type: proxy.type,
				host: proxy.host,
				port: proxy.port,
				username: proxy.username,
			};
		}
		if (command.tagNames !== undefined) {
			input.tagNames = [...command.tagNames];
		}
		return fromStorage(await this.storage.importOne(input));
	}
}
