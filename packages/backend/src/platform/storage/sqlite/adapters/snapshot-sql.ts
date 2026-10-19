import { createHash } from 'node:crypto';
import type { BlobStore } from '../../../blobs/blob-store.js';
import { BlobFailure } from '../../../blobs/blob-store.js';
import type { SqliteRuntime } from '../sqlite-runtime.js';
import type { SqlParameter, SqlRow } from '../worker-types.js';
import type {
	SnapshotCollector,
	SnapshotRegistration,
	SnapshotTable,
	SnapshotFileReference,
	PreparedSnapshot,
	SnapshotRestoreReceipt,
} from '../snapshot-types.js';
import { SnapshotFailure } from '../snapshot-types.js';
import { SqliteSchemaAdapter } from './schema-sql.js';
import { decodeSnapshotArchive, type SnapshotArchive } from './snapshot-archive.js';
import { snapshotIdentifier as identifier } from './snapshot-row.js';
import { SqliteSnapshotValidation } from './snapshot-validation-sql.js';
import { NativeSnapshotRestoreFiles } from './snapshot-restore-files.js';
import { SqliteSnapshotRestore } from './snapshot-restore-sql.js';

function project(table: SnapshotTable, row: SqlRow, extraColumns = 0): SqlRow {
	if (Object.keys(row).length !== table.columns.length + extraColumns) {
		throw new SnapshotFailure('invalid_registration');
	}
	const result: SqlRow = {};
	for (const key of table.columns) {
		const value = row[key];
		if (value !== null && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
			throw new SnapshotFailure('unavailable');
		}
		result[key] = value;
	}
	return result;
}

/** Opaque collection capability: SQL, raw rows and content handles never reach the application. */
export class SqliteSnapshotCollector implements SnapshotCollector {
	private readonly tables: readonly SnapshotTable[];

	constructor(
		private readonly db: SqliteRuntime,
		private readonly registrations: readonly SnapshotRegistration[],
		private readonly roots: ReadonlyMap<string, BlobStore>,
		private readonly maxBytes: number,
		private readonly schemaSignature: string,
		private readonly excludedTables: readonly string[],
		private readonly restoreFiles: NativeSnapshotRestoreFiles,
	) {
		this.tables = registrations.flatMap((registration) => registration.tables);
		if (new Set(this.tables.map((table) => table.name)).size !== this.tables.length) {
			throw new SnapshotFailure('invalid_registration');
		}
		for (const table of this.tables) {
			identifier(table.name);
			if (!table.columns.length || new Set(table.columns).size !== table.columns.length) {
				throw new SnapshotFailure('invalid_registration');
			}
			if (
				(table.partitionColumn && !table.columns.includes(table.partitionColumn)) ||
				(table.allowNullPartition && !table.partitionColumn)
			) {
				throw new SnapshotFailure('invalid_registration');
			}
			table.columns.forEach(identifier);
		}
	}

