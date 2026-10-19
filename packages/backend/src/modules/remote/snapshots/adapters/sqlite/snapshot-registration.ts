import type { SnapshotRegistration, SnapshotTable } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import {
	transferSnapshotRow,
	restoreSnapshotRow,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';
import { SnapshotFailure } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import { mutationRow, mutationEvidenceRow } from '../../../machines/adapters/sqlite/mutation-row.js';
import type { SqlRow } from '../../../../../platform/storage/sqlite/worker-types.js';

function groupByClaim(rows: readonly SqlRow[], ids: ReadonlySet<string>): Map<string, SqlRow[]> {
	const groups = new Map<string, SqlRow[]>();
	for (const row of rows) {
		if (typeof row.claim_id !== 'string' || !ids.has(row.claim_id)) {
			throw new SnapshotFailure('unavailable');
		}
		const group = groups.get(row.claim_id) ?? [];
		group.push(row);
		groups.set(row.claim_id, group);
	}
	return groups;
}

/** Fixed current table/column coverage owned by remote; no runtime schema discovery. */
export function registerRemoteSnapshot(
	admitCapacity: (claims: number, resources: number) => void,
): SnapshotRegistration {
	const tables: SnapshotTable[] = [
		{
			name: 'remote_machine_mutation_claims',
			columns: [
				'id',
				'owner_id',
				'origin',
				'targets_json',
				'resource_count',
				'state',
				'revision',
				'created_at',
				'blocked_at',
				'released_at',
			],
		},
		{ name: 'remote_machine_mutations', columns: ['resource_key', 'claim_id', 'state', 'created_at'] },
		{
			name: 'remote_machine_mutation_evidence',
			partitionColumn: 'recorded_by',
			columns: [
				'id',
				'claim_id',
				'claim_revision',
				'outcome',
				'observed_at',
				'note',
				'recorded_by',
				'created_at',
			],
		},
	];
	return {
		tables,

		validate(rows) {
			const claims = rows.get('remote_machine_mutation_claims') ?? [];
			const evidence = rows.get('remote_machine_mutation_evidence') ?? [];
			const locks = rows.get('remote_machine_mutations') ?? [];
			admitCapacity(claims.length, locks.length);
			const ids = new Set(
				claims.map((row) => {
					if (typeof row.id !== 'string') {
						throw new SnapshotFailure('unavailable');
					}
					return row.id;
				}),
			);
			const proofsByClaim = groupByClaim(evidence, ids),
				locksByClaim = groupByClaim(locks, ids);
			for (const raw of claims) {
				if (typeof raw.id !== 'string') {
					throw new SnapshotFailure('unavailable');
				}
				const proofs = (proofsByClaim.get(raw.id) ?? [])
					.map(mutationEvidenceRow)
					.sort((a, b) => a.claimRevision - b.claimRevision);
				mutationRow(raw, proofs, locksByClaim.get(raw.id) ?? []);
			}
		},

		transfer(table, row) {
			const scopes = new Map<string, string>();
			return transferSnapshotRow(row, table.columns, scopes, null);
		},

		restore(table, row) {
			return restoreSnapshotRow(row, table.columns, new Map(), null);
		},

		files() {
			return [];
		},
	};
}
