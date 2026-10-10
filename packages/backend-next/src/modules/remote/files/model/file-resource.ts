import {
	MachineSftpFailure,
	type MachineConnection,
	type MachineFileInfo,
	type MachineSftpLease,
} from '../../../../platform/ssh/ssh-port.js';
import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import {
	RemoteFileFailure,
	type FileEntry,
	type FileInfo,
	type FileListRequest,
	type FileResource,
	type FileStatRequest,
	type FileTextRequest,
	type TextRead,
} from './file-types.js';

/** Application file operations; live machine, lease and stream stay private to Model. */
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

	private async perform<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
		if (!this.isOpen) {
			throw new RemoteFileFailure('remote_unavailable');
		}
		try {
			signal.throwIfAborted();
			const result = await work();
			signal.throwIfAborted();
			if (!this.isOpen) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return result;
		} catch (error) {
			if (
				signal.aborted ||
				(error instanceof MachineSftpFailure &&
					(error.reason === 'cancelled' || error.reason === 'timeout' || error.reason === 'closed'))
			) {
				this.usable = false;
			}
			throw error;
		}
	}

	list(request: FileListRequest): Promise<FileEntry[]> {
		return this.perform(() => this.listEntries(request), request.signal);
	}

	stat(request: FileStatRequest): Promise<FileInfo> {
		return this.perform(() => this.readInfo(request), request.signal);
	}

	readText(request: FileTextRequest): Promise<TextRead> {
		return this.perform(() => this.readContents(request), request.signal);
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
			mode: value.mode,
			modifiedAt: value.modifiedAt * 1000,
			kind,
		};
	}

	private async listEntries(request: FileListRequest): Promise<FileEntry[]> {
		const items = await this.#lease.list(request.path, {
			signal: request.signal,
			timeoutMs: request.timeoutMs,
			maxEntries: request.maxEntries,
			maxMetadataBytes: request.maxMetadataBytes,
		});
		const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
		return items
			.map((row) => ({ name: row.name, info: this.info(row.info) }))
			.sort(
				(a, b) =>
					Number(b.info.kind === 'directory') - Number(a.info.kind === 'directory') ||
					collator.compare(a.name, b.name) ||
					(a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
			);
	}

	private async readInfo(request: FileStatRequest): Promise<FileInfo> {
		const options = { signal: request.signal, timeoutMs: request.timeoutMs };
		const info = request.followLinks
			? await this.#lease.stat(request.path, options)
			: await this.#lease.lstat(request.path, options);
		return this.info(info);
	}

	private async readContents(request: FileTextRequest): Promise<TextRead> {
		const deadline = Date.now() + request.timeoutMs;

		const remaining = (): number => {
			request.signal.throwIfAborted();
			const ms = deadline - Date.now();
			if (ms < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return ms;
		};

		const info = await this.readInfo({
			path: request.path,
			followLinks: false,
			timeoutMs: remaining(),
			signal: request.signal,
		});
		if (info.kind !== 'file') {
			throw new RemoteFileFailure('not_text');
		}
		if (info.size > request.maxBytes) {
			throw new RemoteFileFailure('limit_exceeded');
		}
		const chunks: Buffer[] = [];
		let bytes = 0;
		const stream = this.#lease.read(request.path, { signal: request.signal, timeoutMs: remaining() });
		try {
			for await (const value of stream) {
				request.signal.throwIfAborted();
				const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
				bytes += data.length;
				if (bytes > request.maxBytes) {
					throw new RemoteFileFailure('limit_exceeded');
				}
				chunks.push(data);
			}
		} catch (error) {
			stream.destroy();
			throw error;
		}
		const source = Buffer.concat(chunks);
		let text: string;
		try {
			// Preserve a UTF-8 BOM so bytes remains identical to the encoded wire text.
			text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source);
		} catch {
			throw new RemoteFileFailure('not_text');
		}
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
			throw new RemoteFileFailure('not_text');
		}
		request.signal.throwIfAborted();
		return { text, bytes, info };
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
