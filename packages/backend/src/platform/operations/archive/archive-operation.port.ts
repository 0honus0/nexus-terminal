export type ArchiveFormat = 'zip' | 'targz' | 'tarbz2';

export interface ArchiveRequest {
  sessionId: string;
  requestId: string;
  sourcePaths: readonly string[];
  destinationPath: string;
  format: ArchiveFormat;
  password?: string;
}

export type ArchiveEvent =
  | { type: 'progress'; requestId: string; progress: number }
  | { type: 'completed'; requestId: string; archivePath: string }
  | { type: 'failed'; requestId: string; message: string };

export interface ArchiveOperation {
  run(request: ArchiveRequest, emit: (event: ArchiveEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<boolean>;
}
