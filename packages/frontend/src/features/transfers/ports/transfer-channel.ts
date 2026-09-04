import type {
  ArchiveRequest,
  CopyMoveRequest,
  TransferEvent,
  UploadPrepareRequest,
  UploadRequest,
} from '../model/transfer';
export interface TransferChannel {
  prepareUpload(request: UploadPrepareRequest): Promise<void>;
  upload(request: UploadRequest): Promise<void>;
  copyMove(request: CopyMoveRequest): Promise<void>;
  archive(request: ArchiveRequest): Promise<void>;
  cancel(id: string): Promise<boolean>;
  resolveConflict?(id: string, strategy: 'overwrite' | 'skip', applyToAll?: boolean): Promise<void>;
  onEvent(handler: (event: TransferEvent) => void): () => void;
}
