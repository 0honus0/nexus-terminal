import path from 'node:path';
import { finished } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import { logger } from '../../../shared/logging/logger';
import type { ExecutionSessionManager } from '../../execution/execution-session-manager';
import type { RemoteFileSystem } from '../../filesystem/remote-filesystem';
import { RemoteDirectoryTypeConflict } from '../../filesystem/remote-filesystem';
import { KnownMutationFailure } from '../known-mutation-failure';
import { toRemoteFileEntry } from '../../filesystem/file-entry';
import { normalizeAbsoluteRemotePath } from '../../filesystem/remote-path';
import type {
	UploadChunkRequest,
	UploadEvent,
	UploadOperation,
	UploadPrepareRequest,
	UploadStartRequest,
} from './upload-operation.port';

interface PreparedBatch {
	ownerId: string;
	sessionId: string;
	basePath: string;
	directories: Set<string>;
	expiresAt: number;
}

interface PreparingBatch {
	ownerId: string;
	directoryCount: number;
	token: symbol;
}

interface StreamUploadOperationPolicy {
	maxBatchesPerOwner?: number;
	maxDirectoriesPerOwner?: number;
	ttlMs?: number;
	now?: () => number;
	idleTimeoutMs?: number;
}

interface PendingUpload {
	key: string;
	ownerId: string;
	uploadId: string;
	emit: (event: UploadEvent) => void;
	cancelled: boolean;
	settled: Promise<void>;
	settle(): void;
}

interface ActiveUpload {
	key: string;
	ownerId: string;
	uploadId: string;
	sessionId: string;
	destinationPath: string;
	temporaryPath: string;
	totalSize: number;
	bytesAccepted: number;
	bytesWritten: number;
	nextChunkIndex: number;
	receivedLastChunk: boolean;
	filesystem: RemoteFileSystem;
	stream: Writable;
	emit: (event: UploadEvent) => void;
	queue: Promise<void>;
	cancelled: boolean;
	idleTimer?: NodeJS.Timeout;
}

const WRITE_HIGH_WATER_MARK = 8 * 1024 * 1024;
const PREPARE_CONCURRENCY = 8;
const DEFAULT_MAX_PREPARED_BATCHES_PER_OWNER = 64;
const DEFAULT_MAX_PREPARED_DIRECTORIES_PER_OWNER = 100_000;
const DEFAULT_PREPARED_BATCH_TTL_MS = 30 * 60_000;
const DEFAULT_UPLOAD_IDLE_TIMEOUT_MS = 5 * 60_000;

export class StreamUploadOperationService implements UploadOperation {
	private readonly active = new Map<string, ActiveUpload>();
	private readonly pending = new Map<string, PendingUpload>();
	private readonly prepared = new Map<string, PreparedBatch>();
	private readonly preparing = new Map<string, PreparingBatch>();
	private readonly maxPreparedBatchesPerOwner: number;
	private readonly maxPreparedDirectoriesPerOwner: number;
	private readonly preparedBatchTtlMs: number;
	private readonly now: () => number;
	private readonly uploadIdleTimeoutMs: number;

	constructor(
		private readonly sessions: Pick<ExecutionSessionManager, 'require'>,
		policy: StreamUploadOperationPolicy = {},
	) {
		this.maxPreparedBatchesPerOwner = policy.maxBatchesPerOwner ?? DEFAULT_MAX_PREPARED_BATCHES_PER_OWNER;
		this.maxPreparedDirectoriesPerOwner =
			policy.maxDirectoriesPerOwner ?? DEFAULT_MAX_PREPARED_DIRECTORIES_PER_OWNER;
		this.preparedBatchTtlMs = policy.ttlMs ?? DEFAULT_PREPARED_BATCH_TTL_MS;
		this.now = policy.now ?? Date.now;
		this.uploadIdleTimeoutMs = Math.max(1, Math.floor(policy.idleTimeoutMs ?? DEFAULT_UPLOAD_IDLE_TIMEOUT_MS));
	}

