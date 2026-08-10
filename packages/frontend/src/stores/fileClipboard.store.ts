import { computed, ref } from 'vue';
import { defineStore } from 'pinia';

export type FileClipboardOperation = 'copy' | 'cut';

export const useFileClipboardStore = defineStore('fileClipboard', () => {
  const operation = ref<FileClipboardOperation | null>(null);
  const sourceSessionId = ref('');
  const sourcePaths = ref<string[]>([]);
  const sourceBaseDir = ref('');

  const clipboardState = computed(() => ({
    hasContent: Boolean(sourceSessionId.value && sourcePaths.value.length > 0 && operation.value),
    operation: operation.value ?? undefined,
  }));

  const setClipboard = (payload: {
    operation: FileClipboardOperation;
    sourceSessionId: string;
    sourcePaths: string[];
    sourceBaseDir: string;
  }) => {
    operation.value = payload.operation;
    sourceSessionId.value = payload.sourceSessionId;
    sourcePaths.value = [...payload.sourcePaths];
    sourceBaseDir.value = payload.sourceBaseDir;
  };

  const clearClipboard = () => {
    operation.value = null;
    sourceSessionId.value = '';
    sourcePaths.value = [];
    sourceBaseDir.value = '';
  };

  return {
    operation,
    sourceSessionId,
    sourcePaths,
    sourceBaseDir,
    clipboardState,
    setClipboard,
    clearClipboard,
  };
});
