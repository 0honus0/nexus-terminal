import {
	InvalidWorkspaceFilesPayload,
	readWorkspaceFilePathRequest,
	readWorkspaceFileSearchRequest,
	readWorkspaceFileReadBinaryRequest,
	readWorkspaceFileWriteTextRequest,
	readWorkspaceFileCreateFileRequest,
	readWorkspaceFileRemoveRequest,
	readWorkspaceFileRenameRequest,
	readWorkspaceFileChmodRequest,
	readWorkspaceFileEntry,
	readWorkspaceFileListResponse,
	readWorkspaceFileSearchResponse,
	readWorkspaceFileReadBinaryResponse,
	readWorkspaceFileRealpathResponse,
	readWorkspaceFileMutationResponse,
} from '@nexus-terminal/shared/remote/files/workspace-codec';
import {
	REMOTE_FILE_MAX_TEXT_BYTES,
	WORKSPACE_FILES_MAX_BINARY_READ_BYTES,
} from '@nexus-terminal/shared/remote/files/values';
import type { WorkspaceErrorCode } from '@nexus-terminal/shared/remote/workspace/values';
import {
	WORKSPACE_MAX_IN_FLIGHT_REQUESTS,
	WORKSPACE_MAX_JSON_MESSAGE_BYTES,
} from '@nexus-terminal/shared/remote/workspace/values';
import { FilesystemFailure, type FilesystemChannel } from '@/features/filesystem/public';
import { decodeEditorDocument, type FileDocumentPort } from '@/features/file-editor/public';
import type { FilePreviewSource } from '@/features/file-preview/public';
import { WorkspaceSocket } from '../protocol/workspaceSocket';
import { WorkspaceRequestFailure, WorkspaceDispatchFailure } from '../model/workspace-error-types';
import {
	normalizeFilePath,
	toFileEntry,
	toDirectoryListing,
	toFileSearchResult,
} from '../model/workspace-files-mapper';

function fileRequest<T>(decode: (value: unknown) => T, value: unknown): T {
	try {
		return decode(value);
	} catch (cause) {
		throw new FilesystemFailure('invalid_input', false, { cause });
	}
}

function requestPath(path: string): string {
	try {
		return normalizeFilePath(readWorkspaceFilePathRequest({ path }).path);
	} catch (cause) {
		throw new FilesystemFailure('invalid_input', false, { cause });
	}
}

function validateRequest(type: string, input: object, requestId: string): void {
	// This is the inbound WS control budget, not an outbound listing/text limit.
	const bytes = new TextEncoder().encode(JSON.stringify({ type, requestId, payload: input }));
	if (bytes.length > WORKSPACE_MAX_JSON_MESSAGE_BYTES) {
		throw new FilesystemFailure('limit_exceeded', false);
	}
}

function samePath(actual: string, expected: string): void {
	if (actual !== expected) {
		throw new InvalidWorkspaceFilesPayload();
	}
}

function childEntries(root: string, entries: { path: string; name: string }[], recursive = false): void {
	const prefix = root === '/' ? '/' : root + '/';
	const paths = new Set<string>();
	for (const entry of entries) {
		const relative = entry.path.slice(prefix.length);
		if (
			!entry.path.startsWith(prefix) ||
			!relative ||
			normalizeFilePath(entry.path) !== entry.path ||
			paths.has(entry.path) ||
			(!recursive && relative !== entry.name)
		) {
			throw new InvalidWorkspaceFilesPayload();
		}
		paths.add(entry.path);
	}
}

interface WorkspaceFilesystemChannel extends FilesystemChannel {
	disconnect(): void;
	dispose(): void;
}

