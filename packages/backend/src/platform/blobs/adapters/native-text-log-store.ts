import { constants } from 'node:fs';
import { mkdir, open, opendir, realpath, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { TextLogStore, TextLogWriter, TextLogPage } from '../text-log-store.js';
import { TextLogFailure } from '../text-log-store.js';

// Each index entry records the committed UTF-8 end offset and the opaque record tag.
const ENTRY_BYTES = 16;
const KEY = /^[a-f0-9-]{36}$/u;

function code(error: unknown): unknown {
	return error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
}

function failure(error: unknown): TextLogFailure {
	return error instanceof TextLogFailure
		? error
		: new TextLogFailure(code(error) === 'ENOENT' ? 'not_found' : 'unavailable', { cause: error });
}

async function closeAll(handles: FileHandle[]): Promise<void> {
	const results = await Promise.allSettled(handles.map((handle) => handle.close()));
	const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
	if (errors.length) {
		throw new TextLogFailure('cleanup_failed', { cause: new AggregateError(errors) });
	}
}

async function readExact(handle: FileHandle, size: number, offset: number): Promise<Buffer> {
	const bytes = Buffer.alloc(size);
	let read = 0;
	while (read < size) {
		const result = await handle.read(bytes, read, size - read, offset + read);
		if (!result.bytesRead) {
			throw new TextLogFailure('unavailable');
		}
		read += result.bytesRead;
	}
	return bytes;
}

function safe(value: bigint): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new TextLogFailure('unavailable');
	}
	return number;
}

async function waitForSpace<T>(
	work: () => Promise<T>,
	signal: AbortSignal,
	blocked: (waiting: boolean) => void,
): Promise<T> {
	for (;;) {
		signal.throwIfAborted();
		try {
			const result = await work();
			blocked(false);
			return result;
		} catch (error) {
			if (code(error) !== 'ENOSPC' && code(error) !== 'EDQUOT') {
				throw error;
			}
			blocked(true);
			await delay(1000, undefined, { signal });
		}
	}
}

export class NativeTextLogStore implements TextLogStore {
	private readonly writers = new Map<string, { bytes: number; entries: number; handles: FileHandle[] }>();
	private readonly readers = new Map<string, number>();

	private constructor(private readonly directory: string) {}

	static async open(directory: string): Promise<NativeTextLogStore> {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		return new NativeTextLogStore(await realpath(directory));
	}

	private path(key: string, extension: 'log' | 'index'): string {
		if (!KEY.test(key)) {
			throw new TextLogFailure('unavailable');
		}
		return join(this.directory, key + '.' + extension);
	}

	async create(key: string): Promise<TextLogWriter> {
		const handles: FileHandle[] = [];
		try {
			const flags = constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW;
			const data = await open(this.path(key, 'log'), flags, 0o600);
			handles.push(data);
			const index = await open(this.path(key, 'index'), flags, 0o600);
			handles.push(index);
			const state = { bytes: 0, entries: 0, handles };
			this.writers.set(key, state);
			let pending: Promise<void> | null = null;
			let closing: Promise<void> | null = null;
			let failed = false;
			let flushed = false;

			const write = async (
				handle: FileHandle,
				bytes: Buffer,
				position: number,
				signal: AbortSignal,
				blocked: (waiting: boolean) => void,
			) => {
				let written = 0;
				while (written < bytes.length) {
					const result = await waitForSpace(
						() => handle.write(bytes, written, bytes.length - written, position + written),
						signal,
						blocked,
					);
					if (!result.bytesWritten) {
						throw new TextLogFailure('unavailable');
					}
					written += result.bytesWritten;
				}
			};

			return {
				append: (record, signal, blocked) => {
					if (closing || pending || failed || !Number.isSafeInteger(record.tag) || record.tag < 0) {
						return Promise.reject(new TextLogFailure('unavailable'));
					}
					pending = Promise.resolve()
						.then(async () => {
							flushed = false;
							const bytes = Buffer.from(record.text);
							if (!bytes.length) {
								return;
							}
							const end = state.bytes + bytes.length;
							if (!Number.isSafeInteger(end)) {
								throw new TextLogFailure('unavailable');
							}
							const entry = Buffer.alloc(ENTRY_BYTES);
							entry.writeBigUInt64LE(BigInt(end), 0);
							entry.writeBigUInt64LE(BigInt(record.tag), 8);
							await write(data, bytes, state.bytes, signal, blocked);
							await write(index, entry, state.entries * ENTRY_BYTES, signal, blocked);
							state.bytes = end;
							state.entries++;
						})
						.catch((error: unknown) => {
							failed = true;
							throw failure(error);
						})
						.finally(() => {
							pending = null;
						});
					return pending;
				},

				flush: (signal, blocked) => {
					if (closing || pending || failed) {
						return Promise.reject(new TextLogFailure('unavailable'));
					}
					pending = Promise.resolve()
						.then(async () => {
							await waitForSpace(() => data.sync(), signal, blocked);
							await waitForSpace(() => index.sync(), signal, blocked);
							flushed = true;
						})
						.catch((error: unknown) => {
							failed = true;
							throw failure(error);
						})
						.finally(() => {
							pending = null;
						});
					return pending;
				},

				close: () => {
					closing ??= Promise.resolve().then(async () => {
						if (pending) {
							await Promise.allSettled([pending]);
						}
						const errors: unknown[] = [];
						// Publish only complete records; close every handle even if flushing fails.
						for (const work of [
							() => data.truncate(state.bytes),
							() => index.truncate(state.entries * ENTRY_BYTES),
							...(flushed ? [] : [() => data.sync(), () => index.sync()]),
						]) {
							try {
								await work();
							} catch (error) {
								errors.push(error);
							}
						}
						try {
							await closeAll(state.handles);
							this.writers.delete(key);
						} catch (error) {
							errors.push(error);
						}
						if (errors.length) {
							throw new TextLogFailure('cleanup_failed', { cause: new AggregateError(errors) });
						}
					});
					return closing;
				},
			};
		} catch (error) {
			try {
				await closeAll(handles);
			} catch (cleanup) {
				throw new TextLogFailure('cleanup_failed', { cause: new AggregateError([error, cleanup]) });
			}
			throw failure(error);
		}
	}

