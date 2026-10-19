export interface SuspendedViewport {
	readonly columns: number;
	readonly rows: number;
}

export interface SuspendedTerminalCheckpointView extends SuspendedViewport {
	readonly data: string;
}

export interface SuspendedTerminalCheckpoint {
	write(data: Uint8Array | string): Promise<void>;
	resize(viewport: SuspendedViewport): Promise<void>;
	reset(data: string, viewport: SuspendedViewport): Promise<void>;
	snapshot(): Promise<SuspendedTerminalCheckpointView>;
	dispose(): Promise<void>;
}

export interface SuspendedCheckpointFactory {
	create(initial: string | undefined, viewport: SuspendedViewport): SuspendedTerminalCheckpoint;
}
