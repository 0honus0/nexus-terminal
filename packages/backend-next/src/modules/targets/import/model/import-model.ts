import type { ConnectionImportStorage } from '../storage/import-storage.js';
import type { ConnectionImport } from './import-types.js';
import { fromStorage, toStorage } from '../../connections/model/connection-mapper.js';

export class ConnectionImportModel {
	constructor(private readonly storage: Readonly<ConnectionImportStorage>) {}

	async importOne(command: ConnectionImport) {
		return fromStorage(
			await this.storage.importOne({
				connection: toStorage(command.connection),
				...(command.inlineProxy ? { inlineProxy: { ...command.inlineProxy } } : {}),
				...(command.tagNames ? { tagNames: [...command.tagNames] } : {}),
			}),
		);
	}
}
