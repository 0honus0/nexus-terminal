import type { SFTPWrapper, Stats } from 'ssh2';
import type { Readable, Writable } from 'node:stream';
import type { MachineSftpLease, MachineFileInfo, MachineDirectoryEntry } from '../../ssh-port.js';

const info = (stats: Stats): MachineFileInfo => ({
	size: stats.size,
	mode: stats.mode,
	modifiedAt: stats.mtime,
	isDirectory: stats.isDirectory(),
	isFile: stats.isFile(),
	isSymbolicLink: stats.isSymbolicLink(),
});

export class SshSftpLease implements MachineSftpLease {
	private closed = false;
	private closePromise: Promise<void> | null = null;
	private readonly streams = new Set<Readable | Writable>();

	constructor(
		private readonly sftp: SFTPWrapper,
		private readonly onEnded: () => void,
	) {
		sftp.on('error', () => undefined);
		sftp.once('close', () => this.markClosed());
		sftp.once('end', () => this.markClosed());
	}

	private markClosed(): void {
		if (this.closed) return;
		this.closed = true;
		for (const stream of this.streams) stream.destroy();
		this.streams.clear();
		this.onEnded();
	}

	private ensure(): void {
		if (this.closed || this.closePromise) throw new Error('SFTP lease closed');
	}

	private call<T>(invoke: (finish: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
		this.ensure();
		return new Promise<T>((resolve, reject) => {
			let settled = false;

			const cleanup = () => {
				this.sftp.off('close', closed);
				this.sftp.off('end', closed);
			};

			const finish = (error: Error | null | undefined, value: T) => {
				if (settled) return;
				settled = true;
				cleanup();
				if (error) reject(error);
				else resolve(value);
			};

			const closed = () => finish(new Error('SFTP connection closed'), undefined as T);

			this.sftp.once('close', closed);
			this.sftp.once('end', closed);
			try {
				invoke(finish);
			} catch (error) {
				finish(error instanceof Error ? error : new Error('SFTP request rejected'), undefined as T);
			}
		});
	}

	stat(path: string): Promise<MachineFileInfo> {
		return this.call<Stats>((finish) => this.sftp.stat(path, finish)).then(info);
	}

	lstat(path: string): Promise<MachineFileInfo> {
		return this.call<Stats>((finish) => this.sftp.lstat(path, finish)).then(info);
	}

	list(path: string): Promise<MachineDirectoryEntry[]> {
		return this.call<Array<{ filename: string; attrs: Stats }>>((finish) => this.sftp.readdir(path, finish)).then(
			(entries) => entries.map(({ filename, attrs }) => ({ name: filename, info: info(attrs) })),
		);
	}

	private track<T extends Readable | Writable>(stream: T): T {
		this.streams.add(stream);
		stream.once('close', () => this.streams.delete(stream));
		return stream;
	}

	read(path: string, options?: { start?: number; end?: number }): Readable {
		this.ensure();
		return this.track(
			this.sftp.createReadStream(path, {
				...(options?.start === undefined ? {} : { start: options.start }),
				...(options?.end === undefined ? {} : { end: options.end }),
			}),
		);
	}

	write(path: string, options?: { flags?: string; mode?: number }): Writable {
		this.ensure();
		return this.track(
			this.sftp.createWriteStream(path, {
				flags: (options?.flags ?? 'w') as 'w',
				...(options?.mode === undefined ? {} : { mode: options.mode }),
			}),
		);
	}

	private voidCall(invoke: (finish: (error?: Error | null) => void) => void): Promise<void> {
		return this.call<void>((finish) => invoke((error) => finish(error, undefined)));
	}

	rename(from: string, to: string): Promise<void> {
		return this.voidCall((finish) => this.sftp.rename(from, to, finish));
	}

	remove(path: string): Promise<void> {
		return this.voidCall((finish) => this.sftp.unlink(path, finish));
	}

	mkdir(path: string): Promise<void> {
		return this.voidCall((finish) => this.sftp.mkdir(path, finish));
	}

	rmdir(path: string): Promise<void> {
		return this.voidCall((finish) => this.sftp.rmdir(path, finish));
	}

	close(): Promise<void> {
		if (this.closePromise) return this.closePromise;
		this.closePromise = new Promise<void>((resolve) => {
			this.sftp.once('close', finish);
			const timeout = setTimeout(finish, 2000);
			const self = this;

			function finish() {
				clearTimeout(timeout);
				self.sftp.off('close', finish);
				self.markClosed();
				resolve();
			}

			try {
				this.sftp.end();
			} catch {
				finish();
			}
		});
		return this.closePromise;
	}
}
