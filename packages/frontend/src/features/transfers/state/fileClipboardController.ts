import { computed, ref } from 'vue';

export type FileClipboardOperation = 'copy' | 'cut';

export interface FileClipboardItem {
  path: string;
  name: string;
  type: 'file' | 'directory';
}

export interface FileClipboardSnapshot {
  generation: string;
  operation: FileClipboardOperation;
  sourceScopeId: string;
  items: readonly FileClipboardItem[];
}

/**
 * File-operation intent only. Transfer progress/lifecycle remains owned by the
 * normal TransferController; this controller stores no task state.
 */
export function createFileClipboardController() {
  const value = ref<FileClipboardSnapshot | null>(null);

  const set = (
    operation: FileClipboardOperation,
    sourceScopeId: string,
    items: readonly FileClipboardItem[],
  ): FileClipboardSnapshot | null => {
    if (!sourceScopeId || !items.length) {
      value.value = null;
      return null;
    }
    const snapshot: FileClipboardSnapshot = {
      generation: crypto.randomUUID(),
      operation,
      sourceScopeId,
      items: items.map((item) => ({ ...item })),
    };
    value.value = snapshot;
    return snapshot;
  };

  const clear = (generation?: string): boolean => {
    if (!value.value) return false;
    if (generation && value.value.generation !== generation) return false;
    value.value = null;
    return true;
  };

  return {
    value,
    count: computed(() => value.value?.items.length ?? 0),
    set,
    clear,
  };
}

export type FileClipboardController = ReturnType<typeof createFileClipboardController>;
