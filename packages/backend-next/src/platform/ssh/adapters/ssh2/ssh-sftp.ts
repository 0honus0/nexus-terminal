import type { SFTPWrapper, Stats } from 'ssh2';
import type { Readable, Writable } from 'node:stream';
import {
	MachineSftpFailure,
	type MachineOperationOptions,
	type MachineSftpLease,
	type MachineFileInfo,
	type MachineDirectoryEntry,
} from '../../ssh-port.js';

const info = (stats: Stats): MachineFileInfo => ({
	size: stats.size,
	mode: stats.mode,
	modifiedAt: stats.mtime,
	isDirectory: stats.isDirectory(),
	isFile: stats.isFile(),
	isSymbolicLink: stats.isSymbolicLink(),
});

function timeout(options?: MachineOperationOptions, fallback?: number): number | undefined {
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
		if (signal?.aborted) this.abortLease();
	}

	private release(): void {
		if (this.released) return;
		this.released = true;
		this.signal?.removeEventListener('abort', this.abortLease);
		this.onEnded();
	}

	private markClosed(error: Error): void {
		if (this.closed) return;
		this.closed = true;
		for (const reject of [...this.pending]) reject(error);
		for (const stream of [...this.streams]) stream.destroy(error);
	}

	private ensure(options?: MachineOperationOptions): void {
		if (options?.signal?.aborted || this.signal?.aborted) throw new MachineSftpFailure('cancelled', 'not_started');
		if (this.closed || this.closePromise) throw new MachineSftpFailure('closed', 'not_started');
	}

	private call<T>(
		invoke: (finish: (error: Error | undefined | null, value: T) => void) => void,
		options?: MachineOperationOptions,
	): Promise<T> {
		this.ensure(options);
		const limit = timeout(options, 30000)!;
		return new Promise<T>((resolve, reject) => {
			let settled = false;

			const finish = (error: Error | null | undefined, value?: T) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				options?.signal?.removeEventListener('abort', aborted);
				this.pending.delete(failed);
				if (error) reject(error);
				else resolve(value!);
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
		return this.call<Stats>((finish) => this.sftp.stat(path, finish), options).then(info);
	}

	lstat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo> {
		return this.call<Stats>((finish) => this.sftp.lstat(path, finish), options).then(info);
	}

	list(path: string, options?: MachineOperationOptions): Promise<MachineDirectoryEntry[]> {
		return this.call<Array<{ filename: string; attrs: Stats }>>(
			(finish) => this.sftp.readdir(path, finish),
			options,
		).then((entries) => entries.map(({ filename, attrs }) => ({ name: filename, info: info(attrs) })));
	}

	private track<T extends Readable | Writable>(stream: T, options?: MachineOperationOptions): T {
		this.streams.add(stream);
		const limit = timeout(options);

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
		if (options?.signal?.aborted) aborted();
		return stream;
	}

	read(path: string, options?: MachineOperationOptions & { start?: number; end?: number }): Readable {
		this.ensure(options);
		timeout(options);
		return this.track(
			this.sftp.createReadStream(path, {
				...(options?.start === undefined ? {} : { start: options.start }),
				...(options?.end === undefined ? {} : { end: options.end }),
			}),
			options,
		);
	}

	write(path: string, options?: MachineOperationOptions & { flags?: string; mode?: number }): Writable {
		this.ensure(options);
		timeout(options);
		return this.track(
			this.sftp.createWriteStream(path, {
				flags: (options?.flags ?? 'w') as 'w',
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
		if (this.closePromise) return this.closePromise;
		if (this.released) return Promise.resolve();
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		this.closePromise = new Promise<void>((success, failure) => {
			resolve = success;
			reject = failure;
		});
		let finished = false;

		const finish = (failure?: unknown) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			this.sftp.off('close', closed);
			this.release();
			if (failure === undefined) resolve();
			else reject(failure);
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
