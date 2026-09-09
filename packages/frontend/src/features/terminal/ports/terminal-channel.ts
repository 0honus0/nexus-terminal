import type { TerminalOutput, TerminalViewport } from '../model/terminal';

export interface TerminalHistoryPage {
  data: Uint8Array;
  hasMore: boolean;
}

export interface TerminalChannel {
  sendInput(data: string): void | Promise<void>;
  resize(viewport: TerminalViewport): void | Promise<void>;
  onOutput(handler: (output: TerminalOutput) => void): () => void;
  onClose(handler: (reason?: string) => void): () => void;
  onError(handler: (message: string) => void): () => void;
  setPreviousOutputAvailable?(available: boolean): void;
  hasPreviousOutput?(): boolean;
  loadPreviousOutput?(): Promise<TerminalHistoryPage | null>;
  resetPreviousOutput?(): Promise<boolean>;
}
