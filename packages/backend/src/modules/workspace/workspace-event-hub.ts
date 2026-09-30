import type { ArchiveEvent } from '../../platform/operations/archive/archive-operation.port';
import type { TransferEvent } from '../../platform/operations/transfer/transfer-operation.port';
import type { UploadEvent } from '../../platform/operations/upload/upload-operation.port';
import type { ServerStatus } from '../../platform/system/server-status.port';
import { logger } from '../../shared/logging/logger';

const MAX_RETAINED_OPERATION_EVENTS = 256;

export type WorkspaceEvent =
  | { type: 'terminal-output'; data: Uint8Array; stderr?: boolean }
  | { type: 'terminal-resize'; columns: number; rows: number }
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
  private readonly retained = new Map<string, Map<string, WorkspaceEvent>>();

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
    const retentionKey = this.retentionKey(event);
    if (retentionKey) {
      const retained = this.retained.get(sessionId) ?? new Map<string, WorkspaceEvent>();
      retained.delete(retentionKey);
      retained.set(retentionKey, event);
      while (retained.size > MAX_RETAINED_OPERATION_EVENTS) retained.delete(retained.keys().next().value!);
      this.retained.set(sessionId, retained);
    }
    for (const listener of this.listeners.get(sessionId) ?? []) {
      try {
        listener(event);
      } catch (error) {
        logger.error({ err: error, workspaceId: sessionId, eventType: event.type }, 'Workspace event listener failed');
      }
    }
  }

  replayRetained(sessionId: string, listener: WorkspaceEventListener): void {
    for (const event of this.retained.get(sessionId)?.values() ?? []) listener(event);
  }

  clear(sessionId: string): void {
    this.listeners.delete(sessionId);
    this.retained.delete(sessionId);
  }

  private retentionKey(event: WorkspaceEvent): string | null {
    if (event.type === 'transfer-event') return `transfer:${event.event.requestId}`;
    if (event.type === 'archive-event') return `archive:${event.event.requestId}`;
    return null;
  }
}
