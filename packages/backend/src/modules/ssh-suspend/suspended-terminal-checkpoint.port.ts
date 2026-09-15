export interface SuspendedTerminalViewport {
  columns: number;
  rows: number;
}

export interface SuspendedTerminalCheckpointSnapshot extends SuspendedTerminalViewport {
  data: string;
}

export interface SuspendedTerminalCheckpoint {
  write(data: string | Uint8Array): Promise<void>;
  resize(viewport: SuspendedTerminalViewport): Promise<void>;
  reset(snapshot: string, viewport: SuspendedTerminalViewport): Promise<void>;
  snapshot(): Promise<SuspendedTerminalCheckpointSnapshot>;
  dispose(): void;
}

export interface SuspendedTerminalCheckpointFactory {
  create(snapshot: string | undefined, viewport: SuspendedTerminalViewport): SuspendedTerminalCheckpoint;
}
