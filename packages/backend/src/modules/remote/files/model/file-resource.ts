import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import {
	MACHINE_SFTP_MAX_METADATA_TIMEOUT_MS,
	MachineDispatchFailure,
	MachineSftpFailure,
	type MachineConnection,
	type MachineFileInfo,
	type MachineDirectoryEntry,
	type MachineOperationOptions,
	type MachineSftpLease,
} from '../../../../platform/ssh/ssh-port.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	FileCommandNotStarted,
	RemoteFileFailure,
	type FileByteSource,
	type FileChmodRequest,
	type FileCommandOutcome,
	type FileLineCommandOutcome,
	type FileCreateRequest,
	type FileEntry,
	type FileForceRemoveRequest,
	type FileInfo,
	type FileListRequest,
	type FileOperationRequest,
	type FileReadRequest,
	type FileRenameRequest,
	type FileResource,
	type FileScanRequest,
	type FileStageRequest,
	type FileStagedWrite,
	type FileUploadStage,
	type FileStatRequest,
} from './file-types.js';

function hasUnknownOutcome(error: unknown): boolean {
	if (error instanceof RemoteFileFailure) {
		return error.code === 'operation_unknown';
	}
	if (error instanceof MachineSftpFailure) {
		return error.outcome === 'unknown';
	}
	return error instanceof AggregateError && error.errors.some(hasUnknownOutcome);
}

