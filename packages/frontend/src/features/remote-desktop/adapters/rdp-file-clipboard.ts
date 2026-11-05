import { RdpFileTransferProvider, type FileInfo } from '@devolutions/iron-remote-desktop-rdp';
import {
	RemoteDesktopFailure,
	type RemoteDesktopClipboardProgress,
	type RemoteDesktopFileClipboard,
	type RemoteDesktopFileClipboardState,
} from '../model/remote-desktop-types';

function isFileInfo(value: unknown): value is FileInfo {
	return (
		typeof value === 'object' &&
		value !== null &&
		'name' in value &&
		typeof value.name === 'string' &&
		'size' in value &&
		typeof value.size === 'number' &&
		Number.isSafeInteger(value.size) &&
		value.size >= 0 &&
		'lastModified' in value &&
		typeof value.lastModified === 'number' &&
		Number.isFinite(value.lastModified) &&
		(!('path' in value) || value.path === undefined || typeof value.path === 'string') &&
		(!('isDirectory' in value) || value.isDirectory === undefined || typeof value.isDirectory === 'boolean')
	);
}

export function createRdpFileClipboard(options: { onFailure(cause: unknown): void; paste(): void }) {
	let closed = false;
	let revision = 0;
	let localFiles = false;
	let pasteOnAccept = false;
	let uploadAwaited = false;
	let uploadFileCount = 0;
	const uploadFailures: unknown[] = [];
	const completedUploads = new Set<number>();
	let upload: RemoteDesktopFileClipboardState['upload'] = null;
	const files = new Map<string, { info: FileInfo; index: number }>();
	const downloads = new Map<string, RemoteDesktopClipboardProgress>();
	const downloadIds = new Map<number, string>();
	const uploaded = new Map<number, number>();
	const tasks = new Set<Promise<unknown>>();
	const listeners = new Set<(state: RemoteDesktopFileClipboardState) => void>();
	// No persistent browser files: the upstream provider owns and releases in-memory chunks.
	const provider = new RdpFileTransferProvider({ storageBackend: 'blob' });

	const publish = () => {
		if (closed) return;
		for (const listener of listeners) {
			listener({
				canUpload: !uploadAwaited,
				files: Array.from(files, ([id, { info }]) => ({
					id,
					name: info.name,
					path: info.path ?? '',
					size: info.size,
					isDirectory: info.isDirectory === true,
				})),
				upload: upload
					? { transferred: upload.transferred, total: upload.total, waiting: upload.waiting }
					: null,
				downloads: Array.from(downloads, ([id, progress]) => ({
					id,
					transferred: progress.transferred,
					total: progress.total,
				})),
			});
		}
	};

	const track = async <T>(task: Promise<T>): Promise<T> => {
		tasks.add(task);
		try {
			return await task;
		} finally {
			tasks.delete(task);
		}
	};

	const clearRemoteFiles = () => {
		revision += 1;
		files.clear();
		localFiles = false;
		publish();
	};

	provider.on('files-available', (incoming) => {
		if (closed) return;
		clearRemoteFiles();
		if (!incoming.every(isFileInfo)) {
			options.onFailure(new RemoteDesktopFailure('protocol_failure', 'confirmed'));
			return;
		}
		incoming.forEach((info, index) => {
			files.set(`${revision}:${index}`, {
				index,
				info: {
					name: info.name,
					size: info.size,
					lastModified: info.lastModified,
					path: info.path,
					isDirectory: info.isDirectory,
				},
			});
		});
		publish();
	});
	provider.on('upload-progress', (progress) => {
		if (closed || !upload) return;
		uploaded.set(progress.fileIndex, progress.bytesTransferred);
		upload.transferred = Array.from(uploaded.values()).reduce((sum, bytes) => sum + bytes, 0);
		upload.waiting = false;
		publish();
	});
	provider.on('upload-batch-started', (_, selected) => {
		if (closed) return;
		uploaded.clear();
		uploadFailures.length = 0;
		completedUploads.clear();
		uploadFileCount = selected.filter((file) => !file.isDirectory).length;
		localFiles = true;
		upload = { transferred: 0, total: selected.reduce((sum, file) => sum + file.size, 0), waiting: true };
		publish();
	});
	provider.on('upload-complete', (_, index) => {
		if (closed) return;
		completedUploads.add(index);
		if (!uploadAwaited && completedUploads.size >= uploadFileCount) upload = null;
		publish();
	});
	provider.on('error', (failure) => {
		if (closed || failure.direction !== 'upload') return;
		uploadFailures.push(failure);
		localFiles = false;
		if (failure.fileIndex !== undefined) completedUploads.add(failure.fileIndex);
		if (!uploadAwaited) {
			if (failure.fileIndex === undefined || completedUploads.size >= uploadFileCount) upload = null;
			options.onFailure(new RemoteDesktopFailure('input_failed', 'unknown', { cause: failure }));
		}
		publish();
	});
	provider.on('download-progress', (progress) => {
		const id = downloadIds.get(progress.transferId);
		if (closed || !id || !downloads.has(id)) return;
		downloads.set(id, { transferred: progress.bytesTransferred, total: progress.totalBytes });
		publish();
	});
	provider.on('format-list-response', (accepted) => {
		if (closed || !pasteOnAccept) return;
		pasteOnAccept = false;
		if (accepted) options.paste();
	});

	const uploadFiles = async (selected: File[], paste = false): Promise<void> => {
		if (closed || uploadAwaited || selected.length === 0) {
			throw new RemoteDesktopFailure('input_failed', 'not_dispatched');
		}
		clearRemoteFiles();
		localFiles = true;
		pasteOnAccept = paste;
		uploadAwaited = true;
		uploaded.clear();
		uploadFailures.length = 0;
		upload = { transferred: 0, total: selected.reduce((sum, file) => sum + file.size, 0), waiting: true };
		publish();
		try {
			await track(provider.uploadFiles(selected).completion);
			// The upstream completion also resolves batches containing failed files; event failures remain authoritative.
			if (uploadFailures.length) throw new AggregateError(uploadFailures, 'RDP file upload failed');
		} catch (cause) {
			localFiles = false;
			throw new RemoteDesktopFailure('input_failed', 'unknown', { cause });
		} finally {
			uploadAwaited = false;
			pasteOnAccept = false;
			upload = null;
			publish();
		}
	};

	const capability: RemoteDesktopFileClipboard = {
		subscribe(listener) {
			if (!closed) {
				listeners.add(listener);
				publish();
			}
			return () => listeners.delete(listener);
		},

		upload: (selected) => uploadFiles(selected),

		async download(id) {
			const original = files.get(id);
			if (closed || !original || original.info.isDirectory || downloads.has(id)) {
				throw new RemoteDesktopFailure('input_failed', 'not_dispatched');
			}
			downloads.set(id, { transferred: 0, total: original.info.size });
			publish();
			let transferId: number | null = null;
			try {
				const transfer = provider.downloadFile(original.info, original.index);
				transferId = transfer.transferId;
				downloadIds.set(transferId, id);
				const blob = await track(transfer.completion);
				if (closed || files.get(id) !== original) {
					throw new RemoteDesktopFailure('cancelled', 'confirmed');
				}
				const expectedSize = downloads.get(id)?.total ?? original.info.size;
				if (expectedSize > 0 && blob.size !== expectedSize) {
					throw new RemoteDesktopFailure('protocol_failure', 'confirmed');
				}
				return blob;
			} catch (cause) {
				if (cause instanceof RemoteDesktopFailure) throw cause;
				throw new RemoteDesktopFailure('input_failed', 'unknown', { cause });
			} finally {
				if (transferId !== null) downloadIds.delete(transferId);
				downloads.delete(id);
				publish();
			}
		},
	};

	return {
		capability,
		upload: uploadFiles,
		clearRemoteFiles,

		hasFiles: () => localFiles || files.size > 0 || provider.isUploadInProgress(),

		isUploading: () => provider.isUploadInProgress(),

		getBuilderExtensions: () => provider.getBuilderExtensions(),

		setSession(session: Parameters<RdpFileTransferProvider['setSession']>[0]): void {
			provider.setSession({
				invokeExtension(extension) {
					if (closed) {
						extension.free();
						// The provider can finish an async write after dispose. Drain it without calling a freed WASM session.
						return undefined;
					}
					return session.invokeExtension(extension);
				},
			});
		},

		async settled(): Promise<void> {
			await Promise.allSettled([...tasks]);
		},

		close(): void {
			if (closed) return;
			closed = true;
			pasteOnAccept = false;
			listeners.clear();
			files.clear();
			downloads.clear();
			downloadIds.clear();
			uploaded.clear();
			completedUploads.clear();
			uploadFailures.length = 0;
			provider.dispose();
		},
	};
}
