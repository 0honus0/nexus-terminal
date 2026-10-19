export const loadFileManager = () => import('./components/FileManager.vue');

export { default as FilesystemCatalogModal } from './components/FilesystemCatalogModal.vue';

export { useFilesystemCatalog } from './composables/useFilesystemCatalog';

export type { FavoritePathSaveInput, FilesystemCatalogController } from './model/catalog-types';

export type { FavoritePathSummary, FavoritePathSort, PathHistoryItem } from './model/catalog-types';

export { useFilesystemBrowser } from './composables/useFilesystemBrowser';

export type {
	FilesystemBrowserController,
	FilesystemSortDirection,
	FilesystemSortKey,
} from './composables/useFilesystemBrowser';

export { createFilesystemSessionState } from './composables/createFilesystemSessionState';

export type { FilesystemSessionState } from './composables/createFilesystemSessionState';

export type { FilesystemChannel, FilesystemDownloadPort, TerminalDirectoryPort } from './ports/filesystem-channel';

export type { TerminalDirectoryQueueState } from './model/terminal-directory-types';

export { TerminalDirectoryFailure } from './model/terminal-directory-types';

export type {
	ArchiveCompressionFormat,
	ArchiveCompressionIntent,
	DirectoryListing,
	RemoteFileSearchEntry,
	FileSearchResult,
	LocalUploadBatch,
	LocalUploadFile,
	FilesystemMutation,
	RemoteFileEntry,
	RemoteFileMetadata,
	ResolvedRemotePath,
} from './model/filesystem-types';

export { FilesystemFailure } from './model/filesystem-types';

export { filesystemFailureMessage } from './model/filesystem-feedback';