function quotePosixShellArg(value: string): string {
	return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

// ssh2's WriteStream serializes the acknowledgements of a single large
// write. Corking bounded, packet-sized writes invokes its _writev path, so
// independent SFTP WRITE acknowledgements may overlap without using the
// vendor API outside the Platform or bypassing this Stage's commit barrier.
const SFTP_STAGE_PACKET_BYTES = 16 * 1024;
const SFTP_STAGE_WINDOW_BYTES = 512 * 1024;

/** Technical SFTP/machine resources stay private; only application bytes and facts cross this Model boundary. */
export class SftpFileResource implements FileResource {
	readonly #machine: MachineConnection;
	readonly #lease: MachineSftpLease;
	private usable = true;
	private closePromise: Promise<void> | null = null;

	constructor(
		readonly targetId: number,
		readonly fingerprint: string,
		machine: MachineConnection,
		lease: MachineSftpLease,
	) {
		this.#machine = machine;
		this.#lease = lease;
	}

	get isOpen(): boolean {
		return this.usable && this.closePromise === null && this.#machine.isOpen;
	}

	private translate(error: unknown, mutation: boolean): RemoteFileFailure | RemoteResourceCleanupFailure {
		if (error instanceof RemoteResourceCleanupFailure) {
			return error;
		}
		if (error instanceof RemoteFileFailure) {
			return error;
		}
		if (mutation && hasUnknownOutcome(error)) {
			this.usable = false;
			return new RemoteFileFailure('operation_unknown', { cause: error });
		}
		if (error instanceof MachineSftpFailure) {
			if (error.reason === 'limit_exceeded') {
				return new RemoteFileFailure('limit_exceeded', { cause: error });
			}
			if (error.remoteStatus === 'not_found') {
				return new RemoteFileFailure('not_found', { cause: error });
			}
			if (error.reason === 'cancelled' || error.reason === 'timeout' || error.reason === 'closed') {
				this.usable = false;
			}
		}
		if (error instanceof AggregateError) {
			this.usable = false;
		}
		return new RemoteFileFailure('remote_unavailable', { cause: error });
	}

	private async perform<T>(work: () => Promise<T>, signal: AbortSignal, mutation = false): Promise<T> {
		if (!this.isOpen) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		try {
			signal.throwIfAborted();
			const result = await work();
			if (signal.aborted) {
				throw new RemoteFileFailure(mutation ? 'operation_unknown' : 'remote_unavailable');
			}
			if (!this.isOpen) {
				throw new RemoteFileFailure(mutation ? 'operation_unknown' : 'remote_unavailable');
			}
			return result;
		} catch (error) {
			throw this.translate(error, mutation);
		}
	}

	list(request: FileListRequest): Promise<FileEntry[]> {
		return this.perform(() => this.listEntries(request), request.signal);
	}

	scan(request: FileScanRequest): Promise<FileEntry[]> {
		return this.perform(() => this.scanEntries(request), request.signal);
	}

	stat(request: FileStatRequest): Promise<FileInfo> {
		return this.perform(() => this.readInfo(request), request.signal);
	}

	read(request: FileReadRequest): Promise<Uint8Array> {
		return this.perform(() => this.readAll(request), request.signal);
	}

	openRead(request: FileReadRequest): Promise<FileByteSource> {
		return this.perform(() => this.openByteSource(request), request.signal);
	}

	async stage(request: FileStageRequest): Promise<FileStagedWrite> {
		if (!this.isOpen) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		request.signal.throwIfAborted();
		let staged: FileStagedWrite;
		try {
			staged = await this.stageBytes(request);
		} catch (error) {
			throw this.translate(error, true);
		}
		if (request.signal.aborted || !this.isOpen) {
			try {
				await staged.discard();
			} catch (cleanup) {
				throw new RemoteResourceCleanupFailure([cleanup]);
			}
			throw new RemoteFileFailure('operation_unknown');
		}
		return staged;
	}

	async openUploadStage(request: FileOperationRequest & { mode?: number }): Promise<FileUploadStage> {
		if (!this.isOpen) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		let staged: FileUploadStage;
		try {
			request.signal.throwIfAborted();
			staged = await this.streamStage(request);
		} catch (error) {
			throw this.translate(error, true);
		}
		if (request.signal.aborted || !this.isOpen) {
			const failure = new RemoteFileFailure('operation_unknown');
			try {
				await staged.discard();
			} catch (cleanup) {
				throw new RemoteResourceCleanupFailure([failure, cleanup]);
			}
			throw failure;
		}
		return staged;
	}

	create(request: FileCreateRequest): Promise<void> {
		return this.perform(
			() =>
				this.#lease.writeFile(request.path, request.bytes, {
					flags: 'wx',
					mode: request.mode,
					signal: request.signal,
					timeoutMs: request.timeoutMs,
				}),
			request.signal,
			true,
		);
	}

	rename(request: FileRenameRequest): Promise<void> {
		return this.perform(
			() => this.#lease.rename(request.from, request.to, this.options(request)),
			request.signal,
			true,
		);
	}

	replace(request: FileRenameRequest): Promise<void> {
		return this.perform(
			() => this.#lease.replace(request.from, request.to, this.options(request)),
			request.signal,
			true,
		);
	}

	remove(request: FileOperationRequest): Promise<void> {
		return this.perform(() => this.#lease.remove(request.path, this.options(request)), request.signal, true);
	}

	mkdir(request: FileOperationRequest): Promise<void> {
		return this.perform(() => this.#lease.mkdir(request.path, this.options(request)), request.signal, true);
	}

	rmdir(request: FileOperationRequest): Promise<void> {
		return this.perform(() => this.#lease.rmdir(request.path, this.options(request)), request.signal, true);
	}

	chmod(request: FileChmodRequest): Promise<void> {
		return this.perform(
			() => this.#lease.chmod(request.path, request.mode, this.options(request)),
			request.signal,
			true,
		);
	}

	utimes(request: FileOperationRequest & { accessedAt: number; modifiedAt: number }): Promise<void> {
		// FileInfo is an application value with millisecond timestamps; SFTP
		// SETSTAT utimes takes Unix seconds. Passing ms through directly can
		// advance remote timestamps by millennia and fail post-copy validation.
		if (![request.accessedAt, request.modifiedAt].every((value) => Number.isSafeInteger(value) && value >= 0)) {
			throw new RemoteFileFailure('invalid_input');
		}
		return this.perform(
			() =>
				this.#lease.utimes(
					request.path,
					Math.floor(request.accessedAt / 1000),
					Math.floor(request.modifiedAt / 1000),
					this.options(request),
				),
			request.signal,
			true,
		);
	}

	realpath(request: FileOperationRequest): Promise<string> {
		return this.perform(() => this.#lease.realpath(request.path, this.options(request)), request.signal);
	}

	readlink(request: FileOperationRequest): Promise<string> {
		return this.perform(() => this.#lease.readlink(request.path, this.options(request)), request.signal);
	}

	symlink(targetPath: string, linkPath: string, options: { signal: AbortSignal; timeoutMs: number }): Promise<void> {
		return this.perform(() => this.#lease.symlink(targetPath, linkPath, options), options.signal, true);
	}

	async forceRemove(request: FileForceRemoveRequest): Promise<FileCommandOutcome> {
		if (!this.isOpen || request.signal.aborted) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		const command = (request.privileged ? 'sudo ' : '') + 'rm -rf -- ' + quotePosixShellArg(request.path);
		try {
			const result = await this.#machine.execute(command, {
				timeoutMs: request.timeoutMs,
				maxOutputBytes: 16 * 1024,
				signal: request.signal,
			});
			switch (result.outcome.status) {
				case 'completed':
					return 'completed';
				case 'nonzero':
					return 'rejected';
				case 'unknown':
					this.usable = false;
					return 'unknown';
			}
		} catch (cause) {
			if (cause instanceof MachineDispatchFailure && cause.outcome !== 'unknown') {
				throw new RemoteFileFailure('remote_unavailable', { cause });
			}
			// Once dispatch becomes ambiguous the Model cannot prove rm was not applied.
			this.usable = false;
			throw new RemoteFileFailure('operation_unknown', { cause });
		}
	}

	async executeCommandLines(
		command: string,
		signal: AbortSignal,
		timeoutMs: number,
		onLine: (line: string) => void,
	): Promise<FileLineCommandOutcome> {
		if (!this.isOpen || signal.aborted || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
			throw new FileCommandNotStarted();
		}
		const controller = new AbortController();

		const cancel = () => controller.abort();

		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) {
			cancel();
		}
		const timer = setTimeout(cancel, timeoutMs);
		let channel: Awaited<ReturnType<MachineConnection['openRawCommand']>> | null = null;
		let stopStderr: (() => void) | null = null;
		let commandFailure: unknown = null;
		try {
			channel = await this.#machine.openRawCommand(command, controller.signal);
			// ssh2 keeps extended stderr paused until someone subscribes. Native
			// zip/tar diagnostics can otherwise fill the remote SSH window and
			// deadlock the command while stdout is being consumed. Drain without
			// collecting or exposing secret-bearing remote diagnostic text.
			stopStderr = channel.onStderr(() => undefined);
			// Native archive commands take no stdin input. End the stream explicitly.
			const inputFinished = finished(channel.writable, {
				readable: false,
				cleanup: true,
				signal: controller.signal,
			});
			channel.writable.end();
			await inputFinished;
			let pending = '';
			const decoder = new TextDecoder('utf-8', { fatal: true });
			// Only bounded lines cross this Model boundary. Remote stderr never
			// becomes an application failure message or an unbounded buffer.
			for await (const bytes of channel.readable) {
				if (!(bytes instanceof Uint8Array)) {
					throw new RemoteFileFailure('operation_unknown');
				}
				pending += decoder.decode(bytes, { stream: true });
				let newline = pending.indexOf('\n');
				while (newline !== -1) {
					const line = pending.slice(0, newline);
					if (Buffer.byteLength(line, 'utf8') > 8192) {
						throw new RemoteFileFailure('operation_unknown');
					}
					onLine(line);
					pending = pending.slice(newline + 1);
					newline = pending.indexOf('\n');
				}
				if (Buffer.byteLength(pending, 'utf8') > 8192) {
					throw new RemoteFileFailure('operation_unknown');
				}
			}
			pending += decoder.decode();
			if (pending) {
				onLine(pending);
			}
			const outcome = await channel.outcome;
			if (outcome.status === 'unknown' || controller.signal.aborted) {
				throw new RemoteFileFailure('operation_unknown');
			}
			return outcome.status === 'completed'
				? { status: 'completed' }
				: { status: 'nonzero', exitCode: outcome.exitCode };
		} catch (cause) {
			commandFailure = cause;
			if (cause instanceof MachineDispatchFailure && cause.outcome !== 'unknown') {
				throw new FileCommandNotStarted({ cause });
			}
			this.usable = false;
			throw cause instanceof RemoteFileFailure && cause.code === 'operation_unknown'
				? cause
				: new RemoteFileFailure('operation_unknown', { cause });
		} finally {
			clearTimeout(timer);
			signal.removeEventListener('abort', cancel);
			const failures: unknown[] = [];
			try {
				stopStderr?.();
			} catch (error) {
				failures.push(error);
			}
			try {
				channel?.close();
			} catch (error) {
				failures.push(error);
			}
			if (failures.length) {
				if (commandFailure !== null) {
					failures.unshift(commandFailure);
				}
				throw new RemoteResourceCleanupFailure(failures);
			}
		}
	}

	close(): Promise<void> {
		if (!this.closePromise) {
			this.closePromise = Promise.resolve().then(() => this.release());
		}
		return this.closePromise;
	}

	private info(value: MachineFileInfo): FileInfo {
		let kind: FileInfo['kind'] = 'other';
		if (value.isSymbolicLink) {
			kind = 'symlink';
		} else if (value.isDirectory) {
			kind = 'directory';
		} else if (value.isFile) {
			kind = 'file';
		}
		return {
			size: value.size,
			uid: value.uid,
			gid: value.gid,
			mode: value.mode,
			accessedAt: value.accessedAt * 1000,
			modifiedAt: value.modifiedAt * 1000,
			kind,
		};
	}

	private options(
		request: { timeoutMs: number; signal: AbortSignal },
		timeoutMs = request.timeoutMs,
	): MachineOperationOptions {
		return { signal: request.signal, timeoutMs: Math.min(timeoutMs, MACHINE_SFTP_MAX_METADATA_TIMEOUT_MS) };
	}

	private deadline(request: { timeoutMs: number; signal: AbortSignal }): () => number {
		const deadline = Date.now() + request.timeoutMs;
		return () => {
			request.signal.throwIfAborted();
			const remaining = deadline - Date.now();
			if (remaining < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return remaining;
		};
	}

	private async listEntries(request: FileListRequest): Promise<FileEntry[]> {
		const rows = await this.#lease.list(request.path, {
			signal: request.signal,
			timeoutMs: Math.min(request.timeoutMs, MACHINE_SFTP_MAX_METADATA_TIMEOUT_MS),
			maxEntries: request.maxEntries,
			maxMetadataBytes: request.maxMetadataBytes,
		});
		return rows.map((row) => this.entry(row));
	}

	private entry(row: MachineDirectoryEntry): FileEntry {
		const result: FileEntry = { name: row.name, info: this.info(row.info) };
		if (row.longName !== undefined) {
			result.longName = row.longName;
		}
		return result;
	}

	private async scanEntries(request: FileScanRequest): Promise<FileEntry[]> {
		if (request.maxEntries !== undefined && (!Number.isSafeInteger(request.maxEntries) || request.maxEntries < 1)) {
			throw new RemoteFileFailure('invalid_input');
		}
		const result: FileEntry[] = [];
		for await (const row of this.#lease.scan(request.path, this.options(request))) {
			request.signal.throwIfAborted();
			if (request.maxEntries !== undefined && result.length >= request.maxEntries) {
				throw new RemoteFileFailure('limit_exceeded');
			}
			result.push(this.entry(row));
		}
		return result;
	}

	private async readInfo(request: FileStatRequest): Promise<FileInfo> {
		const info = request.followLinks
			? await this.#lease.stat(request.path, this.options(request))
			: await this.#lease.lstat(request.path, this.options(request));
		return this.info(info);
	}

	private async openByteSource(request: FileReadRequest): Promise<FileByteSource> {
		if (
			(request.start !== undefined && (!Number.isSafeInteger(request.start) || request.start < 0)) ||
			(request.length !== undefined && !Number.isSafeInteger((request.start ?? 0) + request.length)) ||
			(request.length !== undefined &&
				(!Number.isSafeInteger(request.length) || request.length < 0 || request.length > request.maxBytes))
		) {
			throw new RemoteFileFailure('invalid_input');
		}
		const self = this;
		return {
			async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
				request.signal.throwIfAborted();
				if (!self.isOpen) {
					throw new RemoteFileFailure('remote_unavailable');
				}
				if (request.length === 0) {
					return;
				}
				const source = self.#lease.readChunks(request.path, {
					signal: request.signal,
					timeoutMs: request.timeoutMs,
					start: request.start ?? 0,
					end: request.length === undefined ? undefined : (request.start ?? 0) + request.length - 1,
				});
				let bytes = 0;
				try {
					for await (const chunk of source) {
						request.signal.throwIfAborted();
						bytes += chunk.byteLength;
						if (bytes > request.maxBytes || (request.length !== undefined && bytes > request.length)) {
							throw new RemoteFileFailure('limit_exceeded');
						}
						yield chunk;
					}
					if (request.length !== undefined && bytes !== request.length) {
						throw new RemoteFileFailure('remote_unavailable');
					}
				} catch (error) {
					throw self.translate(error, false);
				}
			},
		};
	}

	private async readAll(request: FileReadRequest): Promise<Uint8Array> {
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		const source = await this.openByteSource(request);
		for await (const chunk of source) {
			bytes += chunk.byteLength;
			chunks.push(chunk);
		}
		const result = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return result;
	}

	/** Stream into a private same-directory temp; Service alone selects overwrite. */
	private async streamStage(request: FileOperationRequest & { mode?: number }): Promise<FileUploadStage> {
		const remaining = this.deadline(request);
		const temporary = path.posix.join(path.posix.dirname(request.path), `.nexus-upload-${randomUUID()}.part`);
		const stream = this.#lease.write(temporary, {
			flags: 'wx',
			mode: request.mode ?? 0o600,
			timeoutMs: remaining(),
			signal: request.signal,
		});
		try {
			await once(stream, 'open', { signal: request.signal });
		} catch (cause) {
			stream.destroy();
			throw this.translate(cause, true);
		}
		let state: 'writing' | 'committed' | 'discarded' | 'unknown' = 'writing';

		const finishedWriting = () => {
			stream.end();
			return finished(stream, { cleanup: true });
		};

		return {
			append: async (bytes) => {
				if (state !== 'writing' || request.signal.aborted) {
					throw new RemoteFileFailure('operation_unknown');
				}
				try {
					const stable = Buffer.from(bytes);
					for (let windowStart = 0; windowStart < stable.length; windowStart += SFTP_STAGE_WINDOW_BYTES) {
						const windowEnd = Math.min(stable.length, windowStart + SFTP_STAGE_WINDOW_BYTES);
						await new Promise<void>((resolve, reject) => {
							let pending = Math.ceil((windowEnd - windowStart) / SFTP_STAGE_PACKET_BYTES);
							let failed = false;

							const acknowledged = (error?: Error | null) => {
								if (failed) {
									return;
								}
								if (error) {
									failed = true;
									reject(error);
								} else if (--pending === 0) {
									resolve();
								}
							};

							stream.cork();
							try {
								for (let start = windowStart; start < windowEnd; start += SFTP_STAGE_PACKET_BYTES) {
									stream.write(
										stable.subarray(start, Math.min(start + SFTP_STAGE_PACKET_BYTES, windowEnd)),
										acknowledged,
									);
								}
							} finally {
								stream.uncork();
							}
						});
					}
				} catch (cause) {
					state = 'unknown';
					// A failed parallel WRITE can race acknowledgements still in flight.
					// Destroying the stream does not prove remote writes have stopped.
					this.usable = false;
					stream.destroy();
					throw new RemoteFileFailure('operation_unknown', { cause });
				}
			},

			commit: async (mode) => {
				if (state !== 'writing') {
					throw new RemoteFileFailure('operation_unknown');
				}
				try {
					await finishedWriting();
					if (mode === 'replace') {
						await this.#lease.replace(temporary, request.path, this.options(request, remaining()));
					} else {
						await this.#lease.rename(temporary, request.path, this.options(request, remaining()));
					}
					state = 'committed';
				} catch (cause) {
					state = 'unknown';
					throw this.translate(cause, true);
				}
			},

			discard: async () => {
				if (state === 'committed' || state === 'discarded') {
					return;
				}
				if (state === 'unknown' || request.signal.aborted) {
					stream.destroy();
					state = 'unknown';
					this.usable = false;
					throw new RemoteFileFailure('operation_unknown');
				}
				try {
					// Finish acknowledged temporary writes before deleting; local destroy
					// does not prove the remote file handle has stopped writing.
					await finishedWriting();
					await this.#lease.remove(temporary, this.options(request, remaining()));
				} catch (cause) {
					if (!(cause instanceof MachineSftpFailure && cause.remoteStatus === 'not_found')) {
						state = 'unknown';
						this.usable = false;
						stream.destroy();
						throw this.translate(cause, true);
					}
				}
				state = 'discarded';
			},
		};
	}

	private async stageBytes(request: FileStageRequest): Promise<FileStagedWrite> {
		const remaining = this.deadline(request);
		const temporary = path.posix.join(path.posix.dirname(request.path), `.nexus-save-${randomUUID()}.part`);
		let written = false;
		try {
			await this.#lease.writeFile(temporary, request.bytes, {
				flags: 'wx',
				mode: request.mode,
				signal: request.signal,
				timeoutMs: remaining(),
			});
			written = true;
			if (request.mode !== undefined) {
				await this.#lease.chmod(temporary, request.mode, this.options(request, remaining()));
			}
		} catch (error) {
			if (hasUnknownOutcome(error)) {
				this.usable = false;
				throw new RemoteResourceCleanupFailure([this.translate(error, true)]);
			}
			if (written) {
				try {
					await this.#lease.remove(temporary, { timeoutMs: 2000 });
				} catch (cleanup) {
					if (!(cleanup instanceof MachineSftpFailure && cleanup.remoteStatus === 'not_found')) {
						this.usable = false;
						throw new RemoteResourceCleanupFailure([error, cleanup]);
					}
				}
			}
			throw error;
		}
		let state: 'staged' | 'committed' | 'discarded' | 'unknown' = 'staged';

		const commit = async (mode: 'create' | 'replace'): Promise<void> => {
			if (state !== 'staged') {
				throw new RemoteFileFailure('remote_unavailable');
			}
			try {
				if (mode === 'create') {
					await this.#lease.rename(temporary, request.path, this.options(request, remaining()));
				} else {
					await this.#lease.replace(temporary, request.path, this.options(request, remaining()));
				}
				state = 'committed';
			} catch (error) {
				if (hasUnknownOutcome(error)) {
					state = 'unknown';
					this.usable = false;
				}
				throw this.translate(error, true);
			}
		};

		const discard = async (): Promise<void> => {
			if (state === 'committed' || state === 'discarded') {
				return;
			}
			if (state === 'unknown') {
				throw new RemoteFileFailure('operation_unknown');
			}
			try {
				await this.#lease.remove(temporary, { timeoutMs: 2000 });
			} catch (error) {
				if (!(error instanceof MachineSftpFailure) || error.remoteStatus !== 'not_found') {
					this.usable = false;
					throw this.translate(error, true);
				}
			}
			state = 'discarded';
		};

		return { commit, discard };
	}

	private async release(): Promise<void> {
		const failures: unknown[] = [];
		try {
			await this.#lease.close();
		} catch (error) {
			failures.push(error);
		}
		try {
			await this.#machine.close();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length) {
			throw new RemoteResourceCleanupFailure(failures);
		}
	}
}
