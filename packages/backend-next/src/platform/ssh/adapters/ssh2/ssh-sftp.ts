import type { SFTPWrapper, Stats } from 'ssh2';
import type { Readable, Writable } from 'node:stream';
import {
	MachineSftpFailure,
	type MachineOperationOptions,
	type MachineSftpReadOptions,
	type MachineSftpListOptions,
	type MachineSftpWriteOptions,
	type MachineSftpLease,
	type MachineFileInfo,
	type MachineDirectoryEntry,
} from '../../ssh-port.js';

function toFileInfo(stats: Stats): MachineFileInfo {
	if (
		stats === null || typeof stats !== 'object' ||
		!Number.isSafeInteger(stats.size) || stats.size < 0 ||
		!Number.isSafeInteger(stats.mode) || stats.mode < 0 || stats.mode > 0xffff_ffff ||
		!Number.isSafeInteger(stats.mtime) || stats.mtime < 0 || stats.mtime > Number.MAX_SAFE_INTEGER / 1000 ||
		typeof stats.isDirectory !== 'function' ||
		typeof stats.isFile !== 'function' ||
		typeof stats.isSymbolicLink !== 'function'
	) {
		throw new MachineSftpFailure('invalid_metadata', 'unknown');
	}
	const isDirectory = stats.isDirectory();
	const isFile = stats.isFile();
	const isSymbolicLink = stats.isSymbolicLink();
	if ([isDirectory, isFile, isSymbolicLink].some((kind) => typeof kind !== 'boolean') ||
		Number(isDirectory) + Number(isFile) + Number(isSymbolicLink) > 1) {
		throw new MachineSftpFailure('invalid_metadata', 'unknown');
	}
	return {
		size: stats.size,
		mode: stats.mode,
		modifiedAt: stats.mtime,
		isDirectory,
		isFile,
		isSymbolicLink,
	};
}

function isSftpEof(error: unknown): boolean {
	if (!(error instanceof MachineSftpFailure) || error.reason !== 'operation_failed') return false;
	const cause: unknown = error.cause;
	return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 1;
}

function operationTimeout(options: MachineOperationOptions | undefined, fallback: number): number;
function operationTimeout(options?: MachineOperationOptions): number | undefined;

function operationTimeout(options?: MachineOperationOptions, fallback?: number): number | undefined {
	const value = options?.timeoutMs ?? fallback;
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 300000)) {
		throw new RangeError('Invalid SFTP operation timeout');
	}
	return value;
}

export class SshSftpLease implements MachineSftpLease {
	private closed = false;
	private released = false;
	private closePromise: Promise<void> | null = null;
	private readonly streams = new Set<Readable | Writable>();
	private readonly pending = new Set<(error: Error) => void>();
	private readonly abortLease: () => void;

	constructor(
		private readonly sftp: SFTPWrapper,
		private readonly onEnded: () => void,
		private readonly signal?: AbortSignal,
	) {
		this.abortLease = () => {
			void this.shutdown(new MachineSftpFailure('cancelled', 'unknown')).catch(() => undefined);
		};
		sftp.on('error', (cause: Error) => {
			void this.shutdown(new MachineSftpFailure('operation_failed', 'unknown', { cause })).catch(() => undefined);
		});
		sftp.once('close', () => {
			this.markClosed(new MachineSftpFailure('closed', 'unknown'));
			this.release();
		});
		sftp.once('end', () => {
			void this.shutdown(new MachineSftpFailure('closed', 'unknown')).catch(() => undefined);
		});
		signal?.addEventListener('abort', this.abortLease, { once: true });
		if (signal?.aborted) {
			this.abortLease();
		}
	}

	private release(): void {
		if (this.released) {
			return;
		}
		this.released = true;
		this.signal?.removeEventListener('abort', this.abortLease);
		this.onEnded();
	}

