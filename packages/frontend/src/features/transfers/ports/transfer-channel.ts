import type {
  ArchiveCommand,
  CopyMoveCommand,
  TransferEvent,
  UploadPrepareCommand,
  UploadCommand,
} from '../model/transfer';
export interface TransferChannel {
  prepareUpload(request: UploadPrepareCommand): Promise<void>;
  upload(request: UploadCommand): Promise<void>;
  copyMove(request: CopyMoveCommand): Promise<void>;
  archive(request: ArchiveCommand): Promise<void>;
  cancel(id: string): Promise<boolean>;
  resolveConflict?(id: string, strategy: 'overwrite' | 'skip', applyToAll?: boolean): Promise<void>;
  onEvent(handler: (event: TransferEvent) => void): () => void;
}
