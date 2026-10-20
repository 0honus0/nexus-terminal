import type { Readable, Writable } from 'node:stream';

/**
 * Technical machine inputs: deliberately no Connection ID, Workspace, Agent,
 * user identity, approval or configuration fingerprint.
 */
export type MachineAuthentication =
	| { readonly kind: 'password'; readonly password: string }
	| { readonly kind: 'private_key'; readonly privateKey: string; readonly passphrase: string | null };

export interface MachineProxy {
	readonly type: 'HTTP' | 'SOCKS5';
	readonly host: string;
	readonly port: number;
	readonly username: string | null;
	readonly password: string | null;
}

export type MachineRoute =
	| { readonly kind: 'direct' }
	| { readonly kind: 'proxy'; readonly proxy: MachineProxy }
	| { readonly kind: 'jump'; readonly hops: readonly MachineEndpoint[] };

export interface MachineEndpoint {
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly authentication: MachineAuthentication;
	readonly route: MachineRoute;
}

export interface MachineConnectOptions {
	/** Entire route deadline, not a per-hop timer. */
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
	/** Caller owns host-key policy. No silent accept-all fallback. */
	verifyHostKey(host: string, port: number, publicKey: Buffer): boolean;
}

export interface MachinePty {
	readonly term?: string;
	readonly columns: number;
	readonly rows: number;
}

export type MachineCommandAbortMode = 'close' | 'signal';

export type MachineCommandOutcome =
	| { status: 'completed'; exitCode: 0; signal: string | null }
	| { status: 'nonzero'; exitCode: number; signal: string | null }
	| { status: 'unknown'; reason: 'remote_signal'; signal: string }
	| { status: 'unknown'; reason: 'disconnect' | 'timeout' | 'cancelled' | 'channel_error' };

export class MachineDispatchFailure extends Error {
	constructor(
		readonly outcome: 'not_started' | 'failed' | 'unknown',
		options?: ErrorOptions,
	) {
		super('SSH dispatch ' + outcome, options);
		this.name = 'MachineDispatchFailure';
	}
}

export type MachineChannelCloseReason = 'normal' | 'disconnected' | 'channel_error';

export interface MachineByteChannel {
	readonly readable: Readable;
	readonly writable: Writable;
	onStderr(listener: (bytes: Uint8Array) => void): () => void;
	onClose(listener: (reason: MachineChannelCloseReason) => void): () => void;
	onDrain(listener: () => void): () => void;
	pause(): void;
	resume(): void;
	close(): void;
}

export interface MachineShell extends MachineByteChannel {
	resize(columns: number, rows: number): void;
}

export interface MachineCommand extends MachineByteChannel {
	readonly outcome: Promise<MachineCommandOutcome>;
	cancel(): void;
}

export interface MachineCommandResult {
	readonly outcome: MachineCommandOutcome;
	readonly stdout: string;
	readonly stderr: string;
	readonly truncated: boolean;
}

export interface MachineExecuteOptions {
	readonly timeoutMs: number;
	readonly maxOutputBytes: number;
	readonly signal?: AbortSignal;
}

export interface MachineFileInfo {
	readonly size: number;
	readonly uid: number;
	readonly gid: number;
	readonly mode: number;
	readonly accessedAt: number;
	readonly modifiedAt: number;
	readonly isDirectory: boolean;
	readonly isFile: boolean;
	readonly isSymbolicLink: boolean;
}

export interface MachineDirectoryEntry {
	readonly name: string;
	readonly longName?: string;
	readonly info: MachineFileInfo;
}

/** Maximum deadline for one SFTP metadata request; byte streams have their own budget. */
export const MACHINE_SFTP_MAX_METADATA_TIMEOUT_MS = 300_000;

