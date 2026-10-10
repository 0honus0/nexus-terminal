import type { MachineConnection, MachineSftpLease } from '../../../../platform/ssh/ssh-port.js';

export type FileFailureCode = 'invalid_input' | 'not_found' | 'forbidden' | 'unauthenticated' |
 'stale_target' | 'limit_exceeded' | 'not_text' | 'remote_unavailable';

export class RemoteFileFailure extends Error {
 constructor(readonly code: FileFailureCode) { super('Remote file operation: ' + code); }
}

export interface FileResource {
 readonly targetId: number;
 readonly fingerprint: string;
 readonly machine: MachineConnection;
 readonly lease: MachineSftpLease;
}

export interface FileInfo {
 size: number;
 mode: number;
 modifiedAt: number;
 kind: 'file' | 'directory' | 'symlink' | 'other';
}

export interface FileEntry { name: string; info: FileInfo }
export interface TextRead { text: string; bytes: number; info: FileInfo }
