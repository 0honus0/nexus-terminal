export const loadFileManager = () => import('./components/FileManager.vue');
export { default as FilesystemCatalogModal } from './components/FilesystemCatalogModal.vue';
export { useFilesystemCatalog } from './composables/useFilesystemCatalog';
export type { FavoritePathDto, FavoritePathSortDto, PathHistoryEntryDto } from './model/catalog';
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
  WorkspaceFilesystemListResponseDto,
  WorkspaceFileSearchEntryDto,
  WorkspaceFilesystemSearchResponseDto,
  LocalUploadBatch,
  LocalUploadFile,
  FilesystemMutation,
  WorkspaceRemoteFileEntryDto,
  WorkspaceRemoteFileMetadataDto,
  ResolvedRemotePath,
  RemoteTextFile,
} from './model/filesystem';
