import type { Readable } from 'node:stream';

/** Technical byte store; the suspended ownership and history cursor belong
 * exclusively to the Remote Workspace application Service.
 */
export interface SuspendedTerminalLogSlice {
	readonly data: Uint8Array;
	/** Absolute offsets never reset after the 100 MiB disk window compacts. */
	readonly startOffset: number;
	readonly endOffset: number;
	readonly totalBytes: number;
	readonly oldestOffset: number;
}

export interface SuspendedTerminalLogPort {
	clearAll(): Promise<void>;
	append(id: string, bytes: Uint8Array): Promise<number>;
	flush(id: string): Promise<void>;
	position(id: string): Promise<number>;
	readTail(id: string, maxBytes: number): Promise<SuspendedTerminalLogSlice>;
	readBefore(id: string, beforeOffset: number, maxBytes: number): Promise<SuspendedTerminalLogSlice>;
	openRead(id: string): Promise<Readable>;
	delete(id: string): Promise<void>;
	close(): Promise<void>;
}

export interface TerminalLogTextSource {
	readonly bytes: AsyncIterable<Uint8Array>;
	release(): Promise<void>;
}

export interface TerminalLogRenderer {
	render(
		source: Readable,
		viewport: { columns: number; rows: number },
		signal?: AbortSignal,
	): Promise<TerminalLogTextSource>;
}
