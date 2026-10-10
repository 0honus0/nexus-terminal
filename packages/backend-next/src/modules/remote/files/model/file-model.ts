import { RemoteResourceCleanupFailure } from '../../resource-errors.js';
import type { MachineFileInfo, MachineSftpLease } from '../../../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { RemoteMachineModel } from '../../model/machine-model.js';
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

export class RemoteFileModel {
	constructor(
		private readonly machines: RemoteMachineModel,
		private readonly resolver: TrustedSshTargetResolver,
	) {}

	async open(targetId: number, timeoutMs: number, signal: AbortSignal): Promise<FileResource> {
		const opened = await this.machines.open({ targetId, timeoutMs, signal });
		let lease: MachineSftpLease | null = null;
		try {
			signal.throwIfAborted();
			lease = await opened.machine.openSftp(signal);
			signal.throwIfAborted();
			return {
				targetId: opened.target.id,
				fingerprint: opened.target.fingerprint,
				machine: opened.machine,
				lease,
			};
		} catch (error) {
			const failures: unknown[] = [error];
			if (lease) {
				try {
					await lease.close();
				} catch (closeError) {
					failures.push(closeError);
				}
			}
			try {
				await opened.machine.close();
			} catch (closeError) {
				failures.push(closeError);
			}
			throw failures.length === 1 ? error : new RemoteResourceCleanupFailure(failures);
		}
	}

	async checkFingerprint(resource: FileResource): Promise<void> {
		const current = await this.resolver.fingerprintStored(resource.targetId);
		if (current !== resource.fingerprint) {
			throw new RemoteFileFailure('stale_target');
		}
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

	async list(resource: FileResource, request: FileListRequest): Promise<FileEntry[]> {
		const items = await resource.lease.list(request.path, {
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

	async stat(resource: FileResource, request: FileStatRequest): Promise<FileInfo> {
		const options = { signal: request.signal, timeoutMs: request.timeoutMs };
		const info = request.followLinks
			? await resource.lease.stat(request.path, options)
			: await resource.lease.lstat(request.path, options);
		return this.info(info);
	}

	async readText(resource: FileResource, request: FileTextRequest): Promise<TextRead> {
		const deadline = Date.now() + request.timeoutMs;

		const remaining = (): number => {
			request.signal.throwIfAborted();
			const ms = deadline - Date.now();
			if (ms < 1) {
				throw new RemoteFileFailure('remote_unavailable');
			}
			return ms;
		};

		const info = await this.stat(resource, {
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
		const stream = resource.lease.read(request.path, { signal: request.signal, timeoutMs: remaining() });
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

	async close(resource: FileResource): Promise<void> {
		const failures: unknown[] = [];
		try {
			await resource.lease.close();
		} catch (error) {
			failures.push(error);
		}
		try {
			await resource.machine.close();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, 'Remote file resource cleanup failed');
		}
	}
}
