import type { SqlExecutor } from '../sql-types.js';
import type { SqlRow } from '../worker-types.js';
import type { SqlParameter } from '../worker-types.js';
import type { SqliteRuntime } from '../sqlite-runtime.js';
import { SnapshotFailure, type SnapshotTable, type SnapshotRestoreReceipt } from '../snapshot-types.js';
import { snapshotIdentifier } from './snapshot-row.js';

/** Technical commit evidence is never part of the portable product dataset. */
export async function initializeSnapshotRestoreSchema(tx: SqlExecutor): Promise<void> {
	await tx.exec(`CREATE TABLE snapshot_restore_state (
		id INTEGER PRIMARY KEY CHECK(id=1),
		restore_id TEXT NOT NULL,
		initialized INTEGER NOT NULL CHECK(initialized IN(0,1))
	)`);
}

export class SqliteSnapshotRestore {
	constructor(private readonly db: SqliteRuntime) {}

	async committed(restoreId: string): Promise<boolean> {
		const marker = await this.db.one('SELECT restore_id FROM snapshot_restore_state WHERE id=1');
		if (!marker) {
			return false;
		}
		if (typeof marker.restore_id !== 'string' || !/^[a-f0-9-]{36}$/u.test(marker.restore_id)) {
			throw new SnapshotFailure('unavailable');
		}
		return marker.restore_id === restoreId;
	}

	async needsInitialization(): Promise<boolean> {
		const marker = await this.db.one('SELECT initialized FROM snapshot_restore_state WHERE id=1');
		if (marker && marker.initialized !== 0 && marker.initialized !== 1) {
			throw new SnapshotFailure('unavailable');
		}
		return marker?.initialized === 0;
	}

	async initialized(): Promise<void> {
		await this.db.run('UPDATE snapshot_restore_state SET initialized=1 WHERE id=1');
	}

	commit(
		restoreId: string,
		tables: readonly SnapshotTable[],
		rows: ReadonlyMap<string, readonly SqlRow[]>,
		signal: AbortSignal,
	): Promise<SnapshotRestoreReceipt> {
		return this.db.transaction(async (tx) => {
			await tx.exec('PRAGMA defer_foreign_keys=ON');
			// Deferred FKs do not defer ON DELETE CASCADE/RESTRICT. Remove descendants first.
			const names = new Set(tables.map((table) => table.name));
			const children = new Map<string, Set<string>>();
			for (const table of tables) {
				const references = await tx.all(`PRAGMA foreign_key_list(${snapshotIdentifier(table.name)})`);
				for (const reference of references) {
					if (
						typeof reference.table === 'string' &&
						names.has(reference.table) &&
						reference.table !== table.name
					) {
						const dependents = children.get(reference.table) ?? new Set<string>();
						dependents.add(table.name);
						children.set(reference.table, dependents);
					}
				}
			}
			const visited = new Set<string>();
			const active = new Set<string>();
			const order: string[] = [];

			const visit = (name: string): void => {
				if (visited.has(name)) {
					return;
				}
				if (active.has(name)) {
					throw new SnapshotFailure('invalid_registration');
				}
				active.add(name);
				for (const child of children.get(name) ?? []) {
					visit(child);
				}
				active.delete(name);
				visited.add(name);
				order.push(name);
			};

			for (const name of names) {
				visit(name);
			}
			for (const name of order) {
				signal.throwIfAborted();
				await tx.run(`DELETE FROM ${snapshotIdentifier(name)}`);
			}
			let restoredRows = 0;
			for (const table of tables) {
				const entries = rows.get(table.name);
				if (!entries) {
					throw new SnapshotFailure('invalid_archive');
				}
				const statement = `INSERT INTO ${snapshotIdentifier(table.name)}(${table.columns.map(snapshotIdentifier).join(',')}) VALUES(${table.columns.map(() => '?').join(',')})`;
				for (const row of entries) {
					signal.throwIfAborted();
					const values: SqlParameter[] = table.columns.map((column) => {
						const value = row[column];
						if (
							value !== null &&
							typeof value !== 'string' &&
							(typeof value !== 'number' || !Number.isFinite(value))
						) {
							throw new SnapshotFailure('invalid_archive');
						}
						return value;
					});
					await tx.run(statement, values);
					restoredRows++;
				}
			}
			if (await tx.one('PRAGMA foreign_key_check')) {
				throw new SnapshotFailure('invalid_archive');
			}
			await tx.run(
				'INSERT INTO snapshot_restore_state(id,restore_id,initialized) VALUES(1,?,0) ON CONFLICT(id) DO UPDATE SET restore_id=excluded.restore_id,initialized=0',
				[restoreId],
			);
			signal.throwIfAborted();
			return { restoredTables: tables.length, restoredRows, restoredFiles: 0, cleanupPending: false };
		});
	}
}
