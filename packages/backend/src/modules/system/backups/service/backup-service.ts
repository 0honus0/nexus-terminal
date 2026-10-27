import type { Logger } from '../../../../platform/logging/logger.js';
import { logDiagnostic } from '../../../../platform/logging/diagnostic-log.js';
import type { AccessPublicApi } from '../../../access/public.js';
import { AccessOperationError } from '../../../access/public-errors.js';
import type { BackupModel } from '../model/backup-model.js';
import {
	BackupFailure,
	BackupResourceFailure,
	type BackupExportInput,
	type BackupExportFile,
	type BackupImportInput,
	type BackupImportReceipt,
} from '../model/backup-types.js';

export class BackupService {
	private accepting = true;
	private readonly pending = new Set<Promise<unknown>>();
	private readonly shutdown = new AbortController();
	private closePromise: Promise<void> | null = null;
	private resourceFailure: BackupResourceFailure | null = null;

	constructor(
		private readonly access: AccessPublicApi,
		private readonly model: BackupModel,
		private readonly logger?: Logger,
	) {}

	export(
		token: string | null,
		read: (signal: AbortSignal) => Promise<BackupExportInput>,
		deliver: (file: BackupExportFile, signal: AbortSignal) => Promise<void>,
		signal: AbortSignal,
	): Promise<void> {
		if (!this.accepting) {
			return Promise.reject(new BackupFailure('unavailable'));
		}
		if (this.pending.size) {
			return Promise.reject(new BackupFailure('busy'));
		}
		const combined = AbortSignal.any([signal, this.shutdown.signal, AbortSignal.timeout(120_000)]);
		const task = Promise.resolve().then(async () => {
			try {
				combined.throwIfAborted();
				const input = await read(combined);
				combined.throwIfAborted();
				const proof = await this.access.provePassword(token, input.password);
				if (proof.userId !== 1) {
					throw new BackupFailure('forbidden');
				}
				combined.throwIfAborted();
				await proof.assertCurrent();
				logDiagnostic(this.logger, 'info', 'BACKUP_EXPORT_STARTED');
				const file = await this.model.export(input.password, combined);
				await proof.assertCurrent();
				combined.throwIfAborted();
				await deliver({ content: file.content }, combined);
				logDiagnostic(this.logger, 'info', 'BACKUP_EXPORT_COMPLETED', { bytes: file.content.byteLength });
			} catch (cause) {
				logDiagnostic(this.logger, 'warn', 'BACKUP_EXPORT_FAILED', { aborted: combined.aborted }, cause);
				if (cause instanceof BackupResourceFailure) {
					this.resourceFailure = cause;
					this.quiesce();
				}
				if (cause instanceof BackupFailure) {
					throw cause;
				}
				if (
					cause instanceof AccessOperationError &&
					['unauthenticated', 'forbidden', 'invalid_credentials'].includes(cause.code)
				) {
					throw new BackupFailure(
						cause.code === 'invalid_credentials'
							? 'invalid_password'
							: cause.code === 'forbidden'
								? 'forbidden'
								: 'unauthenticated',
						{ cause },
					);
				}
				throw new BackupFailure('unavailable', { cause });
			}
		});
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			() => this.pending.delete(task),
		);
		return task;
	}

	quiesce(): void {
		this.accepting = false;
		this.shutdown.abort(new BackupFailure('unavailable'));
	}

	/** Stop new backup work without cancelling the maintenance task that owns this instance. */
	stopAdmission(): void {
		this.accepting = false;
	}

	import(
		token: string | null,
		read: (signal: AbortSignal) => Promise<BackupImportInput>,
		maintain: (apply: () => Promise<boolean>) => Promise<void>,
		signal: AbortSignal,
	): Promise<BackupImportReceipt> {
		if (!this.accepting) {
			return Promise.reject(new BackupFailure('unavailable'));
		}
		if (this.pending.size) {
			return Promise.reject(new BackupFailure('busy'));
		}
		const combined = AbortSignal.any([signal, this.shutdown.signal, AbortSignal.timeout(120_000)]);

		const assertIdentity = async () => {
			const identity = await this.access.authenticate(token);
			if (!identity) {
				throw new BackupFailure('unauthenticated');
			}
			if (identity.userId !== 1) {
				throw new BackupFailure('forbidden');
			}
		};

		const task = Promise.resolve().then(async () => {
			try {
				await assertIdentity();
				combined.throwIfAborted();
				const input = await read(combined);
				try {
					logDiagnostic(this.logger, 'info', 'BACKUP_IMPORT_PREFLIGHT_STARTED', {
						bytes: input.content.byteLength,
					});
					const prepared = await this.model.prepareImport(input, 1, combined);
					logDiagnostic(this.logger, 'info', 'BACKUP_IMPORT_PREFLIGHT_COMPLETED');
					try {
						let receipt: BackupImportReceipt | null = null;
						let failure: unknown = null;
						await maintain(async () => {
							try {
								await assertIdentity();
								combined.throwIfAborted();
								receipt = await prepared.apply(combined);
								return true;
							} catch (cause) {
								failure = cause;
								return (
									!(cause instanceof BackupResourceFailure) &&
									!(cause instanceof BackupFailure && cause.code === 'operation_unknown')
								);
							}
						});
						if (failure !== null) {
							throw failure;
						}
						if (receipt === null) {
							throw new BackupFailure('unavailable');
						}
						logDiagnostic(this.logger, 'info', 'BACKUP_IMPORT_COMPLETED');
						return receipt;
					} finally {
						prepared.close();
					}
				} finally {
					input.content.fill(0);
				}
			} catch (cause) {
				logDiagnostic(this.logger, 'error', 'BACKUP_IMPORT_FAILED', { aborted: combined.aborted }, cause);
				if (cause instanceof BackupResourceFailure) {
					this.resourceFailure = cause;
					this.stopAdmission();
				}
				if (cause instanceof BackupFailure) {
					throw cause;
				}
				if (cause instanceof AccessOperationError && cause.code === 'unauthenticated') {
					throw new BackupFailure('unauthenticated', { cause });
				}
				throw new BackupFailure('unavailable', { cause });
			}
		});
		this.pending.add(task);
		void task.then(
			() => this.pending.delete(task),
			() => this.pending.delete(task),
		);
		return task;
	}

	close(): Promise<void> {
		if (this.closePromise === null) {
			this.closePromise = Promise.resolve().then(async () => {
				await Promise.allSettled([...this.pending]);
				if (this.resourceFailure) {
					throw this.resourceFailure;
				}
			});
			this.quiesce();
		}
		return this.closePromise;
	}
}
