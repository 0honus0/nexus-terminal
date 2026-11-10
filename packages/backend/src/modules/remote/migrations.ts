export { retireMutationOrigin } from './machines/adapters/sqlite/mutation-origin-migration.js';

import type { SqlExecutor } from '../../platform/storage/sqlite/sql-types.js';
import { initializeDesktopCertificates } from './desktop/adapters/sqlite/certificate-schema.js';
import { initializeMachineMutations } from './machines/adapters/sqlite/mutation-schema.js';

export async function initializeRemoteSchema(tx: SqlExecutor): Promise<void> {
	await initializeMachineMutations(tx);
	await initializeDesktopCertificates(tx);
}
