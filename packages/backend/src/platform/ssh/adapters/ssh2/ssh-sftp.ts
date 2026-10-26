import { randomUUID } from 'node:crypto';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { Readable, Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { FailureSummary } from '../../../lifecycle/failure-summary.js';
import {
	MACHINE_SFTP_MAX_METADATA_TIMEOUT_MS,
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
		stats === null ||
		typeof stats !== 'object' ||
		!Number.isSafeInteger(stats.size) ||
		stats.size < 0 ||
		!Number.isSafeInteger(stats.uid) ||
		stats.uid < 0 ||
		!Number.isSafeInteger(stats.gid) ||
		stats.gid < 0 ||
		!Number.isSafeInteger(stats.mode) ||
		stats.mode < 0 ||
		stats.mode > 0xffff_ffff ||
		!Number.isSafeInteger(stats.atime) ||
		stats.atime < 0 ||
		stats.atime > Number.MAX_SAFE_INTEGER / 1000 ||
		!Number.isSafeInteger(stats.mtime) ||
		stats.mtime < 0 ||
		stats.mtime > Number.MAX_SAFE_INTEGER / 1000 ||
		typeof stats.isDirectory !== 'function' ||
		typeof stats.isFile !== 'function' ||
		typeof stats.isSymbolicLink !== 'function'
	) {
		throw new MachineSftpFailure('invalid_metadata', 'unknown');
	}
	let isDirectory: boolean;
	let isFile: boolean;
	let isSymbolicLink: boolean;
	try {
		isDirectory = stats.isDirectory();
		isFile = stats.isFile();
		isSymbolicLink = stats.isSymbolicLink();
	} catch (cause) {
		throw new MachineSftpFailure('invalid_metadata', 'unknown', { cause });
	}
	if (
		[isDirectory, isFile, isSymbolicLink].some((kind) => typeof kind !== 'boolean') ||
		Number(isDirectory) + Number(isFile) + Number(isSymbolicLink) > 1
	) {
		throw new MachineSftpFailure('invalid_metadata', 'unknown');
	}
	return {
		size: stats.size,
		uid: stats.uid,
		gid: stats.gid,
		mode: stats.mode,
		accessedAt: stats.atime,
		modifiedAt: stats.mtime,
		isDirectory,
		isFile,
		isSymbolicLink,
	};
}

function remoteStatus(error: unknown): 'eof' | 'not_found' | 'permission_denied' | 'unsupported' | 'failure' {
	const code =
		error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
			? error.code
			: null;
	switch (code) {
		case 1:
			return 'eof';
		case 2:
			return 'not_found';
		case 3:
			return 'permission_denied';
		case 8:
			return 'unsupported';
		default:
			return 'failure';
	}
}

function remoteFailure(error: unknown, outcome: 'failed' | 'unknown'): MachineSftpFailure {
	return new MachineSftpFailure('operation_failed', outcome, {
		cause: error,
		remoteStatus: remoteStatus(error),
	});
}

function directoryEntry(row: { filename: string; longname?: string; attrs: Stats }): MachineDirectoryEntry {
	if (
		!row ||
		typeof row.filename !== 'string' ||
		!row.filename ||
		row.filename === '.' ||
		row.filename === '..' ||
		// SFTP names are literal POSIX components, not terminal or shell input.
		/[/\u0000\ufffd]/u.test(row.filename) ||
		Buffer.byteLength(row.filename, 'utf8') > 255 ||
		(row.longname !== undefined && typeof row.longname !== 'string')
	) {
		throw new MachineSftpFailure('invalid_metadata', 'unknown');
	}
	return {
		name: row.filename,
		...(row.longname ? { longName: row.longname } : {}),
		info: toFileInfo(row.attrs),
	};
}

function isSftpEof(error: unknown): boolean {
	return error instanceof MachineSftpFailure && error.remoteStatus === 'eof';
}

function supportsPosixRename(sftp: SFTPWrapper): boolean {
	// ssh2 checks its negotiated extension map synchronously, before sending a
	// request. That local refusal has no SFTP status code and is not an unknown
	// remote mutation. Keep this vendor-specific capability check in the Adapter.
	if (!('_extensions' in sftp) || sftp._extensions === null || typeof sftp._extensions !== 'object') {
		throw new MachineSftpFailure('invalid_metadata', 'not_started');
	}
	return 'posix-rename@openssh.com' in sftp._extensions && sftp._extensions['posix-rename@openssh.com'] === '1';
}

