export const loadFileManager = () => import('./components/FileManager.vue');

export const loadRemoteDirectoryPicker = () => import('./components/RemoteDirectoryPicker.vue');

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
	LocalUploadFile,
	FilesystemInvalidation,
	RemoteFileEntry,
} from './model/filesystem-types';

export { FilesystemFailure } from './model/filesystem-types';

export { filesystemFailureMessage } from './model/filesystem-feedback';