	async prepare(request: UploadPrepareRequest): Promise<{ preparedDirectories: number }> {
		if (!request.prepareId || request.prepareId.length > 512) throw new Error('Invalid upload prepare id.');
		if (request.directories.length > 20_000) throw new Error('Too many upload directories.');
		const basePath = this.absolutePath(request.basePath, 'upload base');
		const directories = new Set<string>([basePath]);
		for (const input of request.directories) directories.add(this.resolveRelativeDirectory(basePath, input));
		const key = this.prepareKey(request.ownerId, request.prepareId);
		const token = this.reservePreparedBatch(key, request.ownerId, directories.size);

		try {
			const filesystem = await this.sessions.require(request.sessionId).fileSystem('transfer');
			try {
				await filesystem.ensureDirectory(basePath);
			} catch (error) {
				if (error instanceof RemoteDirectoryTypeConflict)
					throw new KnownMutationFailure(error.message, { cause: error });
				throw error;
			}
			// Schedule shared parents before their children, but do not add implicit
			// parents to the prepared destination allowlist or its capacity accounting.
			// At most one extra path per requested directory keeps this work bounded.
			const preparationDirectories = new Set(directories);
			for (const directory of directories) {
				const parent = path.posix.dirname(directory);
				if (parent !== basePath && this.isWithin(basePath, parent)) preparationDirectories.add(parent);
			}
			const remaining = [...preparationDirectories]
				.filter((value) => value !== basePath)
				.sort((a, b) => {
					const depth = a.split('/').length - b.split('/').length;
					return depth || a.localeCompare(b);
				});
			let layerStart = 0;
			while (layerStart < remaining.length) {
				const depth = remaining[layerStart]!.split('/').length;
				let layerEnd = layerStart + 1;
				while (layerEnd < remaining.length && remaining[layerEnd]!.split('/').length === depth) layerEnd++;
				let index = layerStart;
				let failed = false;
				const outcomes = await Promise.allSettled(
					Array.from({ length: Math.min(PREPARE_CONCURRENCY, layerEnd - layerStart) }, async () => {
						while (!failed && index < layerEnd) {
							try {
								await filesystem.ensureDirectory(remaining[index++]);
							} catch (error) {
								failed = true;
								throw error;
							}
						}
					}),
				);
				const failures = outcomes.filter(
					(outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
				);
				if (failures.length) {
					if (failures.every((failure) => failure.reason instanceof RemoteDirectoryTypeConflict)) {
						throw new KnownMutationFailure(failures[0]!.reason.message, { cause: failures[0]!.reason });
					}
					throw failures.find((failure) => !(failure.reason instanceof RemoteDirectoryTypeConflict))!.reason;
				}
				layerStart = layerEnd;
			}

			const reservation = this.preparing.get(key);
			if (!reservation || reservation.token !== token) throw new Error('Upload preparation was superseded.');
			this.prepared.set(key, {
				ownerId: request.ownerId,
				sessionId: request.sessionId,
				basePath,
				directories,
				expiresAt: this.now() + this.preparedBatchTtlMs,
			});
			this.preparing.delete(key);
			return { preparedDirectories: directories.size };
		} catch (error) {
			if (this.preparing.get(key)?.token === token) this.preparing.delete(key);
			throw error;
		}
	}

	async start(request: UploadStartRequest, emit: (event: UploadEvent) => void): Promise<void> {
		const now = this.now();
		this.prunePrepared(now);
		const key = this.uploadKey(request.ownerId, request.uploadId);
		if (!request.uploadId || request.uploadId.length > 512) {
			emit({ type: 'failed', uploadId: request.uploadId, message: 'Invalid upload id.' });
			return;
		}
		if (!Number.isSafeInteger(request.size) || request.size < 0) {
			emit({ type: 'failed', uploadId: request.uploadId, message: 'Invalid upload size.' });
			return;
		}
		if (this.active.has(key) || this.pending.has(key)) {
			emit({ type: 'failed', uploadId: request.uploadId, message: 'Upload already started.' });
			return;
		}

		let settlePending!: () => void;
		const pending: PendingUpload = {
			key,
			ownerId: request.ownerId,
			uploadId: request.uploadId,
			emit,
			cancelled: false,
			settled: new Promise<void>((resolve) => {
				settlePending = resolve;
			}),

			settle: () => settlePending(),
		};
		this.pending.set(key, pending);
		logger.debug(
			{
				workspaceId: request.ownerId,
				uploadId: request.uploadId,
				totalSize: request.size,
				pendingUploads: this.pending.size,
			},
			'Upload start queued',
		);
		let filesystem: RemoteFileSystem | undefined;
		let temporaryPath: string | undefined;
		let stream: Writable | undefined;

		const isCancelled = () => pending.cancelled || this.pending.get(key) !== pending;

		try {
			filesystem = await this.sessions.require(request.sessionId).fileSystem('transfer');
			if (isCancelled()) return;

			const destinationPath = this.absolutePath(request.destinationPath, 'upload destination');
			const destinationDirectory = path.posix.dirname(destinationPath);
			if (request.prepareId) {
				const batch = this.prepared.get(this.prepareKey(request.ownerId, request.prepareId));
				if (!batch || batch.sessionId !== request.sessionId) {
					emit({
						type: 'failed',
						uploadId: request.uploadId,
						message: 'Upload directories were not prepared.',
					});
					return;
				}
				if (
					!this.isWithin(batch.basePath, destinationDirectory) ||
					!batch.directories.has(destinationDirectory)
				) {
					emit({
						type: 'failed',
						uploadId: request.uploadId,
						message: 'Upload destination is outside prepared directories.',
					});
					return;
				}
				batch.expiresAt = now + this.preparedBatchTtlMs;
			} else {
				await filesystem.ensureDirectory(destinationDirectory);
				if (isCancelled()) return;
			}

			const conflictPolicy = request.conflictPolicy ?? 'ask';
			const exists = await filesystem.exists(destinationPath);
			if (isCancelled()) return;
			if (exists && conflictPolicy === 'ask') {
				emit({
					type: 'conflict',
					uploadId: request.uploadId,
					destinationPath,
					filename: path.posix.basename(destinationPath),
				});
				return;
			}
			if (exists && conflictPolicy === 'skip') {
				emit({ type: 'skipped', uploadId: request.uploadId, destinationPath });
				return;
			}

			temporaryPath = path.posix.join(destinationDirectory, `.nexus-upload-${request.uploadId}.part`);
			await filesystem.removeFile(temporaryPath, { ignoreMissing: true });
			if (isCancelled()) return;
			stream = await filesystem.openWrite(temporaryPath, { highWaterMark: WRITE_HIGH_WATER_MARK });
			if (isCancelled()) return;

			const upload: ActiveUpload = {
				key,
				ownerId: request.ownerId,
				uploadId: request.uploadId,
				sessionId: request.sessionId,
				destinationPath,
				temporaryPath,
				totalSize: request.size,
				bytesAccepted: 0,
				bytesWritten: 0,
				nextChunkIndex: 0,
				receivedLastChunk: false,
				filesystem,
				stream,
				emit,
				queue: Promise.resolve(),
				cancelled: false,
			};
			this.pending.delete(key);
			this.active.set(key, upload);
			this.refreshUploadIdleTimeout(upload);
			stream.once('error', (error: Error) => {
				if (this.active.get(key) !== upload || upload.cancelled) return;
				void this.fail(upload, `Upload stream failed: ${error.message}`);
			});
			if (request.size === 0) {
				upload.receivedLastChunk = true;
				await this.complete(upload);
				return;
			}
			emit({ type: 'ready', uploadId: request.uploadId });
		} finally {
			if (this.pending.get(key) === pending) {
				this.pending.delete(key);
				if (stream && !stream.destroyed) stream.destroy();
				if (filesystem && temporaryPath) {
					await filesystem.removeFile(temporaryPath, { ignoreMissing: true }).catch(() => undefined);
				}
			}
			pending.settle();
		}
	}

	async append(request: UploadChunkRequest): Promise<void> {
		const upload = this.active.get(this.uploadKey(request.ownerId, request.uploadId));
		if (!upload) return;
		const task = upload.queue.then(() => this.appendSerial(upload, request));
		upload.queue = task.catch(() => undefined);
		await task;
	}

	async cancel(ownerId: string, uploadId: string): Promise<boolean> {
		const key = this.uploadKey(ownerId, uploadId);
		const upload = this.active.get(key);
		const pending = this.pending.get(key);
		if (!upload && !pending) return false;
		logger.debug(
			{ workspaceId: ownerId, uploadId, uploadState: upload ? 'active' : 'pending' },
			'Upload cancellation dispatch',
		);
		if (upload) {
			upload.cancelled = true;
			this.active.delete(upload.key);
			this.clearUploadIdleTimeout(upload);
			upload.stream.destroy();
			// A remote SFTP write may already be inside the serialized append queue. Wait for it to
			// settle after destroying the stream before reporting cancellation/teardown complete.
			await upload.queue.catch(() => undefined);
			await upload.filesystem.removeFile(upload.temporaryPath, { ignoreMissing: true }).catch(() => undefined);
			upload.emit({ type: 'cancelled', uploadId });
			return true;
		}

		if (!pending) return false;
		if (!pending.cancelled) {
			pending.cancelled = true;
			pending.emit({ type: 'cancelled', uploadId });
		}
		// start() may still be awaiting SFTP directory/openWrite work. Its finally block owns cleanup;
		// do not let Workspace reset/close race that work on a transport being torn down.
		await pending.settled;
		return true;
	}

	async abort(ownerId: string, uploadId: string, message: string): Promise<boolean> {
		const upload = this.active.get(this.uploadKey(ownerId, uploadId));
		if (!upload) return false;
		await this.fail(upload, message);
		return true;
	}

	async cancelOwner(ownerId: string): Promise<void> {
		const ids = new Set<string>();
		for (const upload of this.active.values()) if (upload.ownerId === ownerId) ids.add(upload.uploadId);
		for (const upload of this.pending.values()) if (upload.ownerId === ownerId) ids.add(upload.uploadId);
		await Promise.all([...ids].map((uploadId) => this.cancel(ownerId, uploadId)));
		for (const [key, batch] of this.prepared) if (batch.ownerId === ownerId) this.prepared.delete(key);
		for (const [key, batch] of this.preparing) if (batch.ownerId === ownerId) this.preparing.delete(key);
	}

	private reservePreparedBatch(key: string, ownerId: string, directoryCount: number): symbol {
		this.prunePrepared(this.now());
		const retained = new Map<string, number>();
		for (const [candidateKey, batch] of this.prepared) {
			if (batch.ownerId === ownerId) retained.set(candidateKey, batch.directories.size);
		}
		for (const [candidateKey, batch] of this.preparing) {
			if (batch.ownerId === ownerId) retained.set(candidateKey, batch.directoryCount);
		}
		retained.set(key, directoryCount);
		if (retained.size > this.maxPreparedBatchesPerOwner) throw new Error('Too many prepared upload batches.');
		let retainedDirectories = 0;
		for (const count of retained.values()) retainedDirectories += count;
		if (retainedDirectories > this.maxPreparedDirectoriesPerOwner) {
			throw new Error('Prepared upload directory capacity exceeded.');
		}
		const token = Symbol('upload-prepare');
		this.preparing.set(key, { ownerId, directoryCount, token });
		return token;
	}

	private prunePrepared(now: number): void {
		for (const [key, batch] of this.prepared) {
			if (batch.expiresAt <= now) this.prepared.delete(key);
		}
	}

	private async appendSerial(upload: ActiveUpload, request: UploadChunkRequest): Promise<void> {
		if (upload.cancelled || this.active.get(upload.key) !== upload) return;
		if (request.chunkIndex !== upload.nextChunkIndex) {
			await this.fail(
				upload,
				`Upload chunk order mismatch: expected ${upload.nextChunkIndex}, received ${request.chunkIndex}.`,
			);
			return;
		}
		if (upload.receivedLastChunk) {
			await this.fail(upload, `Received chunk ${request.chunkIndex} after the final chunk.`);
			return;
		}
		const data = Buffer.from(request.data.buffer, request.data.byteOffset, request.data.byteLength);
		const nextBytes = upload.bytesAccepted + data.length;
		if (nextBytes > upload.totalSize) {
			await this.fail(upload, `Upload exceeds declared size: ${nextBytes}/${upload.totalSize}.`);
			return;
		}
		const reachesSize = nextBytes === upload.totalSize;
		if (request.isLast !== reachesSize) {
			await this.fail(
				upload,
				request.isLast
					? `Final chunk arrived too early: ${nextBytes}/${upload.totalSize}.`
					: `Declared size reached without final chunk: ${nextBytes}/${upload.totalSize}.`,
			);
			return;
		}

		upload.nextChunkIndex += 1;
		upload.bytesAccepted = nextBytes;
		upload.receivedLastChunk = request.isLast;
		this.refreshUploadIdleTimeout(upload);
		// Serialize validation/enqueue, not remote acknowledgements. Buffered chunks
		// let the SFTP Writable use _writev; awaiting each callback disables batching.
		const accepted = upload.stream.write(data, (error) => {
			if (upload.cancelled || this.active.get(upload.key) !== upload) return;
			if (error) {
				void this.fail(upload, `Unable to write upload chunk ${request.chunkIndex}: ${error.message}`);
				return;
			}
			upload.bytesWritten += data.length;
			upload.emit({
				type: 'progress',
				uploadId: upload.uploadId,
				chunkIndex: request.chunkIndex,
				bytesWritten: upload.bytesWritten,
				totalSize: upload.totalSize,
				progress: Math.min(100, Math.round((upload.bytesWritten / upload.totalSize) * 100)),
			});
		});
		if (request.isLast) {
			await this.complete(upload);
			return;
		}
		if (accepted) return;
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				upload.stream.removeListener('drain', onDrain);
				upload.stream.removeListener('close', onClose);
				upload.stream.removeListener('error', onError);
			};

			const onDrain = () => {
				cleanup();
				resolve();
			};

			const onClose = () => {
				cleanup();
				resolve();
			};

			const onError = (error: Error) => {
				cleanup();
				reject(error);
			};

			upload.stream.once('drain', onDrain);
			upload.stream.once('close', onClose);
			upload.stream.once('error', onError);
			if (upload.stream.destroyed || !upload.stream.writableNeedDrain) onDrain();
		}).catch(async (error) => {
			await this.fail(
				upload,
				`Unable to write upload chunk ${request.chunkIndex}: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		});
	}

	private async complete(upload: ActiveUpload): Promise<void> {
		if (upload.bytesAccepted !== upload.totalSize || !upload.receivedLastChunk) {
			await this.fail(upload, `Upload incomplete: ${upload.bytesWritten}/${upload.totalSize}.`);
			return;
		}
		upload.stream.end();
		try {
			await finished(upload.stream);
			if (upload.cancelled || this.active.get(upload.key) !== upload) return;
			if (upload.bytesWritten !== upload.totalSize) {
				throw new Error(`Upload write size mismatch: ${upload.bytesWritten}/${upload.totalSize}.`);
			}
			const temporaryMetadata = await upload.filesystem.metadata(upload.temporaryPath);
			if (temporaryMetadata.size !== upload.totalSize) {
				throw new Error(`Temporary upload size mismatch: ${temporaryMetadata.size}/${upload.totalSize}.`);
			}
			await upload.filesystem.replaceFile(upload.temporaryPath, upload.destinationPath);
			const metadata = await upload.filesystem.metadata(upload.destinationPath);
			this.clearUploadIdleTimeout(upload);
			this.active.delete(upload.key);
			logger.debug(
				{ workspaceId: upload.ownerId, uploadId: upload.uploadId, totalSize: upload.totalSize },
				'Upload completed',
			);
			upload.emit({
				type: 'completed',
				uploadId: upload.uploadId,
				destinationPath: upload.destinationPath,
				item: toRemoteFileEntry(upload.destinationPath, metadata),
			});
		} catch (error) {
			await this.fail(
				upload,
				`Unable to finalize upload: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async fail(upload: ActiveUpload, message: string): Promise<void> {
		if (this.active.get(upload.key) !== upload) return;
		this.active.delete(upload.key);
		upload.cancelled = true;
		this.clearUploadIdleTimeout(upload);
		if (!upload.stream.destroyed) upload.stream.destroy();
		await upload.filesystem.removeFile(upload.temporaryPath, { ignoreMissing: true }).catch(() => undefined);
		logger.warn(
			{
				workspaceId: upload.ownerId,
				uploadId: upload.uploadId,
				bytesWritten: upload.bytesWritten,
				totalSize: upload.totalSize,
				reason: message,
			},
			'Upload failed',
		);
		upload.emit({ type: 'failed', uploadId: upload.uploadId, message });
	}

	private refreshUploadIdleTimeout(upload: ActiveUpload): void {
		this.clearUploadIdleTimeout(upload);
		upload.idleTimer = setTimeout(() => {
			void this.expireIdleUpload(upload);
		}, this.uploadIdleTimeoutMs);
		upload.idleTimer.unref?.();
	}

	private clearUploadIdleTimeout(upload: ActiveUpload): void {
		if (!upload.idleTimer) return;
		clearTimeout(upload.idleTimer);
		upload.idleTimer = undefined;
	}

	private async expireIdleUpload(upload: ActiveUpload): Promise<void> {
		if (this.active.get(upload.key) !== upload || upload.cancelled) return;
		this.active.delete(upload.key);
		upload.cancelled = true;
		this.clearUploadIdleTimeout(upload);
		if (!upload.stream.destroyed) upload.stream.destroy();
		await upload.queue.catch(() => undefined);
		await upload.filesystem.removeFile(upload.temporaryPath, { ignoreMissing: true }).catch(() => undefined);
		logger.warn(
			{
				workspaceId: upload.ownerId,
				uploadId: upload.uploadId,
				bytesWritten: upload.bytesWritten,
				totalSize: upload.totalSize,
			},
			'Upload idle timeout expired',
		);
		upload.emit({ type: 'failed', uploadId: upload.uploadId, message: 'Upload idle timeout expired.' });
	}

	private uploadKey(ownerId: string, uploadId: string): string {
		return `${ownerId}\u0000${uploadId}`;
	}

	private prepareKey(ownerId: string, prepareId: string): string {
		return `${ownerId}\u0000${prepareId}`;
	}

	private absolutePath(value: string, label: string): string {
		return normalizeAbsoluteRemotePath(value, label);
	}

	private resolveRelativeDirectory(basePath: string, relativePath: string): string {
		const normalizedRelative = path.posix
			.normalize(relativePath.replace(/\\/g, '/').replace(/^\.\//, ''))
			.replace(/\/$/, '');
		if (!normalizedRelative || normalizedRelative === '.') return basePath;
		if (
			path.posix.isAbsolute(normalizedRelative) ||
			normalizedRelative === '..' ||
			normalizedRelative.startsWith('../')
		) {
			throw new Error(`Upload directory contains traversal: ${relativePath}`);
		}
		const fullPath = path.posix.normalize(path.posix.join(basePath, normalizedRelative));
		if (!this.isWithin(basePath, fullPath)) throw new Error(`Upload directory escapes base path: ${relativePath}`);
		return fullPath;
	}

	private isWithin(basePath: string, candidate: string): boolean {
		return basePath === '/'
			? candidate.startsWith('/')
			: candidate === basePath || candidate.startsWith(`${basePath}/`);
	}
}
