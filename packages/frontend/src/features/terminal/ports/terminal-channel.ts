import type { TerminalOutput, TerminalViewport } from '../model/terminal';
export interface TerminalChannel {
  sendInput(data: string): void | Promise<void>;
  resize(viewport: TerminalViewport): void | Promise<void>;
  onOutput(handler: (output: TerminalOutput) => void): () => void;
  onClose(handler: (reason?: string) => void): () => void;
  onError(handler: (message: string) => void): () => void;
}