export function createFilesystemChannel(
	socket: WorkspaceSocket,
	canUse: () => boolean = () => true,
): WorkspaceFilesystemChannel {
	let generation = 0;
	let disposed = false;
	let availability: 'pending' | 'ready' | { code: WorkspaceErrorCode } = 'pending';
	const waiters = new Set<(error?: Error) => void>();

	const finishWaiting = (error?: FilesystemFailure): void => {
		for (const finish of [...waiters]) {
			finish(error);
		}
	};

	const disconnect = (): void => {
		generation += 1;
		availability = 'pending';
		finishWaiting(new FilesystemFailure('not_connected', false));
	};

	const offReady = socket.on('filesystem.ready', () => {
		if (disposed) {
			return;
		}
		availability = 'ready';
		finishWaiting();
	});
	const offError = socket.on('filesystem.error', ({ message }) => {
		availability = { code: message };
		finishWaiting(new FilesystemFailure(message, false));
	});
	const offClose = socket.onClose(disconnect);

	async function waitForReady(signal?: AbortSignal): Promise<number> {
		if (disposed || !socket.connected || !canUse()) {
			throw new FilesystemFailure('not_connected', false);
		}
		signal?.throwIfAborted();
		const current = generation;
		if (availability === 'ready') {
			return current;
		}
		if (availability !== 'pending') {
			throw new FilesystemFailure(availability.code, false);
		}
		if (waiters.size >= WORKSPACE_MAX_IN_FLIGHT_REQUESTS) {
			throw new FilesystemFailure('limit_exceeded', false);
		}
		await new Promise<void>((resolve, reject) => {
			const finish = (error?: Error): void => {
				waiters.delete(finish);
				window.clearTimeout(timer);
				signal?.removeEventListener('abort', abort);
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			};

			const abort = (): void => finish(new DOMException('File readiness aborted', 'AbortError'));

			const timer = window.setTimeout(() => finish(new FilesystemFailure('remote_unavailable', false)), 30000);
			waiters.add(finish);
			signal?.addEventListener('abort', abort, { once: true });
		});
		return current;
	}

	function assertCurrent(current: number): void {
		if (disposed || current !== generation || !socket.connected || !canUse()) {
			throw new FilesystemFailure('not_connected', false);
		}
	}

	async function request<T>(
		type: string,
		input: object,
		decode: (value: unknown) => T,
		options: { mutation?: boolean; signal?: AbortSignal } = {},
	): Promise<T> {
		const { mutation = false, signal } = options;
		const requestId = crypto.randomUUID();
		validateRequest(type, input, requestId);
		const current = await waitForReady(signal);
		assertCurrent(current);
		try {
			const result = decode(await socket.bindRequests()(type, input, requestId, signal));
			if (!mutation) {
				assertCurrent(current);
			}
			return result;
		} catch (cause) {
			if (signal?.aborted) {
				throw new DOMException('File request aborted', 'AbortError');
			}
			if (cause instanceof WorkspaceDispatchFailure) {
				throw new FilesystemFailure(cause.code, false, { cause });
			}
			if (cause instanceof WorkspaceRequestFailure) {
				throw new FilesystemFailure(cause.code, cause.code === 'operation_unknown', { cause });
			}
			throw new FilesystemFailure(mutation ? 'operation_unknown' : 'protocol_error', mutation, { cause });
		}
	}

	return {
		disconnect,

		dispose() {
			disposed = true;
			disconnect();
			offReady();
			offError();
			offClose();
		},

		async listDirectory(path) {
			const requested = requestPath(path);
			return request('filesystem.list', { path: requested }, (input) => {
				const result = readWorkspaceFileListResponse(input);
				samePath(result.path, requested);
				childEntries(requested, result.entries);
				return toDirectoryListing(result);
			});
		},

		async search(path, query) {
			const input = fileRequest(readWorkspaceFileSearchRequest, { path: requestPath(path), query });
			return request('filesystem.search', input, (value) => {
				const result = readWorkspaceFileSearchResponse(value);
				childEntries(input.path, result.entries, true);
				for (const entry of result.entries) {
					samePath(entry.relativePath, entry.path.slice(input.path === '/' ? 1 : input.path.length + 1));
				}
				return toFileSearchResult(result);
			});
		},

		async stat(path, signal) {
			const input = { path: requestPath(path) };
			return request(
				'filesystem.stat',
				input,
				(value) => {
					const entry = readWorkspaceFileEntry(value);
					samePath(entry.path, input.path);
					return toFileEntry(entry);
				},
				{ signal },
			);
		},

		async readBinary(path, maxBytes, signal) {
			const input = fileRequest(readWorkspaceFileReadBinaryRequest, { path: requestPath(path), maxBytes });
			validateRequest('filesystem.readBinary', input, crypto.randomUUID());
			const current = await waitForReady(signal);
			assertCurrent(current);
			try {
				const result = await socket.requestBinaryConnected('filesystem.readBinary', input, signal);
				assertCurrent(current);
				const response = readWorkspaceFileReadBinaryResponse(result.data);
				samePath(response.path, input.path);
				return { path: response.path, bytes: result.bytes };
			} catch (cause) {
				if (signal?.aborted) {
					throw new DOMException('File read aborted', 'AbortError');
				}
				if (cause instanceof WorkspaceDispatchFailure) {
					throw new FilesystemFailure(cause.code, false, { cause });
				}
				if (cause instanceof WorkspaceRequestFailure) {
					throw new FilesystemFailure(cause.code, false, { cause });
				}
				throw new FilesystemFailure('protocol_error', false, { cause });
			}
		},

		async writeText(path, content, encoding) {
			const input = fileRequest(readWorkspaceFileWriteTextRequest, {
				path: requestPath(path),
				content,
				encoding,
			});
			await request('filesystem.writeText', input, readWorkspaceFileMutationResponse, { mutation: true });
		},

		async createDirectory(path) {
			await request(
				'filesystem.createDirectory',
				{ path: requestPath(path) },
				readWorkspaceFileMutationResponse,
				{ mutation: true },
			);
		},

		async createFile(path, content = '') {
			const input = fileRequest(readWorkspaceFileCreateFileRequest, { path: requestPath(path), content });
			await request('filesystem.createFile', input, readWorkspaceFileMutationResponse, { mutation: true });
		},

		async remove(paths, options) {
			const input = fileRequest(readWorkspaceFileRemoveRequest, {
				paths: paths.map(requestPath),
				forceDirectoryPaths: options?.forceDirectoryPaths?.map(requestPath),
			});
			await request('filesystem.remove', input, readWorkspaceFileMutationResponse, { mutation: true });
		},

		async rename(from, to) {
			const input = fileRequest(readWorkspaceFileRenameRequest, { from: requestPath(from), to: requestPath(to) });
			await request('filesystem.rename', input, readWorkspaceFileMutationResponse, { mutation: true });
		},

		async chmod(path, mode) {
			const input = fileRequest(readWorkspaceFileChmodRequest, { path: requestPath(path), mode });
			await request('filesystem.chmod', input, readWorkspaceFileMutationResponse, { mutation: true });
		},

		async realpath(path) {
			const input = { path: requestPath(path) };
			return request('filesystem.realpath', input, (value) => {
				const result = readWorkspaceFileRealpathResponse(value);
				samePath(result.requestedPath, input.path);
				return {
					requestedPath: result.requestedPath,
					path: result.absolutePath,
					targetType: result.targetType,
				};
			});
		},
	};
}

export function createFileDocumentPort(filesystem: FilesystemChannel): FileDocumentPort {
	return {
		async load(path, encoding) {
			const file = await filesystem.readBinary(path, REMOTE_FILE_MAX_TEXT_BYTES);
			const decoded = await decodeEditorDocument(file.bytes, encoding);
			return { path: file.path, content: decoded.content, encoding: decoded.encoding };
		},

		save: (path, content, encoding) => filesystem.writeText(path, content, encoding),
	};
}

export function createFilePreviewSource(filesystem: FilesystemChannel): FilePreviewSource {
	return {
		async read(path, options) {
			const signal = options?.signal;
			const maxBytes = options?.maxBytes ?? WORKSPACE_FILES_MAX_BINARY_READ_BYTES;
			fileRequest(readWorkspaceFileReadBinaryRequest, { path, maxBytes });
			signal?.throwIfAborted();
			const entry = await filesystem.stat(path, signal);
			signal?.throwIfAborted();
			if (entry.metadata.size > maxBytes) {
				return { tooLarge: true, actualBytes: entry.metadata.size, maxBytes };
			}
			const result = await filesystem.readBinary(path, maxBytes, signal);
			return { bytes: new Uint8Array(result.bytes).buffer };
		},
	};
}
