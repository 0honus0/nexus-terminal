import { createWorkspaceTransferAdapter } from './transfer-adapters';
import { createWorkspaceUploadAdapter } from './upload-adapters';
import { createSshSuspendChannel } from './suspend-adapters';
import type { DockerChannel } from '@/features/docker/public';
import { createStatusChannel, createDockerChannel } from './observation-adapters';
import type { FilesystemChannel, FilesystemDownloadPort, TerminalDirectoryPort } from '@/features/filesystem/public';
import type { FileDocumentPort } from '@/features/file-editor/public';
import type { FilePreviewSource } from '@/features/file-preview/public';
import type { StatusChannel } from '@/features/status-monitor/public';
import type { SshSuspendChannel } from '@/features/ssh-suspend/public';
import type { TerminalChannel, TerminalViewport } from '@/features/terminal/public';
import type { TransferChannel, TransferEvent } from '@/features/transfers/public';
import { createFilesystemChannel, createFileDocumentPort, createFilePreviewSource } from './filesystem-adapters';
import { createFilesystemDownloadPort } from './download-adapters';
import { WorkspaceSocket } from '../protocol/workspaceSocket';
import { createTerminalChannel, createTerminalDirectoryPort } from './terminal-adapters';

interface TransferChannelAdapter extends TransferChannel {
	workspaceConnected(): Promise<void>;
	workspaceDisconnected(): void;
	dispose(): void;
}

export const createTransferChannel = (
	socket: WorkspaceSocket,
	workspaceId: string,
	invalidateFiles?: () => void,
): TransferChannelAdapter => {
	const handlers = new Set<(event: TransferEvent) => void>();
	let workspaceAvailable = false;

	const emit = (event: TransferEvent): void => {
		if (
			event.type === 'completed' ||
			event.type === 'error' ||
			event.type === 'cancelled' ||
			event.type === 'skipped'
		) {
			invalidateFiles?.();
		}
		for (const handler of handlers) {
			handler(event);
		}
	};

	const mutate = async <T>(operation: () => Promise<T>): Promise<T> => {
		invalidateFiles?.();
		try {
			return await operation();
		} finally {
			invalidateFiles?.();
		}
	};

	const uploads = createWorkspaceUploadAdapter(socket, workspaceId, () => workspaceAvailable, emit);

	const operations = createWorkspaceTransferAdapter(socket, workspaceId, () => workspaceAvailable, emit);
	return {
		prepareUpload: (request) => mutate(() => uploads.prepare(request)),

		upload: (request) => mutate(() => uploads.upload(request)),

		copyMove: (request) => mutate(() => operations.copyMove(request)),

		archive: (request) => mutate(() => operations.archive(request)),

		cancel: (id) => (uploads.owns(id) ? uploads.cancel(id) : operations.cancel(id)),

		resolveConflict: (id, strategy) => uploads.resolveConflict(id, strategy),

		onEvent(handler) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},

		async workspaceConnected() {
			workspaceAvailable = true;
			uploads.connect();
		},

		workspaceDisconnected() {
			workspaceAvailable = false;
			uploads.disconnect();
			operations.disconnect();
		},

		dispose() {
			workspaceAvailable = false;
			uploads.dispose();
			operations.dispose();
			handlers.clear();
		},
	};
};

export interface WorkspaceCapabilityAdapters {
	terminal: TerminalChannel;
	filesystem: FilesystemChannel;
	terminalDirectory: TerminalDirectoryPort;
	download: FilesystemDownloadPort;
	documents: FileDocumentPort;
	preview: FilePreviewSource;
	transfers: TransferChannel;
	status: StatusChannel;
	docker: DockerChannel;
	suspend: SshSuspendChannel;
	terminalViewport(): TerminalViewport | undefined;
	workspaceConnected(): Promise<void>;
	workspaceDisconnected(): void;
	dispose(): void;
}

export const createWorkspaceCapabilityAdapters = (
	socket: WorkspaceSocket,
	workspaceId: string,
	connectionId: number,
): WorkspaceCapabilityAdapters => {
	let workspaceBound = false;
	let lastTerminalViewport: TerminalViewport | undefined;
	const connectedHandlers = new Set<() => void>();
	const status = createStatusChannel(socket, () => workspaceBound && socket.connected);
	const filesystem = createFilesystemChannel(socket, () => workspaceBound);
	const transfers = createTransferChannel(socket, workspaceId, filesystem.invalidate);
	const download = createFilesystemDownloadPort(workspaceId, connectionId, () => workspaceBound && socket.connected);
	const terminal = createTerminalChannel(socket, {
		canSend: () => workspaceBound && socket.connected,

		rememberResize: (viewport) => {
			lastTerminalViewport = { columns: viewport.columns, rows: viewport.rows };
		},

		onConnected: (handler) => {
			connectedHandlers.add(handler);
			return () => connectedHandlers.delete(handler);
		},
	});
	return {
		terminal,
		filesystem,
		terminalDirectory: createTerminalDirectoryPort(socket, workspaceId, connectionId),
		download,
		documents: createFileDocumentPort(filesystem),
		preview: createFilePreviewSource(filesystem),
		transfers,
		status,
		docker: createDockerChannel(socket, () => workspaceBound && socket.connected),
		suspend: createSshSuspendChannel(socket, () => workspaceBound && socket.connected),

		terminalViewport: () => lastTerminalViewport,

		async workspaceConnected() {
			workspaceBound = true;
			// A reconnect/resume can create a fresh remote PTY even though the mounted xterm keeps
			// the same rows/columns. Reapply the latest fitted viewport so the remote PTY cannot fall
			// back to its 80x24 default merely because no local ResizeObserver event fired.
			if (lastTerminalViewport) {
				await terminal.resize(lastTerminalViewport);
			}
			for (const handler of connectedHandlers) {
				handler();
			}
			void transfers.workspaceConnected().catch(() => undefined);
		},

		workspaceDisconnected() {
			workspaceBound = false;
			status.disconnect();
			filesystem.disconnect();
			download.disconnect();
			transfers.workspaceDisconnected();
		},

		dispose() {
			workspaceBound = false;
			status.disconnect();
			lastTerminalViewport = undefined;
			connectedHandlers.clear();
			filesystem.dispose();
			download.dispose();
			transfers.dispose();
		},
	};
};