	private read(signal: AbortSignal): Promise<Map<string, SqlRow[]>> {
		return this.db.transaction(async (tx) => {
			const expected = new Set([
				'schema_version',
				'snapshot_restore_state',
				...this.tables.map((table) => table.name),
				...this.excludedTables,
				...this.registrations.flatMap((registration) => registration.excludedTables ?? []),
			]);
			const versions = await new SqliteSchemaAdapter(tx).versions();
			if (versions.length !== 1 || versions[0].version !== 1 || versions[0].signature !== this.schemaSignature) {
				throw new SnapshotFailure('invalid_registration');
			}
			const actual = await tx.all(
				"SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'",
			);
			if (
				actual.length !== expected.size ||
				actual.some((row) => typeof row.name !== 'string' || !expected.has(row.name))
			) {
				throw new SnapshotFailure('invalid_registration');
			}
			if (await tx.one('PRAGMA foreign_key_check')) {
				throw new SnapshotFailure('unavailable');
			}
			const result = new Map<string, SqlRow[]>();
			let bytes = 0;
			for (const table of this.tables) {
				signal.throwIfAborted();
				const declared = await tx.all(`PRAGMA table_info(${identifier(table.name)})`);
				if (
					declared.length !== table.columns.length ||
					declared.some((column, index) => column.name !== table.columns[index])
				) {
					throw new SnapshotFailure('invalid_registration');
				}
				const columns = table.columns.map(identifier).join(',');
				// All registered current tables have rowid. Keyset avoids repeated full-table sorting/scanning.
				const rows: SqlRow[] = [];
				let after: number | null = null;
				for (;;) {
					signal.throwIfAborted();
					const where = after === null ? '' : ' WHERE rowid > ?';
					const page = await tx.all(
						`SELECT rowid AS __snapshot_position,${columns} FROM ${identifier(table.name)}${where} ORDER BY rowid LIMIT 128`,
						after === null ? [] : [after],
					);
					for (const raw of page) {
						const position = raw.__snapshot_position;
						if (
							typeof position !== 'number' ||
							!Number.isSafeInteger(position) ||
							(after !== null && position <= after)
						) {
							throw new SnapshotFailure('unavailable');
						}
						after = position;
						const row = project(table, raw, 1);
						bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
						if (bytes > this.maxBytes) {
							throw new SnapshotFailure('limit_exceeded');
						}
						rows.push(row);
					}
					if (page.length < 128) {
						break;
					}
				}
				result.set(table.name, rows);
			}
			for (const registration of this.registrations) {
				signal.throwIfAborted();
				await registration.validateStorage?.(
					{
						all: (sql, params) => tx.all(sql, params),

						one: (sql, params) => tx.one(sql, params),
					},
					new Map(registration.tables.map((table) => [table.name, result.get(table.name) ?? []])),
					signal,
				);
			}
			return result;
		});
	}

	private fingerprint(tables: Map<string, SqlRow[]>): string {
		const digest = createHash('sha256');
		for (const [name, rows] of tables) {
			digest.update(JSON.stringify([name, rows]));
		}
		return digest.digest('hex');
	}

