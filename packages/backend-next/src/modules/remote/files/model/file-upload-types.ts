import type { WorkspaceUploadConflictPolicy } from '@nexus-terminal/shared/remote/transfers/values';
import type { FilePathEntry } from './file-types.js';

export type FileUploadConflictPolicy = WorkspaceUploadConflictPolicy;

/** Application events: the Workspace interface alone projects wire DTOs. */
export type FileUploadEvent =
	| { type: 'ready'; uploadId: string }
	| { type: 'conflict'; uploadId: string; destinationPath: string; filename: string }
	| { type: 'skipped'; uploadId: string; destinationPath: string }
	| {
			type: 'progress';
			uploadId: string;
			chunkIndex: number;
			bytesWritten: number;
			totalSize: number;
			progress: number;
	  }
	| { type: 'completed'; uploadId: string; destinationPath: string; item: FilePathEntry }
	| { type: 'cancelled'; uploadId: string }
	| { type: 'failed'; uploadId: string; message: string };

export interface FileUploadStart {
	uploadId: string;
	destinationPath: string;
	size: number;
	conflictPolicy: FileUploadConflictPolicy;
	prepareId?: string;
	relativePath?: string;
}

/** Bound cleanup remains available after Access revocation; appends still authenticate. */
export interface FileUploadStreamAttachment {
	append(bytes: Uint8Array): Promise<boolean>;
	abort(): void;
}
