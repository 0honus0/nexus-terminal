import type { RemoteFileEntry } from '../../filesystem/file-entry';

export type TransferMode = 'copy' | 'move';

export interface TransferRequest {
  requestId: string;
  ownerId?: string;
  sourceOwnerId?: string;
  sourceSessionId: string;
  destinationSessionId: string;
  sourcePaths: readonly string[];
  destinationPath: string;
  mode: TransferMode;
}

export type TransferEvent =
  | {
      type: 'progress';
      requestId: string;
      transferredBytes: number;
      totalBytes: number;
      completedFiles: number;
      totalFiles: number;
      totalKnown: boolean;
      currentFile?: string;
    }
  | {
      type: 'completed';
      requestId: string;
      mode: TransferMode;
      sourcePaths: readonly string[];
      destinationPath: string;
      items: RemoteFileEntry[];
      crossSession: boolean;
      sourceOwnerId?: string;
    }
  | { type: 'failed'; requestId: string; mode: TransferMode; message: string }
  | { type: 'cancelling'; requestId: string }
  | { type: 'cancelled'; requestId: string };

export interface TransferOperation {
  run(request: TransferRequest, emit: (event: TransferEvent) => void): Promise<void>;
  cancel(ownerId: string, requestId: string): Promise<boolean>;
  cancelOwner(ownerId: string): Promise<void>;
}