	async read(key: string, offset: number, maxBytes: number): Promise<TextLogPage> {
		this.readers.set(key, (this.readers.get(key) ?? 0) + 1);
		const handles: FileHandle[] = [];
		let readFailure: unknown = null;
		try {
			const index = await open(this.path(key, 'index'), constants.O_RDONLY | constants.O_NOFOLLOW);
			handles.push(index);
			const data = await open(this.path(key, 'log'), constants.O_RDONLY | constants.O_NOFOLLOW);
			handles.push(data);
			const active = this.writers.get(key);
			const entries = active?.entries ?? Math.floor((await index.stat()).size / ENTRY_BYTES);

			const entry = async (position: number) => {
				const bytes = await readExact(index, ENTRY_BYTES, position * ENTRY_BYTES);
				return { end: safe(bytes.readBigUInt64LE(0)), tag: safe(bytes.readBigUInt64LE(8)) };
			};

			const totalBytes = entries ? (await entry(entries - 1)).end : 0;
			if (
				!Number.isSafeInteger(offset) ||
				offset < 0 ||
				offset > totalBytes ||
				!Number.isSafeInteger(maxBytes) ||
				maxBytes < 4
			) {
				throw new TextLogFailure('invalid_offset');
			}
			let low = 0,
				high = entries;
			while (low < high) {
				const middle = Math.floor((low + high) / 2);
				if ((await entry(middle)).end <= offset) {
					low = middle + 1;
				} else {
					high = middle;
				}
			}
			const records: TextLogPage['records'] = [];
			let nextOffset = offset;
			let remaining = maxBytes;
			for (let i = low; i < entries && remaining >= 4; i++) {
				const current = await entry(i);
				if (current.end <= nextOffset) {
					throw new TextLogFailure('unavailable');
				}
				const size = Math.min(current.end - nextOffset, remaining);
				const bytes = await readExact(data, size, nextOffset);
				let text: string;
				try {
					text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, {
						stream: size < current.end - nextOffset,
					});
				} catch (cause) {
					throw new TextLogFailure('invalid_offset', { cause });
				}
				const consumed = Buffer.byteLength(text);
				if (!consumed) {
					break;
				}
				records.push({ tag: current.tag, text });
				nextOffset += consumed;
				remaining -= consumed;
			}
			return { records, nextOffset, totalBytes };
		} catch (error) {
			readFailure = error;
			throw failure(error);
		} finally {
			try {
				await closeAll(handles);
			} catch (cleanup) {
				throw new TextLogFailure('cleanup_failed', {
					cause: readFailure === null ? cleanup : new AggregateError([readFailure, cleanup]),
				});
			} finally {
				const count = (this.readers.get(key) ?? 1) - 1;
				if (count) {
					this.readers.set(key, count);
				} else {
					this.readers.delete(key);
				}
			}
		}
	}

	async *keys(): AsyncIterable<string> {
		const directory = await opendir(this.directory);
		for await (const entry of directory) {
			if (entry.isFile() && entry.name.endsWith('.log') && KEY.test(entry.name.slice(0, -4))) {
				yield entry.name.slice(0, -4);
			}
		}
	}

	async remove(key: string): Promise<void> {
		if (this.writers.has(key) || this.readers.has(key)) {
			return;
		}
		for (const extension of ['index', 'log'] as const) {
			try {
				await unlink(this.path(key, extension));
			} catch (error) {
				if (code(error) !== 'ENOENT') {
					throw failure(error);
				}
			}
		}
	}
}