export interface MachineOperationOptions {
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

/** A complete listing or explicit failure; neither limit is a pagination hint. */
export interface MachineSftpListOptions extends MachineOperationOptions {
	readonly maxEntries: number;
	readonly maxMetadataBytes: number;
}

export interface MachineSftpReadOptions extends MachineOperationOptions {
	/** Zero-based byte offset. End, when given, includes the final byte. */
	readonly start?: number;
	readonly end?: number;
}

export type MachineFileOpenMode =
	'r' | 'r+' | 'w' | 'wx' | 'xw' | 'w+' | 'xw+' | 'a' | 'ax' | 'xa' | 'a+' | 'ax+' | 'xa+';

export interface MachineSftpWriteOptions extends MachineOperationOptions {
	readonly flags?: MachineFileOpenMode;
	readonly mode?: number;
}

/** ssh2/SFTP status normalized at the Adapter boundary; business code never reads raw cause.code. */
export type MachineSftpRemoteStatus = 'eof' | 'not_found' | 'permission_denied' | 'unsupported' | 'failure';

/** Local failure never proves that an already dispatched remote mutation was rolled back. */
export class MachineSftpFailure extends Error {
	readonly remoteStatus: MachineSftpRemoteStatus | null;

	constructor(
		readonly reason:
			'cancelled' | 'timeout' | 'closed' | 'operation_failed' | 'limit_exceeded' | 'invalid_metadata',
		readonly outcome: 'not_started' | 'failed' | 'unknown',
		options?: ErrorOptions & { remoteStatus?: MachineSftpRemoteStatus },
	) {
		super('SFTP ' + reason, options);
		this.name = 'MachineSftpFailure';
		this.remoteStatus = options?.remoteStatus ?? null;
	}
}

export interface MachineSftpLease {
	stat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo>;
	lstat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo>;
	list(path: string, options: MachineSftpListOptions): Promise<MachineDirectoryEntry[]>;
	scan(path: string, options?: MachineOperationOptions): AsyncIterable<MachineDirectoryEntry>;
	read(path: string, options?: MachineSftpReadOptions): Readable;
	readChunks(path: string, options?: MachineSftpReadOptions): AsyncIterable<Uint8Array>;
	write(path: string, options?: MachineSftpWriteOptions): Writable;
	writeFile(path: string, bytes: Uint8Array, options?: MachineSftpWriteOptions): Promise<void>;
	realpath(path: string, options?: MachineOperationOptions): Promise<string>;
	readlink(path: string, options?: MachineOperationOptions): Promise<string>;
	symlink(targetPath: string, linkPath: string, options?: MachineOperationOptions): Promise<void>;
	chmod(path: string, mode: number, options?: MachineOperationOptions): Promise<void>;
	utimes(path: string, accessedAt: number, modifiedAt: number, options?: MachineOperationOptions): Promise<void>;
	rename(from: string, to: string, options?: MachineOperationOptions): Promise<void>;
	/** Replace a file without exposing server-specific rename extensions to business code. */
	replace(from: string, to: string, options?: MachineOperationOptions): Promise<void>;
	remove(path: string, options?: MachineOperationOptions): Promise<void>;
	mkdir(path: string, options?: MachineOperationOptions): Promise<void>;
	rmdir(path: string, options?: MachineOperationOptions): Promise<void>;
	close(): Promise<void>;
}

export interface MachineConnection {
	readonly isOpen: boolean;
	openShell(pty: MachinePty, signal?: AbortSignal): Promise<MachineShell>;
	openRawCommand(command: string, signal?: AbortSignal, abortMode?: MachineCommandAbortMode): Promise<MachineCommand>;
	execute(command: string, options: MachineExecuteOptions): Promise<MachineCommandResult>;
	openSftp(signal?: AbortSignal): Promise<MachineSftpLease>;
	onClose(listener: (reason: 'disconnected') => void): () => void;
	close(): Promise<void>;
}

export interface MachineSshFactory {
	connect(endpoint: MachineEndpoint, options: MachineConnectOptions): Promise<MachineConnection>;
}

/** Native capabilities consume commands without acquiring application target identities. */
export type MachineCommandExecutor = (command: string, options: MachineExecuteOptions) => Promise<MachineCommandResult>;
