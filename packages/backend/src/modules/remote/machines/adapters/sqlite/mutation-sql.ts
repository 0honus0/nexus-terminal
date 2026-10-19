import type { SqliteRuntime } from '../../../../../platform/storage/sqlite/sqlite-runtime.js';
import type { SqlExecutor } from '../../../../../platform/storage/sqlite/sql-types.js';
import type {
	MachineMutationStorage,
	StoredMutationClaim,
	StoredMutationObservation,
	StoredMutationRecoveryTask,
} from '../../storage/mutation-storage.js';
import { MutationStorageRefusal } from '../../storage/mutation-storage.js';
import { mutationRow, mutationEvidenceRow } from './mutation-row.js';

export class SqliteMachineMutationStorage implements MachineMutationStorage {
	private readIdentity: ((tx: SqlExecutor, digest: string) => Promise<number | null>) | null = null;

	constructor(private readonly db: SqliteRuntime) {}

	ownExecution(work: () => Promise<void>): Promise<void> {
		return this.db.withoutTransactionAdmission(work);
	}

	installTransactionIdentityReader(read: (tx: SqlExecutor, digest: string) => Promise<number | null>): void {
		if (this.readIdentity) {
			throw new Error('Mutation identity already installed');
		}
		this.readIdentity = read;
	}

	private identity(tx: SqlExecutor, digest: string): Promise<number | null> {
		if (!this.readIdentity) {
			throw new Error('Mutation identity not installed');
		}
		return this.readIdentity(tx, digest);
	}

	private async read(tx: SqlExecutor, id: string): Promise<StoredMutationObservation | null> {
		const row = await tx.one('SELECT * FROM remote_machine_mutation_claims WHERE id=?', [id]);
		if (!row) {
			return null;
		}
		const evidence = await tx.all(
			'SELECT * FROM remote_machine_mutation_evidence WHERE claim_id=? ORDER BY claim_revision',
			[id],
		);
		const locks = await tx.all(
			'SELECT resource_key,state,created_at FROM remote_machine_mutations WHERE claim_id=?',
			[id],
		);
		return mutationRow(row, evidence.map(mutationEvidenceRow), locks);
	}

	acquire(
		claim: StoredMutationClaim,
		maxClaims: number,
		maxHistory: number,
		authority?: { digest: string; admit(identity: number | null): void },
	): Promise<'acquired' | 'conflict' | 'limit_exceeded'> {
		return this.db.transaction(async (tx) => {
			if (authority) {
				authority.admit(await this.identity(tx, authority.digest));
			}
			if (await tx.one('SELECT id FROM remote_machine_mutation_claims WHERE id=?', [claim.id])) {
				return 'conflict';
			}
			for (const key of claim.keys) {
				if (await tx.one('SELECT claim_id FROM remote_machine_mutations WHERE resource_key=?', [key])) {
					return 'conflict';
				}
			}
			const resources = await tx.one('SELECT COUNT(*) AS total FROM remote_machine_mutations');
			const history = await tx.one('SELECT COUNT(*) AS total FROM remote_machine_mutation_claims');
			if (
				!resources ||
				!history ||
				typeof resources.total !== 'number' ||
				!Number.isSafeInteger(resources.total) ||
				typeof history.total !== 'number' ||
				!Number.isSafeInteger(history.total)
			) {
				throw new Error('Corrupt mutation count');
			}
			if (resources.total + claim.keys.length > maxClaims || history.total >= maxHistory) {
				return 'limit_exceeded';
			}
			await tx.run(
				"INSERT INTO remote_machine_mutation_claims(id,owner_id,origin,targets_json,resource_count,state,revision,created_at) VALUES(?,?,?,?,?,'held',1,?)",
				[claim.id, claim.ownerId, claim.origin, JSON.stringify(claim.targets), claim.keys.length, claim.now],
			);
			for (const key of claim.keys) {
				await tx.run(
					"INSERT INTO remote_machine_mutations(resource_key,claim_id,state,created_at) VALUES(?,?,'held',?)",
					[key, claim.id, claim.now],
				);
			}
			if (authority) {
				authority.admit(await this.identity(tx, authority.digest));
			}
			return 'acquired';
		});
	}

