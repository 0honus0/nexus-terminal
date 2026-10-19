import type { SnapshotCollector } from '../../../../platform/storage/sqlite/snapshot-types.js';
import { SnapshotFailure } from '../../../../platform/storage/sqlite/snapshot-types.js';
import type { SealedBytes } from '../../../../platform/security/sealed-bytes.js';
import { SealedBytesFailure } from '../../../../platform/security/sealed-bytes.js';
import { BACKUP_MAX_FILE_BYTES } from '@nexus-terminal/shared/system/backups/values';
import {
	BackupFailure,
	BackupResourceFailure,
	type BackupExportFile,
	type BackupImportInput,
	type BackupPreparedImport,
} from './backup-types.js';

function toImportFailure(cause: unknown): BackupFailure {
	if (cause instanceof BackupFailure) {
		return cause;
	}
	if (cause instanceof SnapshotFailure) {
		switch (cause.kind) {
			case 'cleanup_failed':
				return new BackupResourceFailure({ cause });
			case 'commit_unknown':
				return new BackupFailure('operation_unknown', { cause });
			case 'invalid_archive':
				return new BackupFailure('invalid_input', { cause });
			case 'limit_exceeded':
				return new BackupFailure('limit_exceeded', { cause });
			default:
				return new BackupFailure('unavailable', { cause });
		}
	}
	if (cause instanceof SealedBytesFailure) {
		switch (cause.kind) {
			case 'password_required':
			case 'authentication_failed':
				return new BackupFailure('invalid_password', { cause });
			case 'invalid_input':
				return new BackupFailure('invalid_input', { cause });
			case 'limit_exceeded':
				return new BackupFailure('limit_exceeded', { cause });
			default:
				return new BackupFailure('unavailable', { cause });
		}
	}
	return new BackupFailure('unavailable', { cause });
}

export class BackupModel {
	constructor(
		private readonly collector: SnapshotCollector,
		private readonly codec: SealedBytes,
	) {}

	async export(password: string, signal: AbortSignal): Promise<BackupExportFile> {
		try {
			const snapshot = await this.collector.collect(signal);
			try {
				signal.throwIfAborted();
				const content = await this.codec.encode(snapshot, password);
				signal.throwIfAborted();
				if (content.byteLength > BACKUP_MAX_FILE_BYTES) {
					throw new BackupFailure('limit_exceeded');
				}
				return { content };
			} finally {
				snapshot.fill(0);
			}
		} catch (cause) {
			if (cause instanceof SnapshotFailure && cause.kind === 'cleanup_failed') {
				throw new BackupResourceFailure({ cause });
			}
			if (cause instanceof BackupFailure) {
				throw cause;
			}
			if (
				cause instanceof SnapshotFailure &&
				(cause.kind === 'limit_exceeded' || cause.kind === 'source_changed')
			) {
				throw new BackupFailure(cause.kind, { cause });
			}
			if (cause instanceof SealedBytesFailure && cause.kind === 'limit_exceeded') {
				throw new BackupFailure('limit_exceeded', { cause });
			}
			throw new BackupFailure('unavailable', { cause });
		}
	}

	async prepareImport(input: BackupImportInput, userId: number, signal: AbortSignal): Promise<BackupPreparedImport> {
		try {
			signal.throwIfAborted();
			if (input.content.byteLength > BACKUP_MAX_FILE_BYTES) {
				throw new BackupFailure('limit_exceeded');
			}
			const snapshot = await this.codec.decode(input.content, input.password ?? undefined);
			try {
				signal.throwIfAborted();
				const prepared = await this.collector.prepareImport(snapshot, userId, signal);
				return {
					apply: async (commitSignal) => {
						try {
							const receipt = await prepared.commit(commitSignal);
							return {
								restoredTables: receipt.restoredTables,
								restoredRows: receipt.restoredRows,
								restoredFiles: receipt.restoredFiles,
								cleanupPending: receipt.cleanupPending,
							};
						} catch (cause) {
							throw toImportFailure(cause);
						}
					},

					close: () => {
						try {
							prepared.close();
						} catch (cause) {
							throw toImportFailure(cause);
						}
					},
				};
			} finally {
				snapshot.fill(0);
			}
		} catch (cause) {
			throw toImportFailure(cause);
		}
	}
}
