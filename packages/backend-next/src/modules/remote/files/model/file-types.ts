import type { MachineConnection, MachineSftpLease } from '../../../../platform/ssh/ssh-port.js';
import type { RemoteFileErrorCode } from '@nexus-terminal/shared/remote/files/values';

export class RemoteFileFailure extends Error {
	constructor(readonly code: RemoteFileErrorCode) {
		super('Remote file operation: ' + code);
	}
}

export interface FileResource {
	readonly targetId: number;
	readonly fingerprint: string;
	readonly machine: MachineConnection;
	readonly lease: MachineSftpLease;
}

export interface FileOperationRequest {
	path: string;
	timeoutMs: number;
	signal: AbortSignal;
}

export interface FileListRequest extends FileOperationRequest {
	maxEntries: number;
	maxMetadataBytes: number;
}

export interface FileStatRequest extends FileOperationRequest {
	followLinks: boolean;
}

export interface FileTextRequest extends FileOperationRequest {
	maxBytes: number;
}

export interface FileInfo {
	size: number;
	mode: number;
	modifiedAt: number;
	kind: 'file' | 'directory' | 'symlink' | 'other';
}

export interface FileEntry {
	name: string;
	info: FileInfo;
}

export interface TextRead {
	text: string;
	bytes: number;
	info: FileInfo;
}
