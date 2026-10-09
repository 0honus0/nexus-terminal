/** Internal-only Remote module public contract; not an HTTP/WS DTO. */
export interface SessionView {
	id: string;
	targetId: number;
	fingerprint: string;
	startedAt: number;
	status: 'open' | 'closed';
}
export interface OpenShellRequest {
	targetId: number;
	columns: number;
	rows: number;
	term?: string;
	timeoutMs: number;
	signal?: AbortSignal;
}
export interface RemoteSessions {
	open(request: OpenShellRequest): Promise<SessionView>;
	get(id: string): SessionView | null;
	list(): SessionView[];
	/** false means Node stream backpressure, not a failed write. */
	write(id: string, bytes: Uint8Array): boolean;
	resize(id: string, columns: number, rows: number): void;
	onData(id: string, listener: (bytes: Uint8Array) => void): () => void;
	onStderr(id: string, listener: (bytes: Uint8Array) => void): () => void;
	onDrain(id: string, listener: () => void): () => void;
	onClosed(id: string, listener: () => void): () => void;
	closeSession(id: string): Promise<void>;
}
