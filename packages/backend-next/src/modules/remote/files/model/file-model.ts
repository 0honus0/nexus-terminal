import type { MachineFileInfo, MachineSftpLease } from '../../../../platform/ssh/ssh-port.js';
import type { TrustedSshTargetResolver } from '../../../targets/public.js';
import type { RemoteMachineModel } from '../../model/machine-model.js';
import { RemoteFileFailure, type FileResource, type FileInfo, type FileEntry, type TextRead } from './file-types.js';

export class RemoteFileModel {
	constructor(private readonly machines: RemoteMachineModel, private readonly resolver: TrustedSshTargetResolver) {}

	async open(targetId: number, timeoutMs: number, signal: AbortSignal): Promise<FileResource> {
		const opened = await this.machines.open({ targetId, timeoutMs, signal });
		let lease: MachineSftpLease | null = null;
		try {
			signal.throwIfAborted();
			lease = await opened.machine.openSftp(signal);
			signal.throwIfAborted();
			return { targetId: opened.target.id, fingerprint: opened.target.fingerprint, machine: opened.machine, lease };
		} catch (error) {
			const failures: unknown[] = [error];
			if (lease) { try { await lease.close(); } catch (closeError) { failures.push(closeError); } }
			try { await opened.machine.close(); } catch (closeError) { failures.push(closeError); }
			throw failures.length === 1 ? error : new AggregateError(failures, 'Remote file opening failed');
		}
	}

	async checkFingerprint(resource: FileResource): Promise<void> {
		const current = await this.resolver.fingerprintStored(resource.targetId);
		if (current !== resource.fingerprint) throw new RemoteFileFailure('stale_target');
	}

	private info(value: MachineFileInfo): FileInfo {
		return { size: value.size, mode: value.mode, modifiedAt: value.modifiedAt * 1000,
			kind: value.isSymbolicLink ? 'symlink' : value.isDirectory ? 'directory' : value.isFile ? 'file' : 'other' };
	}

	async list(resource: FileResource, path: string, timeoutMs: number, signal: AbortSignal,
		maxEntries: number, maxMetadataBytes: number): Promise<FileEntry[]> {
		const items = await resource.lease.list(path, { signal, timeoutMs, maxEntries, maxMetadataBytes });
		const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
		return items.map((row) => ({ name: row.name, info: this.info(row.info) }))
			.sort((a,b) => Number(b.info.kind === 'directory') - Number(a.info.kind === 'directory') ||
				collator.compare(a.name,b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	}

	async stat(resource: FileResource, path: string, follow: boolean, timeoutMs: number, signal: AbortSignal): Promise<FileInfo> {
		const info = follow ? await resource.lease.stat(path, { signal, timeoutMs }) :
			await resource.lease.lstat(path, { signal, timeoutMs });
		return this.info(info);
	}

	async readText(resource: FileResource, path: string, timeoutMs: number, signal: AbortSignal,
		maxBytes: number): Promise<TextRead> {
		const info = await this.stat(resource, path, false, timeoutMs, signal);
		if (info.kind !== 'file') throw new RemoteFileFailure('not_text');
		if (info.size > maxBytes) throw new RemoteFileFailure('limit_exceeded');
		const chunks: Buffer[] = [];
		let bytes = 0;
		const stream = resource.lease.read(path, { signal, timeoutMs });
		try {
			for await (const value of stream) {
				signal.throwIfAborted();
				const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
				bytes += data.length;
				if (bytes > maxBytes) throw new RemoteFileFailure('limit_exceeded');
				chunks.push(data);
			}
		} catch (error) {
			stream.destroy();
			throw error;
		}
		const source = Buffer.concat(chunks);
		let text: string;
		try { text = new TextDecoder('utf-8', { fatal: true }).decode(source); }
		catch { throw new RemoteFileFailure('not_text'); }
		if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
			throw new RemoteFileFailure('not_text');
		}
		return { text, bytes, info };
	}

	async close(resource: FileResource): Promise<void> {
		const failures: unknown[] = [];
		try { await resource.lease.close(); } catch (error) { failures.push(error); }
		try { await resource.machine.close(); } catch (error) { failures.push(error); }
		if (failures.length) throw new AggregateError(failures, 'Remote file resource cleanup failed');
	}
}
