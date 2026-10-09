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
	onClose(listener: () => void): () => void;
	close(): Promise<void>;
}
