import type { RemoteFileEntry } from '../../filesystem/file-entry';

export type UploadConflictPolicy = 'ask' | 'overwrite' | 'skip';

export interface UploadPrepareRequest {
  ownerId: string;
  sessionId: string;
  prepareId: string;
  basePath: string;
  directories: readonly string[];
}

export interface UploadStartRequest {
  ownerId: string;
  sessionId: string;
  uploadId: string;
  destinationPath: string;
  size: number;
  relativePath?: string;
  prepareId?: string;
  conflictPolicy?: UploadConflictPolicy;
}

export interface UploadChunkRequest {
  ownerId: string;
  uploadId: string;
  chunkIndex: number;
  data: Uint8Array;
  isLast: boolean;
}

export type UploadEvent =
  | { type: 'ready'; uploadId: string }
  | { type: 'conflict'; uploadId: string; destinationPath: string; filename: string }
  | { type: 'skipped'; uploadId: string; destinationPath: string }
  | {
      type: 'chunk-ack';
      uploadId: string;
      chunkIndex: number;
      bytesWritten: number;
      totalSize: number;
      progress: number;
    }
  | { type: 'completed'; uploadId: string; destinationPath: string; item: RemoteFileEntry }
  | { type: 'cancelled'; uploadId: string }
  | { type: 'failed'; uploadId?: string; message: string };

export interface UploadOperation {
  prepare(request: UploadPrepareRequest): Promise<{ preparedDirectories: number }>;
  start(request: UploadStartRequest, emit: (event: UploadEvent) => void): Promise<void>;
  append(request: UploadChunkRequest): Promise<void>;
  cancel(ownerId: string, uploadId: string): Promise<boolean>;
  cancelOwner(ownerId: string): Promise<void>;
}
