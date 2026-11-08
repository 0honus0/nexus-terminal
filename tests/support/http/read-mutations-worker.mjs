import { parentPort, workerData } from 'node:worker_threads';
import { SqliteRuntime } from '../../../packages/backend/dist/platform/storage/sqlite/sqlite-runtime.js';
import { SqliteMachineMutationStorage } from '../../../packages/backend/dist/modules/remote/machines/adapters/sqlite/mutation-sql.js';
const sqlite = SqliteRuntime.open(workerData.database);
try {
	const storage = new SqliteMachineMutationStorage(sqlite);
	storage.installTransactionIdentityReader(async () => 1);
	const claims = [];
	for (const id of workerData.ids) {
		const claim = await storage.get('fixture-read', id, () => {});
		claims.push({
			id: claim.id,
			state: claim.state,
			revision: claim.revision,
			evidenceCount: claim.evidence.length,
		});
	}
	parentPort.postMessage(claims);
} finally {
	await sqlite.close();
	parentPort.close();
}
