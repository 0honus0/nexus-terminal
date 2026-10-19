import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { TerminalCleanupFailure } from '../terminal-errors.js';
import type { SuspendedTerminalLogPort, SuspendedTerminalLogSlice } from '../suspended-log-port.js';

const MAX_VISIBLE_BYTES = 100 * 1024 * 1024;
const COMPACT_SLACK_BYTES = 32 * 1024 * 1024;
const MAX_PAGE_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/u;

interface Writer {
	tail: Promise<void>;
	size: number | null;
	totalOffset: number;
	revision: number;
	error: unknown;
}

/** Restart clears only transient suspended logs; no SSH session handle is
 * serialized to disk. All mutations of one file are serialized in a chain.
 */
export class LocalSuspendedTerminalLog implements SuspendedTerminalLogPort {
	private readonly directory: string;
	private readonly writers = new Map<string, Writer>();
	private readonly deleting = new Map<string, Promise<void>>();
	private accepting = true;
	private closePromise: Promise<void> | null = null;

	constructor(dataDirectory: string) {
		// Never share/delete the legacy backend's active suspend-log directory.
		this.directory = path.join(dataDirectory, 'temp_backend_next_suspended_ssh_logs');
	}

	private file(id: string): string {
		if (!SAFE_ID.test(id)) {
			throw new Error('Invalid suspended log identifier');
		}
		return path.join(this.directory, id + '.log');
	}

	private writer(id: string): Writer {
		this.file(id);
		let writer = this.writers.get(id);
		if (!writer) {
			writer = { tail: Promise.resolve(), size: null, totalOffset: 0, revision: 0, error: null };
			this.writers.set(id, writer);
		}
		return writer;
	}

	private enqueue(id: string, action: (writer: Writer) => Promise<void>): Promise<void> {
		if (!this.accepting || this.deleting.has(id)) {
			return Promise.reject(new Error('Suspended log store closed'));
		}
		const writer = this.writer(id);
		writer.revision++;
		const operation = writer.tail
			.then(async () => {
				if (writer.error !== null) {
					throw writer.error;
				}
				await action(writer);
			})
			.catch((error) => {
				writer.error = error;
				throw error;
			});
		writer.tail = operation.catch(() => undefined);
		return operation;
	}

	async clearAll(): Promise<void> {
		if (!this.accepting) {
			throw new Error('Suspended log store closed');
		}
		await Promise.allSettled([...this.writers.values()].map((writer) => writer.tail));
		this.writers.clear();
		await fs.rm(this.directory, { recursive: true, force: true });
	}

