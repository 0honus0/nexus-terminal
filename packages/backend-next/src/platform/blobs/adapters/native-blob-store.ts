import { constants } from 'node:fs';
import { mkdir, open, realpath, statfs, unlink, link } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { BlobStore, BlobFacts, BlobRange } from '../blob-store.js';
import { BlobFailure } from '../blob-store.js';

function failure(error: unknown, writing = false): BlobFailure {
	if (error instanceof BlobFailure) {
		return error;
	}
	const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
	return new BlobFailure(
		code === 'ENOENT' ? 'not_found' : code === 'EEXIST' ? 'conflict' : writing ? 'io_unknown' : 'unavailable',
		{ cause: error },
	);
}

export class NativeBlobStore implements BlobStore {
	private constructor(private readonly directory: string) {}

	static async open(directory: string): Promise<NativeBlobStore> {
		try {
			await mkdir(directory, { recursive: true, mode: 0o700 });
			return new NativeBlobStore(await realpath(resolve(directory)));
		} catch (error) {
			throw failure(error);
		}
	}

	private async syncDirectory(): Promise<void> {
		const handle = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY);
		let failure: unknown = null;
		try {
			await handle.sync();
		} catch (error) {
			failure = error;
			throw error;
		} finally {
			try {
				await handle.close();
			} catch (cleanup) {
				throw new BlobFailure('cleanup_failed', {
					cause:
						failure === null
							? cleanup
							: new AggregateError([failure, cleanup], 'Blob directory sync and close failed'),
				});
			}
		}
	}

	private path(key: string, staging = false): string {
		if (!/^[a-f0-9-]{36}$/u.test(key)) {
			throw new BlobFailure('unavailable');
		}
		return join(this.directory, key + (staging ? '.part' : '.blob'));
	}

	async freeBytes(): Promise<number> {
		try {
			const facts = await statfs(this.directory);
			const bytes = facts.bavail * facts.bsize;
			if (!Number.isSafeInteger(bytes) || bytes < 0) {
				throw new BlobFailure('unavailable');
			}
			return bytes;
		} catch (error) {
			throw failure(error);
		}
	}

	async size(key: string): Promise<number> {
		let handle;
		let readFailure: unknown = null;
		try {
			handle = await open(this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
			const facts = await handle.stat();
			if (!facts.isFile() || !Number.isSafeInteger(facts.size) || facts.size < 0) {
				throw new BlobFailure('unavailable');
			}
			return facts.size;
		} catch (cause) {
			readFailure = cause;
			throw failure(cause);
		} finally {
			if (handle) {
				try {
					await handle.close();
				} catch (cleanup) {
					const cause =
						readFailure === null
							? cleanup
							: new AggregateError([readFailure, cleanup], 'Blob size and close failed');
					throw new BlobFailure('cleanup_failed', { cause });
				}
			}
		}
	}

	async write(
		key: string,
		source: AsyncIterable<Uint8Array>,
		expectedBytes: number,
		signal: AbortSignal,
	): Promise<BlobFacts> {
		if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
			throw new BlobFailure('limit_exceeded');
		}
		const path = this.path(key, true);
		let created = false;
		let published = false;
		try {
			const handle = await open(
				path,
				constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
				0o600,
			);
			created = true;
			let bytes = 0;
			const digest = createHash('sha256');
			let writeFailure: unknown = null;
			try {
				for await (const chunk of source) {
					signal.throwIfAborted();
					bytes += chunk.byteLength;
					if (bytes > expectedBytes) {
						throw new BlobFailure('limit_exceeded');
					}
					let offset = 0;
					while (offset < chunk.byteLength) {
						const written = await handle.write(chunk, offset, chunk.byteLength - offset);
						if (written.bytesWritten < 1) {
							throw new BlobFailure('io_unknown');
						}
						offset += written.bytesWritten;
					}
					digest.update(chunk);
				}
				if (bytes !== expectedBytes) {
					throw new BlobFailure('limit_exceeded');
				}
				signal.throwIfAborted();
				await handle.sync();
			} catch (error) {
				writeFailure = error;
				throw error;
			} finally {
				try {
					await handle.close();
				} catch (cleanup) {
					const cause =
						writeFailure === null
							? cleanup
							: new AggregateError([writeFailure, cleanup], 'Blob write and handle close failed');
					throw new BlobFailure('cleanup_failed', { cause });
				}
			}
			// Hard link publishes without overwriting a preexisting key; both names remain
			// owned until staging removal is confirmed. A later failure is never 'not written'.
			await link(path, this.path(key));
			published = true;
			await unlink(path);
			created = false;
			await this.syncDirectory();
			return { bytes, sha256: digest.digest('hex') };
		} catch (error) {
			const errors: unknown[] = [error];
			if (created) {
				try {
					await unlink(path);
				} catch (cleanup) {
					errors.push(cleanup);
				}
			}
			const cause = errors.length === 1 ? error : new AggregateError(errors, 'Blob write and cleanup failed');
			if (error instanceof BlobFailure && error.kind === 'cleanup_failed') {
				throw new BlobFailure('cleanup_failed', { cause });
			}
			if (published || errors.length > 1) {
				throw new BlobFailure('io_unknown', { cause });
			}
			throw failure(cause, true);
		}
	}

	async *read(key: string, range: BlobRange, signal: AbortSignal): AsyncIterable<Uint8Array> {
		let handle;
		let readFailure: unknown = null;
		try {
			if (
				!Number.isSafeInteger(range.start) ||
				range.start < 0 ||
				!Number.isSafeInteger(range.endInclusive) ||
				range.endInclusive < range.start
			) {
				throw new BlobFailure('limit_exceeded');
			}
			handle = await open(this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW);
			const facts = await handle.stat();
			if (!facts.isFile() || range.endInclusive >= facts.size) {
				throw new BlobFailure('limit_exceeded');
			}
			let offset = range.start;
			while (offset <= range.endInclusive) {
				signal.throwIfAborted();
				const size = Math.min(65536, range.endInclusive - offset + 1);
				const buffer = Buffer.allocUnsafe(size);
				const read = await handle.read(buffer, 0, size, offset);
				if (read.bytesRead < 1) {
					throw new BlobFailure('unavailable');
				}
				offset += read.bytesRead;
				yield buffer.subarray(0, read.bytesRead);
			}
		} catch (error) {
			readFailure = error;
			if (signal.aborted && error === signal.reason) {
				throw new BlobFailure('aborted', { cause: error });
			}
			throw failure(error);
		} finally {
			if (handle) {
				try {
					await handle.close();
				} catch (cleanup) {
					const cause =
						readFailure === null
							? cleanup
							: new AggregateError([readFailure, cleanup], 'Blob read and handle close failed');
					throw new BlobFailure('cleanup_failed', { cause });
				}
			}
		}
	}

	async remove(key: string): Promise<void> {
		const results = await Promise.allSettled(
			[this.path(key), this.path(key, true)].map(async (path) => {
				try {
					await unlink(path);
				} catch (error) {
					if (!(error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
						throw error;
					}
				}
			}),
		);
		const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
		try {
			await this.syncDirectory();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length) {
			const resourceUnconfirmed = errors.some(
				(error) => error instanceof BlobFailure && error.kind === 'cleanup_failed',
			);
			throw new BlobFailure(resourceUnconfirmed ? 'cleanup_failed' : 'io_unknown', {
				cause: new AggregateError(errors, 'Blob removal incomplete'),
			});
		}
	}
}
