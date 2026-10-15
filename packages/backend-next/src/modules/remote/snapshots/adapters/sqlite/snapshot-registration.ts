import type { SnapshotRegistration, SnapshotTable } from '../../../../../platform/storage/sqlite/snapshot-types.js';
import {
	transferSnapshotRow,
	restoreSnapshotRow,
} from '../../../../../platform/storage/sqlite/adapters/snapshot-row.js';

/** Fixed current table/column coverage owned by remote; no runtime schema discovery. */
export function registerRemoteSnapshot(): SnapshotRegistration {
	const tables: SnapshotTable[] = [
		{ name: 'remote_machine_mutations', columns: ['resource_key', 'claim_id', 'state', 'created_at'] },
	];
	return {
		tables,

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
