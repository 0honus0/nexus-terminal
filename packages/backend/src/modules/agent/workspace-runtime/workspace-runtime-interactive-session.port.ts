import type { Scope } from '../agent.types';

export interface WorkspaceRuntimeInteractiveSessionRequest extends Scope {
  workspaceId: string;
  generation: number;
  columns: number;
  rows: number;
}

export interface WorkspaceRuntimeInteractiveSession {
  readonly workspaceId: string;
  readonly generation: number;
  readonly isOpen: boolean;
  write(data: string | Uint8Array): boolean;
  resize(columns: number, rows: number): void;
  signal(signal: string): void;
  pause(): void;
  resume(): void;
  onDrain(listener: () => void): () => void;
  onData(listener: (data: Uint8Array) => void): () => void;
  onStderr(listener: (data: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
}

export interface WorkspaceRuntimeInteractiveSessionPort {
  open(
    request: WorkspaceRuntimeInteractiveSessionRequest,
    signal?: AbortSignal,
  ): Promise<WorkspaceRuntimeInteractiveSession>;
  closeAll(): Promise<void>;
}

export interface WorkspaceRuntimeTerminalAttachment {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly generation: number;
  readonly isOpen: boolean;
  write(data: string | Uint8Array): boolean;
  resize(columns: number, rows: number): void;
  signal(signal: string): void;
  pause(): void;
  resume(): void;
  replayBuffered(): void;
  onDrain(listener: () => void): () => void;
  onData(listener: (data: Uint8Array) => void): () => void;
  onStderr(listener: (data: Uint8Array) => void): () => void;
  onClose(listener: () => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  detach(): void;
  close(): Promise<void>;
}
