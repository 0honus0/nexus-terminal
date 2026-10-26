import type { TerminalOutput, TerminalViewport } from '../model/terminal-types';

export interface TerminalHistoryPage {
	data: Uint8Array;
	hasMore: boolean;
}

export interface TerminalChannel {
	sendInput(data: string): void | Promise<void>;
	resize(viewport: TerminalViewport): void | Promise<void>;
	/** Actual bytes accepted by the transport, after keyboard modifiers. */
	onInputSent?(handler: (data: string) => void): () => void;
	onOutput(handler: (output: TerminalOutput) => void): () => void;
	onClose(handler: (reason?: string) => void): () => void;
	onError(handler: (message: string) => void): () => void;
	onConnected?(handler: () => void): () => void;
	onResumeComplete?(handler: () => void): () => void;
	completeResume?(): void;
	setPreviousOutputAvailable?(available: boolean): void;
	hasPreviousOutput?(): boolean;
	loadPreviousOutput?(maxBytes?: number): Promise<TerminalHistoryPage | null>;
	resetPreviousOutput?(): Promise<boolean>;
}
