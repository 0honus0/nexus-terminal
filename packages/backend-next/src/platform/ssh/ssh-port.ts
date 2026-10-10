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

export type MachineCommandOutcome =
	| { status: 'completed'; exitCode: 0; signal: string | null }
	| { status: 'nonzero'; exitCode: number; signal: string | null }
	| { status: 'unknown'; reason: 'disconnect' | 'timeout' | 'cancelled' | 'channel_error' };

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
	readonly mode: number;
	readonly modifiedAt: number;
	readonly isDirectory: boolean;
	readonly isFile: boolean;
	readonly isSymbolicLink: boolean;
}

export interface MachineDirectoryEntry {
	readonly name: string;
	readonly info: MachineFileInfo;
}

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

/** Local failure never proves that an already dispatched remote mutation was rolled back. */
export class MachineSftpFailure extends Error {
	constructor(
		readonly reason:
			'cancelled' | 'timeout' | 'closed' | 'operation_failed' | 'limit_exceeded' | 'invalid_metadata',
		readonly outcome: 'not_started' | 'unknown',
		options?: ErrorOptions,
	) {
		super('SFTP ' + reason, options);
		this.name = 'MachineSftpFailure';
	}
}

export interface MachineSftpLease {
	stat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo>;
	lstat(path: string, options?: MachineOperationOptions): Promise<MachineFileInfo>;
	list(path: string, options: MachineSftpListOptions): Promise<MachineDirectoryEntry[]>;
	read(path: string, options?: MachineSftpReadOptions): Readable;
	write(path: string, options?: MachineSftpWriteOptions): Writable;
	rename(from: string, to: string, options?: MachineOperationOptions): Promise<void>;
	remove(path: string, options?: MachineOperationOptions): Promise<void>;
	mkdir(path: string, options?: MachineOperationOptions): Promise<void>;
	rmdir(path: string, options?: MachineOperationOptions): Promise<void>;
	close(): Promise<void>;
}

export interface MachineConnection {
	readonly isOpen: boolean;
	openShell(pty: MachinePty, signal?: AbortSignal): Promise<MachineShell>;
	openRawCommand(command: string, signal?: AbortSignal): Promise<MachineCommand>;
	execute(command: string, options: MachineExecuteOptions): Promise<MachineCommandResult>;
	openSftp(signal?: AbortSignal): Promise<MachineSftpLease>;
	onClose(listener: (reason: 'disconnected') => void): () => void;
	close(): Promise<void>;
}

export interface MachineSshFactory {
	connect(endpoint: MachineEndpoint, options: MachineConnectOptions): Promise<MachineConnection>;
}
