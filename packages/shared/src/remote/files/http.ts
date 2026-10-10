import type { RemoteFileInfo, RemoteFileEntry, RemoteFileResourceView } from './model.js';
import type { RemoteFileErrorCode } from './values.js';

export interface RemoteFileOpenRequest { targetId: number }
export interface RemoteFilePathRequest { path: string }
export interface RemoteFileOpenResponse extends RemoteFileResourceView {}
export interface RemoteFileListResponse { entries: RemoteFileEntry[]; complete: true }
export interface RemoteFileStatResponse { info: RemoteFileInfo }
export interface RemoteFileTextResponse { info: RemoteFileInfo; bytes: number; text: string }
export interface RemoteFileCloseResponse { closed: true }
export interface RemoteFileErrorResponse { code: RemoteFileErrorCode }