	async append(id: string, data: Uint8Array): Promise<number> {
		const file = this.file(id);
		const chunk = Buffer.from(data);
		if (!chunk.byteLength) {
			return this.position(id);
		}
		let written = 0;
		await this.enqueue(id, async (writer) => {
			if (writer.size === null) {
				await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
				try {
					writer.size = (await fs.stat(file)).size;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
						throw error;
					}
					writer.size = 0;
				}
				writer.totalOffset = writer.size;
			}
			if (!Number.isSafeInteger(writer.totalOffset + chunk.byteLength)) {
				throw new RangeError('Suspended log byte offset exhausted');
			}
			const retained = chunk.byteLength > MAX_VISIBLE_BYTES ? chunk.subarray(-MAX_VISIBLE_BYTES) : chunk;
			if (retained.byteLength >= MAX_VISIBLE_BYTES) {
				// Keep an already opened history-export file handle immutable.
				// Truncating the live inode can corrupt an in-flight download.
				const temporary = file + '.replace-' + process.pid + '-' + writer.revision;
				try {
					await fs.writeFile(temporary, retained, { mode: 0o600 });
					await fs.rename(temporary, file);
				} catch (error) {
					try {
						await fs.rm(temporary, { force: true });
					} catch (cleanup) {
						throw new TerminalCleanupFailure([error, cleanup]);
					}
					throw error;
				}
				writer.size = retained.byteLength;
			} else if (writer.size + retained.byteLength > MAX_VISIBLE_BYTES + COMPACT_SLACK_BYTES) {
				// Whole-batch compaction avoids copying 100 MiB for each 32 KiB PTY write.
				const drop = writer.size + retained.byteLength - MAX_VISIBLE_BYTES;
				const temporary = file + '.trim-' + process.pid + '-' + writer.revision;
				try {
					await pipeline(
						createReadStream(file, { start: drop }),
						createWriteStream(temporary, { mode: 0o600 }),
					);
					await fs.appendFile(temporary, retained);
					await fs.rename(temporary, file);
				} catch (error) {
					try {
						await fs.rm(temporary, { force: true });
					} catch (cleanup) {
						throw new TerminalCleanupFailure([error, cleanup]);
					}
					throw error;
				}
				writer.size = MAX_VISIBLE_BYTES;
			} else {
				await fs.appendFile(file, retained, { mode: 0o600 });
				writer.size += retained.byteLength;
			}
			writer.totalOffset += chunk.byteLength;
			written = writer.totalOffset;
		});
		return written;
	}

	async flush(id: string): Promise<void> {
		if (!this.accepting) {
			throw new Error('Suspended log store closed');
		}
		const writer = this.writer(id);
		await writer.tail;
		if (writer.error !== null) {
			throw writer.error;
		}
	}

	/** Readers join the same file mutation chain as appends/compaction. A failed
	 * read does not poison a healthy writer, but a previous write failure does. */
	private readSerial<T>(id: string, action: (writer: Writer) => Promise<T>): Promise<T> {
		if (!this.accepting || this.deleting.has(id)) {
			return Promise.reject(new Error('Suspended log is being deleted'));
		}
		const writer = this.writer(id);
		const result = writer.tail.then(async () => {
			if (writer.error !== null) {
				throw writer.error;
			}
			return action(writer);
		});
		writer.tail = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	position(id: string): Promise<number> {
		return this.readSerial(id, async (writer) => writer.totalOffset);
	}

	async readTail(id: string, maxBytes: number): Promise<SuspendedTerminalLogSlice> {
		return this.readSerial(id, (writer) => this.readSlice(id, writer, writer.totalOffset, maxBytes));
	}

	async readBefore(id: string, beforeOffset: number, maxBytes: number): Promise<SuspendedTerminalLogSlice> {
		if (!Number.isSafeInteger(beforeOffset) || beforeOffset < 0) {
			throw new RangeError('Invalid suspended history cursor');
		}
		return this.readSerial(id, (writer) =>
			this.readSlice(id, writer, Math.min(beforeOffset, writer.totalOffset), maxBytes),
		);
	}

	private async readSlice(
		id: string,
		writer: Writer,
		beforeOffset: number,
		maxBytes: number,
	): Promise<SuspendedTerminalLogSlice> {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
			throw new RangeError('Invalid suspended history page size');
		}
		const totalBytes = writer.totalOffset;
		const physicalBytes = writer.size ?? 0;
		// Logical offsets never change when physical bytes are rotated or trimmed.
		const oldestOffset = Math.max(0, totalBytes - MAX_VISIBLE_BYTES);
		const before = Math.max(oldestOffset, beforeOffset);
		const startOffset = Math.max(oldestOffset, before - Math.min(maxBytes, MAX_PAGE_BYTES));
		if (totalBytes > 0 && physicalBytes === 0) {
			throw new Error('Suspended log disappeared before history could be read');
		}
		if (before === startOffset || physicalBytes === 0) {
			return { data: new Uint8Array(), startOffset, endOffset: before, totalBytes, oldestOffset };
		}
		const file = this.file(id);
		const handle = await fs.open(file, 'r');
		let primary: unknown = null;
		try {
			const physicalOldest = totalBytes - (await handle.stat()).size;
			const position = startOffset - physicalOldest;
			if (position < 0) {
				throw new Error('Suspended log page was compacted');
			}
			const length = before - startOffset;
			const data = Buffer.alloc(length);
			let read = 0;
			while (read < length) {
				const { bytesRead } = await handle.read(data, read, length - read, position + read);
				if (bytesRead === 0) {
					throw new Error('Suspended log page truncated');
				}
				read += bytesRead;
			}
			return { data, startOffset, endOffset: before, totalBytes, oldestOffset };
		} catch (error) {
			primary = error;
			throw error;
		} finally {
			try {
				await handle.close();
			} catch (error) {
				throw new TerminalCleanupFailure(primary === null ? [error] : [primary, error]);
			}
		}
	}

	async openRead(id: string): Promise<Readable> {
		return this.readSerial(id, async (writer) => {
			let handle: Awaited<ReturnType<typeof fs.open>>;
			try {
				handle = await fs.open(this.file(id), 'r');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT' && writer.totalOffset === 0) {
					return Readable.from([]);
				}
				throw error;
			}
			try {
				const total = (await handle.stat()).size;
				if (total === 0) {
					await handle.close();
					return Readable.from([]);
				}
				// Pin this inode and its upper bound before a later compaction/rename.
				return handle.createReadStream({
					start: Math.max(0, total - MAX_VISIBLE_BYTES),
					end: total - 1,
					highWaterMark: 64 * 1024,
					autoClose: true,
				});
			} catch (error) {
				try {
					await handle.close();
				} catch (cleanup) {
					throw new TerminalCleanupFailure([error, cleanup]);
				}
				throw error;
			}
		});
	}

	async delete(id: string): Promise<void> {
		const file = this.file(id);
		const inProgress = this.deleting.get(id);
		if (inProgress) {
			return inProgress;
		}
		if (!this.accepting) {
			throw new Error('Suspended log store closed');
		}
		const writer = this.writer(id);
		// Removal is a serialized recovery operation even after a failed write;
		// it must never race a later append or reopen a deleted file.
		const operation = writer.tail.then(async () => {
			await fs.rm(file, { force: true });
			if (this.writers.get(id) === writer) {
				this.writers.delete(id);
			}
		});
		this.deleting.set(id, operation);
		writer.tail = operation.then(
			() => undefined,
			() => undefined,
		);
		try {
			await operation;
		} catch (error) {
			writer.error = error;
			throw error;
		} finally {
			this.deleting.delete(id);
		}
	}

	close(): Promise<void> {
		if (this.closePromise) {
			return this.closePromise;
		}
		this.accepting = false;
		this.closePromise = (async () => {
			await Promise.allSettled([...this.writers.values()].map((writer) => writer.tail));
			const errors = [...this.writers.values()].flatMap((writer) =>
				writer.error === null ? [] : [writer.error],
			);
			if (errors.length) {
				throw new AggregateError(errors, 'Suspended log cleanup unconfirmed');
			}
		})();
		return this.closePromise;
	}
}