	settle(id: string, keys: string[], blocked: boolean, now: number): Promise<void> {
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
			const result = blocked
				? await tx.run(
						"UPDATE remote_machine_mutation_claims SET state='blocked',blocked_at=MAX(created_at,?),revision=revision+1 WHERE id=? AND state='held'",
						[now, id],
					)
				: await tx.run("DELETE FROM remote_machine_mutation_claims WHERE id=? AND state='held'", [id]);
			if (result.changes !== 1) {
				throw new Error('Mutation identity changed before settlement');
			}
		});
	}

	reconcile(now: number): Promise<void> {
		return this.db.transaction(async (tx) => {
			await tx.run("UPDATE remote_machine_mutations SET state='blocked' WHERE state='held'");
			await tx.run(
				"UPDATE remote_machine_mutation_claims SET state='blocked',blocked_at=MAX(created_at,?),revision=revision+1 WHERE state='held'",
				[now],
			);
		});
	}

	list(
		digest: string,
		after: string | null,
		limit: number,
		admit: (identity: number | null) => void,
	): Promise<StoredMutationObservation[]> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			const rows = await tx.all('SELECT id FROM remote_machine_mutation_claims WHERE id>? ORDER BY id LIMIT ?', [
				after ?? '',
				limit,
			]);
			const result: StoredMutationObservation[] = [];
			for (const row of rows) {
				if (typeof row.id !== 'string') {
					throw new Error('Corrupt mutation identity');
				}
				const value = await this.read(tx, row.id);
				if (!value) {
					throw new Error('Mutation disappeared in read transaction');
				}
				result.push(value);
			}
			admit(await this.identity(tx, digest));
			return result;
		});
	}

	get(
		digest: string,
		id: string,
		admit: (identity: number | null) => void,
	): Promise<StoredMutationObservation | null> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			const result = await this.read(tx, id);
			admit(await this.identity(tx, digest));
			return result;
		});
	}

	recover(
		digest: string,
		id: string,
		revision: number,
		admit: (identity: number | null) => void,
		decide: (current: StoredMutationObservation) => StoredMutationRecoveryTask,
	): Promise<StoredMutationObservation> {
		return this.db.transaction(async (tx) => {
			admit(await this.identity(tx, digest));
			const current = await this.read(tx, id);
			if (!current) {
				throw new MutationStorageRefusal('not_found');
			}
			if (current.revision !== revision) {
				throw new MutationStorageRefusal('version_conflict');
			}
			const task = decide(current);
			if (task.kind === 'evidence') {
				const e = task.evidence;
				await tx.run(
					'INSERT INTO remote_machine_mutation_evidence(id,claim_id,claim_revision,outcome,observed_at,note,recorded_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
					[e.id, id, e.claimRevision, e.outcome, e.observedAt, e.note, e.recordedBy, e.createdAt],
				);
			} else {
				const proof = await tx.one(
					'SELECT id FROM remote_machine_mutation_evidence WHERE id=? AND claim_id=? AND claim_revision=?',
					[task.evidenceId, id, revision - 1],
				);
				const claim = await tx.one('SELECT resource_count FROM remote_machine_mutation_claims WHERE id=?', [
					id,
				]);
				if (!proof || !claim || typeof claim.resource_count !== 'number') {
					throw new MutationStorageRefusal('version_conflict');
				}
				const result = await tx.run(
					"DELETE FROM remote_machine_mutations WHERE claim_id=? AND state='blocked'",
					[id],
				);
				if (result.changes !== claim.resource_count) {
					throw new Error('Mutation resources inconsistent during release');
				}
			}
			const changed =
				task.kind === 'release'
					? await tx.run(
							"UPDATE remote_machine_mutation_claims SET state='released',released_at=?,revision=revision+1 WHERE id=? AND revision=? AND state='blocked'",
							[task.releasedAt, id, revision],
						)
					: await tx.run(
							"UPDATE remote_machine_mutation_claims SET revision=revision+1 WHERE id=? AND revision=? AND state='blocked'",
							[id, revision],
						);
			if (changed.changes !== 1) {
				throw new MutationStorageRefusal('version_conflict');
			}
			const result = await this.read(tx, id);
			if (!result) {
				throw new Error('Mutation missing after recovery');
			}
			admit(await this.identity(tx, digest));
			return result;
		});
	}
}