	private markClosed(error: Error): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const reject of [...this.pending]) {
			reject(error);
		}
		for (const stream of [...this.streams]) {
			stream.destroy(error);
		}
	}

	private ensure(options?: MachineOperationOptions): void {
		if (options?.signal?.aborted || this.signal?.aborted) {
			throw new MachineSftpFailure('cancelled', 'not_started');
		}
		if (this.closed || this.closePromise) {
			throw new MachineSftpFailure('closed', 'not_started');
		}
	}

	private call<T>(
		invoke: (finish: (error: Error | undefined | null, value: T) => void) => void,
		options?: MachineOperationOptions,
	): Promise<T> {
		this.ensure(options);
		const limit = operationTimeout(options, 30000);
		return new Promise<T>((resolve, reject) => {
			let settled = false;

			const finish = (error: Error | null | undefined, value?: T) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timer);
				options?.signal?.removeEventListener('abort', aborted);
				this.pending.delete(failed);
				if (error) {
					reject(error);
				} else {
					resolve(value!);
				}
			};

			const failed = (error: Error) => finish(error);

			const aborted = () => finish(new MachineSftpFailure('cancelled', 'unknown'));

			const timer = setTimeout(() => finish(new MachineSftpFailure('timeout', 'unknown')), limit);
			this.pending.add(failed);
			options?.signal?.addEventListener('abort', aborted, { once: true });
			try {
				invoke((error, value) =>
					finish(
						error ? new MachineSftpFailure('operation_failed', 'unknown', { cause: error }) : null,
						value,
					),
				);
			} catch (cause) {
				finish(new MachineSftpFailure('operation_failed', 'unknown', { cause }));
			}
		});
	}

	stat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo> {
		return this.call<Stats>((finish) => this.sftp.stat(path, finish), options).then(toFileInfo);
	}

	lstat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo> {
		return this.call<Stats>((finish) => this.sftp.lstat(path, finish), options).then(toFileInfo);
	}

	async list(path: string, options: MachineSftpListOptions): Promise<MachineDirectoryEntry[]> {
		this.ensure(options);
		if (
			!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1 || options.maxEntries > 10000 ||
			!Number.isSafeInteger(options.maxMetadataBytes) ||
			options.maxMetadataBytes < 1 || options.maxMetadataBytes > 2 * 1024 * 1024
		) {
			throw new RangeError('Invalid SFTP directory budget');
		}
		const deadline = Date.now() + operationTimeout(options, 30000);
		const remaining = (): MachineOperationOptions => {
			const timeoutMs = deadline - Date.now();
			if (timeoutMs < 1) throw new MachineSftpFailure('timeout', 'unknown');
			return { timeoutMs, ...(options.signal === undefined ? {} : { signal: options.signal }) };
		};
		const entries: MachineDirectoryEntry[] = [];
		let metadataBytes = 0;
		const handle = await this.call<Buffer>((finish) => this.sftp.opendir(path, finish), remaining());
		let failure: unknown = null;
		try {
			while (true) {
				const rows = await this.call<Array<{ filename: string; attrs: Stats }>>(
					(finish) => this.sftp.readdir(handle, finish),
					remaining(),
				).catch((error: unknown) => {
					// SSH_FX_EOF is the end of this directory handle, not a read failure.
					if (isSftpEof(error)) return null;
					throw error;
				});
				if (rows === null) break;
				if (!Array.isArray(rows)) throw new MachineSftpFailure('invalid_metadata', 'unknown');
				for (const row of rows) {
					if (
						!row || typeof row.filename !== 'string' || !row.filename ||
						row.filename === '.' || row.filename === '..' || /[/\u0000]/u.test(row.filename) ||
						row.filename.includes('\ufffd')
					) throw new MachineSftpFailure('invalid_metadata', 'unknown');
					const entry: MachineDirectoryEntry = { name: row.filename, info: toFileInfo(row.attrs) };
					metadataBytes += Buffer.byteLength(JSON.stringify(entry), 'utf8');
					if (entries.length >= options.maxEntries || metadataBytes > options.maxMetadataBytes) {
						throw new MachineSftpFailure('limit_exceeded', 'unknown');
					}
					entries.push(entry);
				}
			}
		} catch (error) {
			failure = error;
		}
		try {
			await this.voidCall((finish) => this.sftp.close(handle, finish), { timeoutMs: 2000 });
		} catch (cleanup) {
			// A handle that cannot be closed must not be left on an apparently reusable lease.
			await this.shutdown(new MachineSftpFailure('closed', 'unknown')).catch(() => undefined);
			throw failure === null ? cleanup : new AggregateError([failure, cleanup], 'SFTP listing/handle cleanup failed');
		}
		if (failure !== null) throw failure;
		return entries;
	}

	private track<T extends Readable | Writable>(stream: T, options?: MachineOperationOptions): T {
		this.streams.add(stream);
		const limit = operationTimeout(options, 30000);

		const aborted = () => stream.destroy(new MachineSftpFailure('cancelled', 'unknown'));

		const timer =
			limit === undefined
				? undefined
				: setTimeout(() => stream.destroy(new MachineSftpFailure('timeout', 'unknown')), limit);

		const cleanup = () => {
			clearTimeout(timer);
			options?.signal?.removeEventListener('abort', aborted);
		};

		stream.on('error', () => undefined);
		stream.once('end', cleanup);
		stream.once('finish', cleanup);
		stream.once('close', () => {
			cleanup();
			this.streams.delete(stream);
		});
		options?.signal?.addEventListener('abort', aborted, { once: true });
		if (options?.signal?.aborted) {
			aborted();
		}
		return stream;
	}

	read(path: string, options?: MachineSftpReadOptions): Readable {
		this.ensure(options);
		operationTimeout(options);
		const start = options?.start;
		const end = options?.end;
		if ((start !== undefined && (!Number.isSafeInteger(start) || start < 0)) ||
			(end !== undefined && (!Number.isSafeInteger(end) || end < 0 || end < (start ?? 0)))) {
			throw new RangeError('Invalid inclusive SFTP read byte range');
		}
		return this.track(
			this.sftp.createReadStream(path, {
				...(options?.start === undefined ? {} : { start: options.start }),
				...(options?.end === undefined ? {} : { end: options.end }),
			}),
			options,
		);
	}

	write(path: string, options?: MachineSftpWriteOptions): Writable {
		this.ensure(options);
		operationTimeout(options);
		return this.track(
			this.sftp.createWriteStream(path, {
				flags: options?.flags ?? 'w',
				...(options?.mode === undefined ? {} : { mode: options.mode }),
			}),
			options,
		);
	}

	private voidCall(
		invoke: (finish: (error?: Error | null) => void) => void,
		options?: MachineOperationOptions,
	): Promise<void> {
		return this.call<void>((finish) => invoke((error) => finish(error, undefined)), options);
	}

	rename(from: string, to: string, options?: MachineOperationOptions): Promise<void> {
		return this.voidCall((finish) => this.sftp.rename(from, to, finish), options);
	}

	remove(path: string, options?: MachineOperationOptions): Promise<void> {
		return this.voidCall((finish) => this.sftp.unlink(path, finish), options);
	}

	mkdir(path: string, options?: MachineOperationOptions): Promise<void> {
		return this.voidCall((finish) => this.sftp.mkdir(path, finish), options);
	}

	rmdir(path: string, options?: MachineOperationOptions): Promise<void> {
		return this.voidCall((finish) => this.sftp.rmdir(path, finish), options);
	}

	private shutdown(error: Error): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		if (this.released) {
			return Promise.resolve();
		}
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		this.closePromise = new Promise<void>((success, failure) => {
			resolve = success;
			reject = failure;
		});
		let finished = false;

		const finish = (failure?: unknown) => {
			if (finished) {
				return;
			}
			finished = true;
			clearTimeout(timer);
			this.sftp.off('close', closed);
			this.release();
			if (failure === undefined) {
				resolve();
			} else {
				reject(failure);
			}
		};

		const closed = () => finish();

		const timer = setTimeout(() => {
			try {
				this.sftp.destroy();
				finish();
			} catch (failure) {
				finish(failure);
			}
		}, 2000);
		this.sftp.once('close', closed);
		this.markClosed(error);
		try {
			this.sftp.end();
		} catch (failure) {
			try {
				this.sftp.destroy();
			} catch (cleanup) {
				finish(new AggregateError([failure, cleanup], 'SFTP close failed'));
			}
			finish(failure);
		}
		return this.closePromise;
	}

	close(): Promise<void> {
		return this.shutdown(new MachineSftpFailure('closed', 'unknown'));
	}
}
