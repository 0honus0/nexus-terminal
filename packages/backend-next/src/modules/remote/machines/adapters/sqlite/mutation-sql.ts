import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { MachineMutationStorage, StoredMutationClaim } from '../../storage/mutation-storage.js';

export class SqliteMachineMutationStorage implements MachineMutationStorage {
	constructor(private readonly db: SqliteRuntime) {}

	acquire(claim: StoredMutationClaim, maxClaims: number): Promise<'acquired' | 'conflict' | 'limit_exceeded'> {
		return this.db.transaction(async (tx) => {
			for (const key of claim.keys) {
				if (await tx.one('SELECT claim_id FROM remote_machine_mutations WHERE resource_key=?', [key])) {
					return 'conflict';
				}
			}
			const row = await tx.one('SELECT COUNT(*) AS total FROM remote_machine_mutations');
			if (!row || typeof row.total !== 'number' || !Number.isSafeInteger(row.total)) {
				throw new Error('Corrupt mutation count');
			}
			if (row.total + claim.keys.length > maxClaims) {
				return 'limit_exceeded';
			}
			for (const key of claim.keys) {
				await tx.run(
					"INSERT INTO remote_machine_mutations(resource_key,claim_id,state,created_at) VALUES(?,?,'held',?)",
					[key, claim.id, claim.now],
				);
			}
			return 'acquired';
		});
	}

	settle(id: string, keys: string[], blocked: boolean): Promise<void> {
		return this.db.transaction(async (tx) => {
			for (const key of keys) {
				const result = blocked
					? await tx.run(
							"UPDATE remote_machine_mutations SET state='blocked' WHERE resource_key=? AND claim_id=? AND state='held'",
							[key, id],
						)
					: await tx.run(
							"DELETE FROM remote_machine_mutations WHERE resource_key=? AND claim_id=? AND state='held'",
							[key, id],
						);
				if (result.changes !== 1) {
					throw new Error('Mutation claim changed before settlement');
				}
			}
		});
	}

	reconcile(): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run("UPDATE remote_machine_mutations SET state='blocked' WHERE state='held'");
		});
	}
}