	async collect(signal: AbortSignal): Promise<Uint8Array> {
		try {
			const source = await this.read(signal);
			const tables: { name: string; columns: string[]; rows: SqlRow[] }[] = [];
			const refs = new Map<string, SnapshotFileReference>();
			for (const registration of this.registrations) {
				registration.validate?.(
					new Map(registration.tables.map((table) => [table.name, source.get(table.name) ?? []])),
				);
				for (const table of registration.tables) {
					const rows = source.get(table.name);
					if (!rows) {
						throw new SnapshotFailure('invalid_registration');
					}
					tables.push({
						name: table.name,
						columns: table.columns.map((column) => column),
						rows: rows.map((row) => project(table, registration.transfer(table, row))),
					});
					for (const row of rows) {
						for (const ref of registration.files(table.name, row)) {
							const key = ref.root + '/' + ref.key;
							const previous = refs.get(key);
							if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) {
								throw new SnapshotFailure('unavailable');
							}
							refs.set(key, { root: ref.root, key: ref.key, bytes: ref.bytes, sha256: ref.sha256 });
						}
					}
				}
			}
			let remaining =
				this.maxBytes -
				Buffer.byteLength(
					JSON.stringify({
						format: 'registered-snapshot',
						version: 1,
						schemaSignature: this.schemaSignature,
						tables,
						files: [],
					}),
				);
			const files: { root: string; key: string; bytes: number; sha256: string; base64: string }[] = [];
			for (const ref of refs.values()) {
				signal.throwIfAborted();
				const root = this.roots.get(ref.root);
				if (!root || !Number.isSafeInteger(ref.bytes) || ref.bytes < 0 || !/^[a-f0-9]{64}$/u.test(ref.sha256)) {
					throw new SnapshotFailure('invalid_registration');
				}
				const overhead =
					Buffer.byteLength(
						JSON.stringify({
							root: ref.root,
							key: ref.key,
							bytes: ref.bytes,
							sha256: ref.sha256,
							base64: '',
						}),
					) + 1;
				remaining -= Math.ceil(ref.bytes / 3) * 4 + overhead;
				if (remaining < 0) {
					throw new SnapshotFailure('limit_exceeded');
				}
				if ((await root.size(ref.key)) !== ref.bytes) {
					throw new SnapshotFailure('source_changed');
				}
				const chunks: Uint8Array[] = [];
				let size = 0;
				const digest = createHash('sha256');
				if (ref.bytes) {
					for await (const chunk of root.read(ref.key, { start: 0, endInclusive: ref.bytes - 1 }, signal)) {
						size += chunk.byteLength;
						if (size > ref.bytes) {
							throw new SnapshotFailure('source_changed');
						}
						chunks.push(chunk);
						digest.update(chunk);
					}
				}
				if (
					size !== ref.bytes ||
					digest.digest('hex') !== ref.sha256 ||
					(await root.size(ref.key)) !== ref.bytes
				) {
					throw new SnapshotFailure('source_changed');
				}
				const content = Buffer.concat(chunks);
				for (const registration of this.registrations) {
					await registration.validateFile?.(
						ref,
						content,
						new Map(registration.tables.map((table) => [table.name, source.get(table.name) ?? []])),
					);
				}
				files.push({
					root: ref.root,
					key: ref.key,
					bytes: ref.bytes,
					sha256: ref.sha256,
					base64: content.toString('base64'),
				});
			}
			if (this.fingerprint(source) !== this.fingerprint(await this.read(signal))) {
				throw new SnapshotFailure('source_changed');
			}
			const bytes = Buffer.from(
				JSON.stringify({
					format: 'registered-snapshot',
					version: 1,
					schemaSignature: this.schemaSignature,
					tables,
					files,
				}),
			);
			if (bytes.byteLength > this.maxBytes) {
				throw new SnapshotFailure('limit_exceeded');
			}
			signal.throwIfAborted();
			return bytes;
		} catch (cause) {
			if (cause instanceof SnapshotFailure) {
				throw cause;
			}
			if (cause instanceof BlobFailure && cause.kind === 'cleanup_failed') {
				throw new SnapshotFailure('cleanup_failed', { cause });
			}
			throw new SnapshotFailure('unavailable', { cause });
		}
	}

	private async restore(
		archive: SnapshotArchive,
		restored: ReadonlyMap<string, readonly SqlRow[]>,
		commitSignal: AbortSignal,
	): Promise<SnapshotRestoreReceipt> {
		let commitAttempted = false;
		let stageStarted = false;
		const sql = new SqliteSnapshotRestore(this.db);
		try {
			// Finish an earlier confirmed cleanup before taking ownership of a new journal.
			try {
				await this.restoreFiles.recover((id) => sql.committed(id));
			} catch (cause) {
				throw new SnapshotFailure('cleanup_failed', { cause });
			}
			// Maintenance has drained writers; recheck against the destination's current auth/schema.
			await new SqliteSnapshotValidation(
				this.db,
				this.tables,
				[
					'schema_version',
					'snapshot_restore_state',
					...this.excludedTables,
					...this.registrations.flatMap((registration) => registration.excludedTables ?? []),
				],
				this.schemaSignature,
				this.maxBytes,
				this.registrations,
			).validate(restored, commitSignal);
			stageStarted = true;
			const journal = await this.restoreFiles.stage(archive.files, commitSignal);
			commitSignal.throwIfAborted();
			await this.restoreFiles.publish(journal);
			commitAttempted = true;
			const result = await sql
				.commit(journal.id, this.tables, restored, commitSignal)
				.catch(async (cause: unknown) => {
					let committed: boolean;
					try {
						committed = await sql.committed(journal.id);
					} catch (verification) {
						throw new SnapshotFailure('commit_unknown', {
							cause: new AggregateError(
								[cause, verification],
								'Snapshot commit and marker verification failed',
							),
						});
					}
					if (!committed) {
						throw cause;
					}
					return {
						restoredTables: this.tables.length,
						restoredRows: [...restored.values()].reduce((total, rows) => total + rows.length, 0),
						restoredFiles: 0,
						cleanupPending: false,
					};
				});
			const cleanupPending = await this.restoreFiles.finalize(journal);
			return {
				restoredTables: result.restoredTables,
				restoredRows: result.restoredRows,
				restoredFiles: archive.files.length,
				cleanupPending,
			};
		} catch (cause) {
			if (!stageStarted) {
				throw cause instanceof SnapshotFailure ? cause : new SnapshotFailure('unavailable', { cause });
			}
			try {
				// Marker authority, not an exception or cancellation, decides which files survive.
				await this.restoreFiles.recover((id) => (commitAttempted ? sql.committed(id) : Promise.resolve(false)));
			} catch (recovery) {
				throw new SnapshotFailure(commitAttempted ? 'commit_unknown' : 'cleanup_failed', {
					cause: new AggregateError([cause, recovery], 'Snapshot restore and reconciliation failed'),
				});
			}
			throw cause instanceof SnapshotFailure ? cause : new SnapshotFailure('unavailable', { cause });
		}
	}

	async prepareImport(bytes: Uint8Array, partition: SqlParameter, signal: AbortSignal): Promise<PreparedSnapshot> {
		signal.throwIfAborted();
		const archive = decodeSnapshotArchive(
			bytes,
			this.tables,
			new Set(this.roots.keys()),
			this.maxBytes,
			this.schemaSignature,
			partition,
		);
		const restored = new Map<string, SqlRow[]>();
		let retained = false;

		const dispose = () => {
			for (const file of archive.files) {
				file.content.fill(0);
			}
			archive.tables.clear();
			restored.clear();
		};

		try {
			const expectedFiles = new Map<string, SnapshotFileReference>();
			for (const registration of this.registrations) {
				signal.throwIfAborted();
				const owned = new Map<string, SqlRow[]>();
				for (const table of registration.tables) {
					const rows = archive.tables.get(table.name);
					if (!rows) {
						throw new SnapshotFailure('invalid_archive');
					}
					const normalized = rows.map((row) => project(table, registration.restore(table, row)));
					owned.set(table.name, normalized);
					restored.set(table.name, normalized);
					for (const row of normalized) {
						for (const ref of registration.files(table.name, row)) {
							const key = ref.root + '/' + ref.key;
							const previous = expectedFiles.get(key);
							if (previous && (previous.bytes !== ref.bytes || previous.sha256 !== ref.sha256)) {
								throw new SnapshotFailure('invalid_archive');
							}
							expectedFiles.set(key, {
								root: ref.root,
								key: ref.key,
								bytes: ref.bytes,
								sha256: ref.sha256,
							});
						}
					}
				}
				try {
					registration.validate?.(owned);
				} catch (cause) {
					throw new SnapshotFailure('invalid_archive', { cause });
				}
			}
			if (archive.files.length !== expectedFiles.size) {
				throw new SnapshotFailure('invalid_archive');
			}
			for (const file of archive.files) {
				signal.throwIfAborted();
				const ref = file.reference;
				const expected = expectedFiles.get(ref.root + '/' + ref.key);
				if (!expected || expected.bytes !== ref.bytes || expected.sha256 !== ref.sha256) {
					throw new SnapshotFailure('invalid_archive');
				}
				for (const registration of this.registrations) {
					try {
						await registration.validateFile?.(
							{ root: ref.root, key: ref.key, bytes: ref.bytes, sha256: ref.sha256 },
							file.content,
							new Map(registration.tables.map((table) => [table.name, restored.get(table.name) ?? []])),
						);
					} catch (cause) {
						if (signal.aborted && cause === signal.reason) {
							throw cause;
						}
						throw new SnapshotFailure('invalid_archive', { cause });
					}
				}
			}
			await new SqliteSnapshotValidation(
				this.db,
				this.tables,
				[
					'schema_version',
					'snapshot_restore_state',
					...this.excludedTables,
					...this.registrations.flatMap((registration) => registration.excludedTables ?? []),
				],
				this.schemaSignature,
				this.maxBytes,
				this.registrations,
			).validate(restored, signal);
			signal.throwIfAborted();
			retained = true;
			let state: 'prepared' | 'committing' | 'closed' = 'prepared';
			return {
				commit: async (commitSignal) => {
					if (state !== 'prepared') {
						throw new SnapshotFailure('unavailable');
					}
					state = 'committing';
					try {
						return await this.restore(archive, restored, commitSignal);
					} finally {
						state = 'closed';
						dispose();
					}
				},

				close: () => {
					if (state === 'committing') {
						throw new SnapshotFailure('unavailable');
					}
					state = 'closed';
					dispose();
				},
			};
		} catch (cause) {
			if (signal.aborted && cause === signal.reason) {
				throw cause;
			}
			if (cause instanceof SnapshotFailure) {
				if (cause.kind === 'source_changed') {
					throw new SnapshotFailure('invalid_archive', { cause });
				}
				throw cause;
			}
			throw new SnapshotFailure('invalid_archive', { cause });
		} finally {
			if (!retained) {
				dispose();
			}
		}
	}
}
