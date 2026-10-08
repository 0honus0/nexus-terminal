import { ref, type Ref } from 'vue';

export interface TerminalSessionState {
  readonly snapshot: Ref<string>;
  readonly geometry: Ref<{ columns: number; rows: number } | null>;
  readonly searchOpen: Ref<boolean>;
  readonly searchTerm: Ref<string>;
  readonly remotePtyGeneration: Ref<number>;
  replaceSnapshot(value: string): void;
  captureSnapshot(value: Promise<string>): void;
  restoreSnapshot(): Promise<string>;
  decodeOutput(value: string | Uint8Array): string;
  replaceGeometry(columns: number, rows: number): void;
  discardRemotePty(): void;
}

export const RESET_REMOTE_PTY_DISPLAY = '\x18\x1bc';

/**
 * Keeps terminal presentation state across pane remounts without making the
 * Workspace runtime own xterm internals. The runtime only retains this feature
 * state instance for one Workspace session lifetime.
 */
export function createTerminalSessionState(): TerminalSessionState {
  const snapshot = ref('');
  const geometry = ref<{ columns: number; rows: number } | null>(null);
  const searchOpen = ref(false);
  const searchTerm = ref('');
  const remotePtyGeneration = ref(0);
  let snapshotTask: Promise<void> | null = null;
  let outputDecoder = new TextDecoder();
  return {
    snapshot,
    geometry,
    searchOpen,
    searchTerm,
    remotePtyGeneration,
    replaceSnapshot(value) {
      snapshotTask = null;
      snapshot.value = value;
    },
    captureSnapshot(value) {
      const generation = remotePtyGeneration.value;
      const task = value
        .then((captured) => {
          if (snapshotTask === task && generation === remotePtyGeneration.value) snapshot.value = captured;
        })
        .catch(() => undefined)
        .finally(() => {
          if (snapshotTask === task) snapshotTask = null;
        });
      snapshotTask = task;
    },
    async restoreSnapshot() {
      while (snapshotTask) await snapshotTask;
      return snapshot.value;
    },
    decodeOutput(value) {
      return typeof value === 'string' ? value : outputDecoder.decode(value, { stream: true });
    },
    replaceGeometry(columns, rows) {
      if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) return;
      geometry.value = { columns, rows };
    },
    discardRemotePty() {
      snapshotTask = null;
      outputDecoder = new TextDecoder();
      snapshot.value = '';
      remotePtyGeneration.value += 1;
    },
  };
}
