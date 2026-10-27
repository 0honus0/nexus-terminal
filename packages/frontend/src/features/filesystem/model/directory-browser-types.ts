import type { RemoteFileErrorCode } from '@nexus-terminal/shared/remote/files/values';

export interface DirectoryResource {
	id: string;
	targetId: number;
}

export interface DirectoryEntry {
	name: string;
	path: string;
	kind: 'directory' | 'symlink';
}

export class DirectoryBrowserFailure extends Error {
	constructor(
		readonly code: RemoteFileErrorCode | 'request_failed' | 'protocol_failure' | 'cancelled' | 'not_directory',
		options?: ErrorOptions,
	) {
		super('Directory browser failed', options);
	}
}
