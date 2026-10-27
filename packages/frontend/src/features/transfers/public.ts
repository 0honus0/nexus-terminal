export type { ServerTransferMethod } from '@nexus-terminal/shared/remote/transfers/server-values';

export const loadProgressCenter = () => import('./components/ProgressCenter.vue');

export const loadProgressDisplayModal = () => import('./components/ProgressDisplayModal.vue');

export const loadSendFilesModal = () => import('./components/SendFilesModal.vue');

export const loadUploadConflictModal = () => import('./components/UploadConflictModal.vue');

export { createFileClipboardController } from './state/fileClipboardController';

export type {
	FileClipboardController,
	FileClipboardItem,
	FileClipboardOperation,
	FileClipboardSnapshot,
} from './state/fileClipboardController';

export { useServerTransfers } from './composables/useServerTransfers';

export type { ServerTransfersController } from './composables/useServerTransfers';

export { createTransferController } from './state/transferController';

export {
	isProgressTaskVisible,
	transferTaskErrorDescriptor,
	transferTaskWarningDescriptor,
} from './presentation-transfer-message';

export type { TransferMessageDescriptor } from './presentation-transfer-message';

export type { ConflictStrategy, TransferController, UploadConflict } from './model/transfer-types';

export type { TransferChannel } from './ports/transfer-channel';

export { TransferFailure } from './model/transfer-types';

export type {
	ProgressSource,
	WorkspaceArchiveErrorCode,
	ArchiveCommand,
	CopyMoveCommand,
	TransferErrorKind,
	TransferEvent,
	TransferKind,
	TransferLocation,
	TransferStatus,
	TransferTask,
	TransferWarningKind,
	UploadPrepareCommand,
	UploadCommand,
	UploadSourceFile,
} from './model/transfer-types';

export type { SendFileSource, SendFilesCommand, ServerTransferTask } from './model/server-transfer-types';
