import type { ArchiveEvent } from '../../platform/operations/archive/archive-operation.port';
import type { TransferEvent } from '../../platform/operations/transfer/transfer-operation.port';
import type { UploadEvent } from '../../platform/operations/upload/upload-operation.port';
import type { ServerStatus } from '../../platform/system/server-status.port';

export type WorkspaceEvent =
  | { type: 'terminal-output'; data: Uint8Array; stderr?: boolean }
  | { type: 'terminal-input-ack'; sequence: number; bytes: number }
  | { type: 'terminal-closed' }
  | { type: 'terminal-error'; message: string }
  | { type: 'directory-change-queued'; requestId: string; path: string; waitingForPrompt: boolean }
  | { type: 'directory-change-result'; requestId: string; path: string }
  | { type: 'directory-change-error'; requestId: string; message: string }
  | { type: 'status-update'; connectionId: number; status: ServerStatus }
  | { type: 'status-error'; connectionId: number; message: string }
  | { type: 'filesystem-ready'; connectionId: number }
  | { type: 'filesystem-error'; connectionId: number; message: string }
  | { type: 'upload-event'; event: UploadEvent }
  | { type: 'transfer-event'; event: TransferEvent }
  | { type: 'archive-event'; event: ArchiveEvent };

export type WorkspaceEventListener = (event: WorkspaceEvent) => void;

/** Protocol-neutral event fanout. Interfaces translate these events to WebSocket frames. */
export class WorkspaceEventHub {
  private readonly listeners = new Map<string, Set<WorkspaceEventListener>>();

  subscribe(sessionId: string, listener: WorkspaceEventListener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<WorkspaceEventListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }

  publish(sessionId: string, event: WorkspaceEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try {
        listener(event);
      } catch {
        /* interface observers are isolated */
      }
    }
  }

  clear(sessionId: string): void {
    this.listeners.delete(sessionId);
  }
}
