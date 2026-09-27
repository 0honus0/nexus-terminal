import { ref, type Ref } from 'vue';

export interface TerminalSessionState {
  readonly snapshot: Ref<string>;
  readonly searchOpen: Ref<boolean>;
  readonly searchTerm: Ref<string>;
  readonly remotePtyGeneration: Ref<number>;
  replaceSnapshot(value: string): void;
  discardRemotePty(): void;
}

export const RESET_REMOTE_PTY_DISPLAY =
  '\x1b[?47;1047;1049l\x1b[?9;1000;1002;1003;1004;1005;1006;1015;2004;2026l\x1b[!p\r\x1b[2K';

/**
 * Keeps terminal presentation state across pane remounts without making the
 * Workspace runtime own xterm internals. The runtime only retains this feature
 * state instance for one Workspace session lifetime.
 */
export function createTerminalSessionState(): TerminalSessionState {
  const snapshot = ref('');
  const searchOpen = ref(false);
  const searchTerm = ref('');
  const remotePtyGeneration = ref(0);
  return {
    snapshot,
    searchOpen,
    searchTerm,
    remotePtyGeneration,
    replaceSnapshot(value) {
      snapshot.value = value;
    },
    discardRemotePty() {
      if (!snapshot.value.endsWith(RESET_REMOTE_PTY_DISPLAY)) snapshot.value += RESET_REMOTE_PTY_DISPLAY;
      remotePtyGeneration.value += 1;
    },
  };
}
