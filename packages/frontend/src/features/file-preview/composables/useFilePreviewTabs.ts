import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { previewInlineLimit, previewKindFor } from '../providers/previewRegistry';
import type { FilePreviewSource } from '../ports/file-preview-source';
import type { PreviewFile, PreviewTab } from '../model/preview';

export interface FilePreviewOpenContext {
  scopeId?: string;
  source: FilePreviewSource;
}

export interface FilePreviewSessionController {
  tabs: Ref<PreviewTab[]>;
  activeId: Ref<string | null>;
  active: ComputedRef<PreviewTab | null>;
  open(path: string, context?: FilePreviewOpenContext): Promise<PreviewTab>;
  close(id: string): void;
  closeScope(scopeId: string): void;
  clear(): void;
  refresh(tab?: PreviewTab | null): Promise<void>;
}

interface PreviewOperation {
  token: number;
  controller: AbortController;
}

const isAbortError = (cause: unknown): boolean =>
  cause instanceof DOMException ? cause.name === 'AbortError' : cause instanceof Error && cause.name === 'AbortError';

export function createFilePreviewSession(defaultSource?: FilePreviewSource): FilePreviewSessionController {
  const tabs = ref<PreviewTab[]>([]);
  const activeId = ref<string | null>(null);
  const sources = new Map<string, FilePreviewSource>();
  const operations = new Map<string, PreviewOperation>();
  const active = computed(() => tabs.value.find((item) => item.id === activeId.value) ?? null);
  let operationToken = 0;
  let pendingOpenId: string | null = null;

  const beginOperation = (tabId: string): PreviewOperation => {
    operations.get(tabId)?.controller.abort();
    const operation = { token: ++operationToken, controller: new AbortController() };
    operations.set(tabId, operation);
    return operation;
  };

  const operationIsCurrent = (tabId: string, operation: PreviewOperation): boolean =>
    operations.get(tabId)?.token === operation.token && tabs.value.some((tab) => tab.id === tabId);

  const finishOperation = (tabId: string, operation: PreviewOperation): void => {
    if (operations.get(tabId)?.token === operation.token) operations.delete(tabId);
  };

  const abortOperation = (tabId: string): void => {
    operations.get(tabId)?.controller.abort();
    operations.delete(tabId);
    if (pendingOpenId === tabId) pendingOpenId = null;
  };

  const previewFile = (tab: PreviewTab, data: { bytes: ArrayBuffer; mimeType?: string }): PreviewFile => ({
    path: tab.path,
    name: tab.name,
    kind: tab.kind,
    mimeType: data.mimeType,
    bytes: data.bytes,
  });

  async function loadInitial(tab: PreviewTab, source: FilePreviewSource): Promise<void> {
    const operation = beginOperation(tab.id);
    pendingOpenId = tab.id;
    tab.loading = true;
    tab.error = undefined;
    try {
      const data = await source.read(tab.path, {
        maxBytes: previewInlineLimit(tab.kind),
        signal: operation.controller.signal,
      });
      if (!operationIsCurrent(tab.id, operation)) return;
      if ('tooLarge' in data) {
        tab.file = undefined;
        tab.error = { type: 'tooLarge', maxBytes: data.maxBytes, actualBytes: data.actualBytes };
        return;
      }
      tab.file = previewFile(tab, data);
    } catch (cause) {
      if (!isAbortError(cause) && operationIsCurrent(tab.id, operation)) {
        tab.error = { type: 'message', message: cause instanceof Error ? cause.message : String(cause) };
      }
    } finally {
      if (operationIsCurrent(tab.id, operation)) tab.loading = false;
      finishOperation(tab.id, operation);
      if (pendingOpenId === tab.id) pendingOpenId = null;
    }
  }

  async function open(path: string, context?: FilePreviewOpenContext): Promise<PreviewTab> {
    const scopeId = context?.scopeId;
    let tab = tabs.value.find((item) => item.path === path && item.scopeId === scopeId);
    if (tab) {
      activeId.value = tab.id;
      if (tab.error && !tab.file && !tab.loading) {
        const source = sources.get(tab.id) ?? context?.source ?? defaultSource;
        if (source) await loadInitial(tab, source);
      }
      return tab;
    }
    if (pendingOpenId) {
      const pending = tabs.value.find((item) => item.id === pendingOpenId);
      if (pending?.loading) close(pending.id);
    }
    const source = context?.source ?? defaultSource;
    if (!source) throw new Error('No preview source is available for this file.');
    tab = {
      id: crypto.randomUUID(),
      scopeId,
      path,
      name: path.split('/').pop() || path,
      kind: previewKindFor(path),
      loading: true,
      refreshing: false,
    };
    tabs.value.push(tab);
    sources.set(tab.id, source);
    activeId.value = tab.id;
    await loadInitial(tab, source);
    return tab;
  }

  function close(id: string): void {
    const index = tabs.value.findIndex((item) => item.id === id);
    if (index < 0) return;
    abortOperation(id);
    tabs.value.splice(index, 1);
    sources.delete(id);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? null;
  }

  function closeScope(scopeId: string): void {
    for (const tab of [...tabs.value]) if (tab.scopeId === scopeId) close(tab.id);
  }

  function clear(): void {
    for (const operation of operations.values()) operation.controller.abort();
    operations.clear();
    pendingOpenId = null;
    tabs.value = [];
    activeId.value = null;
    sources.clear();
  }

  async function refresh(tab = active.value): Promise<void> {
    if (!tab || tab.loading || tab.refreshing) return;
    const source = sources.get(tab.id) ?? defaultSource;
    if (!source) throw new Error('The source session for this preview is no longer available.');
    const operation = beginOperation(tab.id);
    tab.refreshing = true;
    try {
      const data = await source.read(tab.path, {
        maxBytes: previewInlineLimit(tab.kind),
        signal: operation.controller.signal,
      });
      if (!operationIsCurrent(tab.id, operation)) return;
      if ('tooLarge' in data) throw new Error('The refreshed file exceeds the inline preview size limit.');
      tab.file = previewFile(tab, data);
      tab.error = undefined;
    } catch (cause) {
      if (!isAbortError(cause) && operationIsCurrent(tab.id, operation)) throw cause;
    } finally {
      if (operationIsCurrent(tab.id, operation)) tab.refreshing = false;
      finishOperation(tab.id, operation);
    }
  }

  return { tabs, activeId, active, open, close, closeScope, clear, refresh };
}

export const useFilePreviewTabs = createFilePreviewSession;
