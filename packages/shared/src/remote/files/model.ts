export type RemoteFileKind = 'file' | 'directory' | 'symlink' | 'other';

export interface RemoteFileInfo {
 size: number;
 mode: number;
 modifiedAt: number; // Unix milliseconds
 kind: RemoteFileKind;
}

export interface RemoteFileEntry { name: string; info: RemoteFileInfo }

export interface RemoteFileResourceView {
 id: string;
 targetId: number;
 configurationFingerprint: string;
}