function operationTimeout(options: MachineOperationOptions | undefined, fallback: number, ceilingMs?: number): number;
function operationTimeout(
	options?: MachineOperationOptions,
	fallback?: undefined,
	ceilingMs?: number,
): number | undefined;

function operationTimeout(
	options?: MachineOperationOptions,
	fallback?: number,
	ceilingMs = MACHINE_SFTP_MAX_METADATA_TIMEOUT_MS,
): number | undefined {
	const value = options?.timeoutMs ?? fallback;
	if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > ceilingMs)) {
		throw new RangeError('Invalid SFTP operation timeout');
	}
	return value;
}

export class SshSftpLease implements MachineSftpLease {
	private closed = false;
	private released = false;
	private closePromise: Promise<void> | null = null;
	private readonly streams = new Map<Readable | Writable, () => void>();
	private readonly pending = new Set<(error: Error) => void>();
	private readonly cleanupFailures = new FailureSummary();
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
		this.streams.clear();
		this.onEnded();
	}

	private markClosed(error: Error): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const reject of [...this.pending]) {
			try {
				reject(error);
			} catch (cause) {
				this.cleanupFailures.record(cause);
			}
		}
		for (const [stream, cleanup] of [...this.streams]) {
			try {
				cleanup();
			} catch (cause) {
				this.cleanupFailures.record(cause);
			}
			try {
				stream.destroy(error);
			} catch (cause) {
				this.cleanupFailures.record(cause);
			}
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
				} else if (value === undefined) {
					reject(new MachineSftpFailure('invalid_metadata', 'unknown'));
				} else {
					resolve(value);
				}
			};

			const failed = (error: Error) => finish(error);

			let dispatched = false;

			const retire = (): void => {
				// An already dispatched SFTP request may complete after local cancellation.
				// shutdown owns the cached close Promise for later cleanup consumers.
				void this.shutdown(new MachineSftpFailure('closed', 'unknown')).catch(() => undefined);
			};

			const aborted = () => {
				finish(new MachineSftpFailure('cancelled', dispatched ? 'unknown' : 'not_started'));
				if (dispatched) {
					retire();
				}
			};

			const timer = setTimeout(() => {
				finish(new MachineSftpFailure('timeout', 'unknown'));
				retire();
			}, limit);
			this.pending.add(failed);
			options?.signal?.addEventListener('abort', aborted, { once: true });
			if (options?.signal?.aborted) {
				aborted();
				return;
			}
			try {
				dispatched = true;
				invoke((error, value) => finish(error ? remoteFailure(error, 'failed') : null, value));
			} catch (cause) {
				finish(remoteFailure(cause, 'unknown'));
				retire();
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
			!Number.isSafeInteger(options.maxEntries) ||
			options.maxEntries < 1 ||
			options.maxEntries > 10000 ||
			!Number.isSafeInteger(options.maxMetadataBytes) ||
			options.maxMetadataBytes < 1 ||
			options.maxMetadataBytes > 2 * 1024 * 1024
		) {
			throw new RangeError('Invalid SFTP directory budget');
		}
		const deadline = Date.now() + operationTimeout(options, 30000);

		const remaining = (): MachineOperationOptions => {
			const timeoutMs = deadline - Date.now();
			if (timeoutMs < 1) {
				throw new MachineSftpFailure('timeout', 'unknown');
			}
			return options.signal === undefined ? { timeoutMs } : { timeoutMs, signal: options.signal };
		};

		const entries: MachineDirectoryEntry[] = [];
		// Count JSON array punctuation as part of the wire metadata budget.
		let metadataBytes = 2;
		let handle: Buffer;
		try {
			handle = await this.call<Buffer>((finish) => this.sftp.opendir(path, finish), remaining());
			if (!Buffer.isBuffer(handle) || handle.length === 0) {
				throw new MachineSftpFailure('invalid_metadata', 'unknown');
			}
		} catch (error) {
			if (error instanceof MachineSftpFailure && error.outcome !== 'unknown') {
				throw error;
			}
			// An OPEN may succeed remotely after this operation's callback was
			// already cancelled or timed out. Retire the whole lease rather than
			// retaining an unclosable unknown directory handle.
			try {
				await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'SFTP open and cleanup failed');
			}
			throw error;
		}
		let failure: unknown = null;
		try {
			while (true) {
				const rows = await this.call<Array<{ filename: string; attrs: Stats }>>(
					(finish) => this.sftp.readdir(handle, finish),
					remaining(),
				).catch((error: unknown) => {
					// SSH_FX_EOF is the end of this directory handle, not a read failure.
					if (isSftpEof(error)) {
						return null;
					}
					throw error;
				});
				if (rows === null) {
					break;
				}
				if (!Array.isArray(rows)) {
					throw new MachineSftpFailure('invalid_metadata', 'unknown');
				}
				for (const row of rows) {
					// SFTP servers may return these protocol navigation entries.
					if (row && (row.filename === '.' || row.filename === '..')) {
						continue;
					}
					const entry = directoryEntry(row);
					metadataBytes += (entries.length === 0 ? 0 : 1) + Buffer.byteLength(JSON.stringify(entry), 'utf8');
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
			let closing: unknown = null;
			try {
				await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
			} catch (error) {
				closing = error;
			}
			const failures = [failure, cleanup, closing].filter((item) => item !== null);
			throw failures.length === 1 ? cleanup : new AggregateError(failures, 'SFTP listing/handle cleanup failed');
		}
		// A timed-out/cancelled READDIR can still complete asynchronously.
		// Retire the lease rather than accepting future operations on that handle.
		if (failure instanceof MachineSftpFailure && (failure.reason === 'timeout' || failure.reason === 'cancelled')) {
			try {
				await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
			} catch (cleanup) {
				throw new AggregateError([failure, cleanup], 'SFTP interrupted listing cleanup failed');
			}
		}
		if (failure !== null) {
			throw failure;
		}
		return entries;
	}

	async *scan(path: string, options?: MachineOperationOptions): AsyncIterable<MachineDirectoryEntry> {
		this.ensure(options);
		const deadline = Date.now() + operationTimeout(options, 30000);

		const remaining = (): MachineOperationOptions => {
			const timeoutMs = deadline - Date.now();
			if (timeoutMs < 1) {
				throw new MachineSftpFailure('timeout', 'unknown');
			}
			return options?.signal === undefined ? { timeoutMs } : { timeoutMs, signal: options.signal };
		};

		let handle: Buffer;
		try {
			handle = await this.call<Buffer>((finish) => this.sftp.opendir(path, finish), remaining());
			if (!Buffer.isBuffer(handle) || handle.length === 0) {
				throw new MachineSftpFailure('invalid_metadata', 'unknown');
			}
		} catch (error) {
			if (error instanceof MachineSftpFailure && error.outcome !== 'unknown') {
				throw error;
			}
			try {
				await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
			} catch (cleanup) {
				throw new AggregateError([error, cleanup], 'SFTP scan open and cleanup failed');
			}
			throw error;
		}
		let failure: unknown = null;
		try {
			try {
				while (true) {
					const rows = await this.call<Array<{ filename: string; longname?: string; attrs: Stats }>>(
						(finish) => this.sftp.readdir(handle, finish),
						remaining(),
					).catch((error: unknown) => {
						if (isSftpEof(error)) {
							return null;
						}
						throw error;
					});
					if (rows === null) {
						break;
					}
					if (!Array.isArray(rows)) {
						throw new MachineSftpFailure('invalid_metadata', 'unknown');
					}
					for (const row of rows) {
						// SFTP servers may return these protocol navigation entries.
						if (row && (row.filename === '.' || row.filename === '..')) {
							continue;
						}
						yield directoryEntry(row);
					}
				}
			} catch (error) {
				failure = error;
			}
		} finally {
			let cleanupFailure: unknown = null;
			try {
				await this.voidCall((finish) => this.sftp.close(handle, finish), { timeoutMs: 2000 });
			} catch (cleanup) {
				cleanupFailure = cleanup;
				try {
					await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
				} catch (closing) {
					cleanupFailure = new AggregateError([cleanup, closing], 'SFTP scan handle cleanup failed');
				}
			}
			if (
				failure instanceof MachineSftpFailure &&
				(failure.reason === 'timeout' || failure.reason === 'cancelled')
			) {
				try {
					await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
				} catch (cleanup) {
					cleanupFailure =
						cleanupFailure === null
							? cleanup
							: new AggregateError([cleanupFailure, cleanup], 'SFTP interrupted scan cleanup failed');
				}
			}
			if (failure !== null && cleanupFailure !== null) {
				throw new AggregateError([failure, cleanupFailure], 'SFTP scan failed and cleanup failed');
			}
			if (failure !== null) {
				throw failure;
			}
			if (cleanupFailure !== null) {
				throw cleanupFailure;
			}
		}
	}

	private track<T extends Readable | Writable>(stream: T, options?: MachineOperationOptions): T {
		// B2 long-lived byte streams have a distinct bounded lifetime; the old
		// per-request 5-minute SFTP RPC cap must not terminate legitimate large
		// transfers. Control RPCs still retain their separate 5-minute ceiling.
		const limit = operationTimeout(options, 30000, 60 * 60 * 1000);

		const abortStream = (reason: 'cancelled' | 'timeout'): void => {
			stream.destroy(new MachineSftpFailure(reason, 'unknown'));
			void this.shutdown(new MachineSftpFailure('closed', 'unknown')).catch(() => undefined);
		};

		const aborted = () => abortStream('cancelled');

		const timer = limit === undefined ? undefined : setTimeout(() => abortStream('timeout'), limit);

		const cleanup = () => {
			clearTimeout(timer);
			options?.signal?.removeEventListener('abort', aborted);
		};

		this.streams.set(stream, cleanup);
		stream.on('error', () => undefined);
		// ssh2 suppresses close after an errored destroy; a failed stream must
		// still release its local deadline and cancellation listener.
		stream.once('error', cleanup);
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
		operationTimeout(options, undefined, 60 * 60 * 1000);
		const start = options?.start;
		const end = options?.end;
		if (
			(start !== undefined && (!Number.isSafeInteger(start) || start < 0)) ||
			(end !== undefined && (!Number.isSafeInteger(end) || end < 0 || end < (start ?? 0)))
		) {
			throw new RangeError('Invalid inclusive SFTP read byte range');
		}
		try {
			return this.track(
				this.sftp.createReadStream(path, {
					...(options?.start === undefined ? {} : { start: options.start }),
					...(options?.end === undefined ? {} : { end: options.end }),
				}),
				options,
			);
		} catch (cause) {
			throw new MachineSftpFailure('operation_failed', 'not_started', { cause });
		}
	}

	async *readChunks(path: string, options?: MachineSftpReadOptions): AsyncIterable<Uint8Array> {
		this.ensure(options);
		const start = options?.start ?? 0;
		const end = options?.end;
		if (
			!Number.isSafeInteger(start) ||
			start < 0 ||
			(end !== undefined && (!Number.isSafeInteger(end) || end < start))
		) {
			throw new RangeError('Invalid inclusive SFTP read byte range');
		}
		const deadline = Date.now() + operationTimeout(options, 60 * 60 * 1000, 60 * 60 * 1000);

		const remaining = (): MachineOperationOptions => {
			const timeoutMs = Math.min(deadline - Date.now(), 300000);
			if (timeoutMs < 1) {
				throw new MachineSftpFailure('timeout', 'unknown');
			}
			return options?.signal ? { timeoutMs, signal: options.signal } : { timeoutMs };
		};

		const handle = await this.call<Buffer>((finish) => this.sftp.open(path, 'r', finish), remaining());
		if (!Buffer.isBuffer(handle) || handle.length === 0) {
			throw new MachineSftpFailure('invalid_metadata', 'unknown');
		}
		// ssh2's ReadStream waits for every READ reply before dispatching the
		// next one. At 80-200ms RTT, this serializes a multi-MiB HTTP body.
		// Keep the pre-refactor 1MiB window of acknowledged 32KiB READs ahead,
		// emit strictly in offset order, and never buffer an unbounded file.
		const packetBytes = 32 * 1024;
		const windowSize = 32;
		const queue: Array<{ length: number; pending: Promise<Buffer> }> = [];
		let nextOffset = start;
		let failure: unknown = null;

		const readPart = async (position: number, length: number): Promise<Buffer> => {
			const buffer = Buffer.allocUnsafe(length);
			let received = 0;
			while (received < length) {
				let bytes: number;
				try {
					bytes = await this.call<number>(
						(finish) =>
							this.sftp.read(handle, buffer, received, length - received, position + received, finish),
						remaining(),
					);
				} catch (cause) {
					if (isSftpEof(cause)) {
						break;
					}
					throw cause;
				}
				if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > length - received) {
					throw new MachineSftpFailure('invalid_metadata', 'unknown');
				}
				if (bytes === 0) {
					break;
				}
				received += bytes;
			}
			return buffer.subarray(0, received);
		};

		const fill = () => {
			while (queue.length < windowSize && (end === undefined || nextOffset <= end)) {
				const length = end === undefined ? packetBytes : Math.min(packetBytes, end - nextOffset + 1);
				const pending = readPart(nextOffset, length);
				// A later offset can fail before its predecessor; own the rejection
				// now so it is never an unhandled Promise during backpressure.
				void pending.catch(() => undefined);
				queue.push({ length, pending });
				nextOffset += length;
			}
		};

		try {
			fill();
			while (queue.length) {
				const current = queue.shift()!;
				const chunk = await current.pending;
				if (chunk.length === current.length) {
					fill();
				}
				if (chunk.length > 0) {
					yield chunk;
				}
				if (chunk.length < current.length) {
					break;
				}
			}
		} catch (cause) {
			failure = cause;
		} finally {
			const remainingReads = await Promise.allSettled(queue.map((item) => item.pending));
			if (failure === null) {
				const rejected = remainingReads.find((result) => result.status === 'rejected');
				if (rejected?.status === 'rejected') {
					failure = rejected.reason;
				}
			}
			try {
				if (this.closed || options?.signal?.aborted) {
					// A cancelled READ has no remote mutation. Confirmed whole-lease
					// shutdown retires the handle, unlike CLOSE on a closed channel.
					await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
				} else {
					await this.voidCall((finish) => this.sftp.close(handle, finish), { timeoutMs: 2000 });
				}
			} catch (cleanup) {
				try {
					await this.shutdown(new MachineSftpFailure('closed', 'unknown'));
				} catch (closing) {
					throw new AggregateError(
						[failure, cleanup, closing].filter((value) => value !== null),
						'SFTP read cleanup failed',
					);
				}
				throw new AggregateError(
					[failure, cleanup].filter((value) => value !== null),
					'SFTP read handle cleanup failed',
				);
			}
		}
		if (failure !== null) {
			throw failure;
		}
	}

	write(path: string, options?: MachineSftpWriteOptions): Writable {
		this.ensure(options);
		operationTimeout(options, undefined, 60 * 60 * 1000);
		try {
			return this.track(
				this.sftp.createWriteStream(path, {
					flags: options?.flags ?? 'w',
					...(options?.mode === undefined ? {} : { mode: options.mode }),
				}),
				options,
			);
		} catch (cause) {
			throw new MachineSftpFailure('operation_failed', 'not_started', { cause });
		}
	}

	async writeFile(path: string, bytes: Uint8Array, options?: MachineSftpWriteOptions): Promise<void> {
		const stream = this.write(path, options);
		stream.end(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
		try {
			await finished(stream, { cleanup: true });
		} catch (cause) {
			if (cause instanceof MachineSftpFailure) {
				throw cause;
			}
			throw remoteFailure(cause, 'unknown');
		}
	}

	realpath(path: string, options?: MachineOperationOptions): Promise<string> {
		return this.call<string>((finish) => this.sftp.realpath(path, finish), options).then((value) => {
			if (typeof value !== 'string' || !value || /[\u0000\ufffd]/u.test(value)) {
				throw new MachineSftpFailure('invalid_metadata', 'unknown');
			}
			return value;
		});
	}

	readlink(path: string, options?: MachineOperationOptions): Promise<string> {
		return this.call<string>((finish) => this.sftp.readlink(path, finish), options).then((value) => {
			if (
				typeof value !== 'string' ||
				!value ||
				value.includes('\0') ||
				Buffer.byteLength(value, 'utf8') > 4096
			) {
				throw new MachineSftpFailure('invalid_metadata', 'unknown');
			}
			return value;
		});
	}

	symlink(targetPath: string, linkPath: string, options?: MachineOperationOptions): Promise<void> {
		return this.voidCall((finish) => this.sftp.symlink(targetPath, linkPath, finish), options);
	}

	chmod(path: string, mode: number, options?: MachineOperationOptions): Promise<void> {
		if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) {
			throw new RangeError('Invalid SFTP chmod mode');
		}
		return this.voidCall((finish) => this.sftp.chmod(path, mode, finish), options);
	}

	utimes(path: string, accessedAt: number, modifiedAt: number, options?: MachineOperationOptions): Promise<void> {
		if (![accessedAt, modifiedAt].every((value) => Number.isSafeInteger(value) && value >= 0)) {
			throw new RangeError('Invalid SFTP timestamps');
		}
		return this.voidCall((finish) => this.sftp.utimes(path, accessedAt, modifiedAt, finish), options);
	}

	private voidCall(
		invoke: (finish: (error?: Error | null) => void) => void,
		options?: MachineOperationOptions,
	): Promise<void> {
		return this.call<true>((finish) => invoke((error) => finish(error, true)), options).then(() => undefined);
	}

	rename(from: string, to: string, options?: MachineOperationOptions): Promise<void> {
		return this.voidCall((finish) => this.sftp.rename(from, to, finish), options);
	}

	async replace(from: string, to: string, options?: MachineOperationOptions): Promise<void> {
		const deadline = Date.now() + operationTimeout(options, 30000);

		const remaining = (): MachineOperationOptions => {
			const timeoutMs = deadline - Date.now();
			if (timeoutMs < 1) {
				throw new MachineSftpFailure('timeout', 'not_started');
			}
			return { timeoutMs, signal: options?.signal };
		};

		if (supportsPosixRename(this.sftp)) {
			try {
				await this.voidCall((finish) => this.sftp.ext_openssh_rename(from, to, finish), remaining());
				return;
			} catch (error) {
				// Once dispatched, only explicit unsupported permits the fallback.
				if (!(error instanceof MachineSftpFailure) || error.remoteStatus !== 'unsupported') {
					throw error;
				}
			}
		}

		let destinationExists = true;
		try {
			await this.lstat(to, remaining());
		} catch (error) {
			if (error instanceof MachineSftpFailure && error.remoteStatus === 'not_found') {
				destinationExists = false;
			} else {
				throw error;
			}
		}
		if (!destinationExists) {
			await this.rename(from, to, remaining());
			return;
		}

		const backup = from + '.previous-' + randomUUID();
		await this.rename(to, backup, remaining());
		try {
			await this.rename(from, to, remaining());
		} catch (error) {
			// A callback failure proves the second rename did not happen, so the
			// backup can be restored. Unknown delivery must not race a late rename.
			if (error instanceof MachineSftpFailure && error.outcome !== 'unknown') {
				try {
					await this.rename(backup, to, { timeoutMs: 2000 });
				} catch (restore) {
					throw new MachineSftpFailure('operation_failed', 'unknown', {
						cause: new AggregateError([error, restore], 'SFTP replacement restore failed'),
					});
				}
			}
			throw new MachineSftpFailure('operation_failed', 'unknown', { cause: error });
		}
		try {
			await this.remove(backup, { timeoutMs: 2000 });
		} catch (cleanup) {
			// Destination replacement is known to have happened, but the remote
			// filesystem is not fully converged while the backup remains.
			throw new MachineSftpFailure('operation_failed', 'unknown', { cause: cleanup });
		}
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
			const failures = this.cleanupFailures.errors();
			return failures.length
				? Promise.reject(new AggregateError(failures, 'SFTP cleanup failed'))
				: Promise.resolve();
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
			const failures = this.cleanupFailures.errors();
			if (failure !== undefined) {
				failures.push(failure);
			}
			if (failures.length === 0) {
				resolve();
			} else {
				reject(new AggregateError(failures, 'SFTP cleanup failed'));
			}
		};

		const closed = () => finish();

		let timer = setTimeout(() => {
			timer = setTimeout(() => finish(new Error('SFTP close confirmation unknown')), 2000);
			try {
				this.sftp.destroy();
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
