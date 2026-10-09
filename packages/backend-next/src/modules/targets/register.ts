import type { SqliteRuntime } from '../../platform/storage/sqlite/sqlite-runtime.js';
import {
	ConnectionSqliteAdapter,
	insertConnectionInTransaction,
} from './connections/adapters/sqlite/connection-sql.js';
import { findOrCreateProxy } from './proxies/adapters/sqlite/proxy-sql.js';
import { findOrCreateTag } from './tags/adapters/sqlite/tag-sql.js';
import { SqliteConnectionImportAdapter } from './import/adapters/sqlite/import-sql.js';
import { ConnectionImportService } from './import/service/connection-import-service.js';
import { ConnectionImportModel } from './import/model/import-model.js';
import { ConnectionModel } from './connections/model/connection-model.js';
import { ConnectionService } from './connections/service/connection-service.js';
import type { ConnectionCatalog, ConnectionMutations } from './public.js';

/** One instance-scoped composition point for the Targets business domain. */
export function registerTargets({ sqlite }: { sqlite: SqliteRuntime }): {
	publicApi: ConnectionCatalog & ConnectionMutations;
} {
	const storage = new ConnectionSqliteAdapter(sqlite);
	const imports = new SqliteConnectionImportAdapter(sqlite, {
		connections: { insert: insertConnectionInTransaction },
		proxies: { findOrCreate: findOrCreateProxy },
		tags: { findOrCreate: findOrCreateTag },
	});
	const model = new ConnectionModel(storage);
	const service = new ConnectionService(model);
	const importService = new ConnectionImportService(new ConnectionImportModel(imports));

	return {
		publicApi: {
			list: () => service.list(),

			get: (id) => service.get(id),

			create: (data) => service.create(data),

			update: (id, version, changes) => service.update(id, version, changes),

			clone: (id, name) => service.clone(id, name),

			delete: (id) => service.delete(id),

			setTags: (id, version, tags) => service.setTags(id, version, tags),

			importOne: (command) => importService.importOne(command),

			importMany: (commands) => importService.importMany(commands),
		},
	};
}
