import { ref, type Ref } from 'vue';

export interface TerminalSessionState {
  readonly snapshot: Ref<string>;
  readonly searchOpen: Ref<boolean>;
  readonly searchTerm: Ref<string>;
  replaceSnapshot(value: string): void;
}

/**
 * Keeps terminal presentation state across pane remounts without making the
 * Workspace runtime own xterm internals. The runtime only retains this feature
 * state instance for one Workspace session lifetime.
 */
export function createTerminalSessionState(): TerminalSessionState {
  const snapshot = ref('');
  const searchOpen = ref(false);
  const searchTerm = ref('');
  return {
    snapshot,
    searchOpen,
    searchTerm,
    replaceSnapshot(value) {
      snapshot.value = value;
    },
  };
}
