export { default as FilesystemCatalogModal } from './components/FilesystemCatalogModal.vue';
export { useFilesystemCatalog } from './composables/useFilesystemCatalog';
export type { FavoritePath, FavoritePathSort, PathHistoryEntry } from './model/catalog';
export { default as FileManager } from './components/FileManager.vue';
export { useFilesystemBrowser } from './composables/useFilesystemBrowser';
export type { FilesystemBrowserController } from './composables/useFilesystemBrowser';
export { createFilesystemSessionState } from './composables/createFilesystemSessionState';
export type { FilesystemSessionState } from './composables/createFilesystemSessionState';
export type {
  FilesystemChannel,
  FilesystemDownloadPort,
  TerminalDirectoryPort,
  TerminalDirectoryQueueState,
} from './ports/filesystem-channel';
export type {
  ArchiveCompressionFormat,
  ArchiveCompressionIntent,
  DirectoryListing,
  FileSearchEntry,
  FileSearchResult,
  LocalUploadBatch,
  LocalUploadFile,
  FilesystemMutation,
  RemoteFileEntry,
  RemoteFileMetadata,
  ResolvedRemotePath,
  RemoteTextFile,
} from './model/filesystem';
