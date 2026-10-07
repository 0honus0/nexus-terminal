import { ref, type Ref } from 'vue';

export interface TerminalSessionState {
  readonly snapshot: Ref<string>;
  readonly geometry: Ref<{ columns: number; rows: number } | null>;
  readonly searchOpen: Ref<boolean>;
  readonly searchTerm: Ref<string>;
  readonly remotePtyGeneration: Ref<number>;
  replaceSnapshot(value: string): void;
  replaceGeometry(columns: number, rows: number): void;
  discardRemotePty(): void;
}

export const RESET_REMOTE_PTY_DISPLAY =
  '\x1b[?47;1047;1049l\x1b[?9;1000;1002;1003;1004;1005;1006;1015;1016;2004;2026l\x1b[!p\r\x1b[2K';

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
  return {
    snapshot,
    geometry,
    searchOpen,
    searchTerm,
    remotePtyGeneration,
    replaceSnapshot(value) {
      snapshot.value = value;
    },
    replaceGeometry(columns, rows) {
      if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns <= 0 || rows <= 0) return;
      geometry.value = { columns, rows };
    },
    discardRemotePty() {
      if (!snapshot.value.endsWith(RESET_REMOTE_PTY_DISPLAY)) snapshot.value += RESET_REMOTE_PTY_DISPLAY;
      remotePtyGeneration.value += 1;
    },
  };
}
