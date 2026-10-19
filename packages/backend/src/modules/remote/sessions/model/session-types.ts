import type { RemoteHttpErrorCode } from '@nexus-terminal/shared/remote/sessions/values';

export type SessionCloseReason = 'normal' | 'disconnected' | 'cleanup_failed' | 'closed_by_owner';

export type RemotePermissionCode = Extract<
	RemoteHttpErrorCode,
	'unauthenticated' | 'forbidden' | 'not_found' | 'remote_unavailable'
>;

/** Remote-owned session identity and user-facing metadata. */
export interface RemoteSessionSnapshot {
	readonly id: string;
	readonly targetId: number;
	readonly fingerprint: string;
	readonly startedAt: number;
	readonly status: 'open' | 'closed';
}

/** Application request and live resource contract, independent of Platform transport types. */
export interface OpenSessionRequest {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

/** Same-module session use cases consumed by authenticated PTY owners. */
export interface RemoteSessionOperations {
	open(request: OpenSessionRequest): Promise<RemoteSessionSnapshot>;
	get(id: string): RemoteSessionSnapshot | null;
	closeSession(id: string): Promise<void>;
	write(id: string, bytes: Uint8Array): boolean;
	resize(id: string, columns: number, rows: number): void;
	onData(id: string, listener: (bytes: Uint8Array) => void): () => void;
	onStderr(id: string, listener: (bytes: Uint8Array) => void): () => void;
	onDrain(id: string, listener: () => void): () => void;
	onClosed(id: string, listener: (reason: SessionCloseReason) => void): () => void;
	pauseOutput(id: string): void;
	resumeOutput(id: string): void;
}

export interface RemoteSessionResource {
	readonly targetId: number;
	readonly fingerprint: string;
	readonly isOpen: boolean;
	write(bytes: Uint8Array): boolean;
	resize(columns: number, rows: number): void;
	pause(): void;
	resume(): void;
	onData(listener: (bytes: Uint8Array) => void): () => void;
	onStderr(listener: (bytes: Uint8Array) => void): () => void;
	onDrain(listener: () => void): () => void;
	onClose(listener: (reason: 'normal' | 'disconnected') => void): () => void;
	close(): Promise<void>;
}
