import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { FileDocumentPort } from '../ports/file-document-port';
import type { EditorDocument, EditorLineEnding } from '../model/editor';
import { canonicalEditorEncoding, decodeEditorRawContent, encodeEditorContentBase64 } from '../model/editorEncoding';

const languageFor = (path: string) => {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'dockerfile';
  const ext = name.split('.').pop() ?? '';
  return (
    (
      {
        js: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        css: 'css',
        scss: 'scss',
        less: 'less',
        html: 'html',
        htm: 'html',
        md: 'markdown',
        markdown: 'markdown',
        py: 'python',
        java: 'java',
        c: 'c',
        h: 'c',
        cpp: 'cpp',
        cc: 'cpp',
        cxx: 'cpp',
        hpp: 'cpp',
        cs: 'csharp',
        go: 'go',
        php: 'php',
        rb: 'ruby',
        rs: 'rust',
        sql: 'sql',
        sh: 'shell',
        bash: 'shell',
        zsh: 'shell',
        yaml: 'yaml',
        yml: 'yaml',
        xml: 'xml',
        ini: 'ini',
        conf: 'ini',
        bat: 'bat',
        cmd: 'bat',
      } as Record<string, string>
    )[ext] ?? 'plaintext'
  );
};

export interface FileEditorOpenContext {
  scopeId?: string;
  scopeLabel?: string;
  port: FileDocumentPort;
}

export interface FileEditorSessionController {
  tabs: Ref<EditorDocument[]>;
  activeId: Ref<string | null>;
  active: ComputedRef<EditorDocument | null>;
  loading: Ref<boolean>;
  open(path: string, context?: FileEditorOpenContext): Promise<EditorDocument>;
  update(content: string): void;
  save(doc?: EditorDocument | null): Promise<void>;
  reload(id: string): Promise<void>;
  changeEncoding(id: string, encoding: string): Promise<void>;
  changeLineEnding(id: string, lineEnding: EditorLineEnding): void;
  updateScrollPosition(id: string, scrollTop: number, scrollLeft: number): void;
  close(id: string): void;
  closeOthers(id: string): void;
  closeToRight(id: string): void;
  closeToLeft(id: string): void;
  closeAll(): void;
  closeScope(scopeId: string): void;
  activateRelative(delta: number): void;
}

export function createFileEditorSession(defaultPort?: FileDocumentPort): FileEditorSessionController {
  const tabs = ref<EditorDocument[]>([]);
  const activeId = ref<string | null>(null);
  const loading = ref(false);
  const ports = new Map<string, FileDocumentPort>();
  const active = computed(() => tabs.value.find((item) => item.id === activeId.value) ?? null);

  async function open(path: string, context?: FileEditorOpenContext): Promise<EditorDocument> {
    const scopeId = context?.scopeId;
    const existing = tabs.value.find((item) => item.path === path && item.scopeId === scopeId);
    if (existing) {
      activeId.value = existing.id;
      return existing;
    }
    const port = context?.port ?? defaultPort;
    if (!port) throw new Error('No document port is available for this file.');
    loading.value = true;
    try {
      const loaded = await port.load(path);
      const doc: EditorDocument = {
        id: crypto.randomUUID(),
        scopeId,
        scopeLabel: context?.scopeLabel,
        path,
        name: path.split('/').pop() || path,
        content: loaded.content,
        originalContent: loaded.content,
        rawContentBase64: loaded.rawContentBase64,
        encoding: canonicalEditorEncoding(loaded.encoding),
        language: languageFor(path),
        dirty: false,
        saveState: 'idle',
        scrollTop: 0,
        scrollLeft: 0,
      };
      ports.set(doc.id, port);
      tabs.value.push(doc);
      activeId.value = doc.id;
      return doc;
    } finally {
      loading.value = false;
    }
  }

  function update(content: string): void {
    if (!active.value) return;
    active.value.content = content;
    active.value.dirty = content !== active.value.originalContent;
    active.value.saveState = 'idle';
  }

  async function save(doc = active.value): Promise<void> {
    if (!doc) return;
    const port = ports.get(doc.id) ?? defaultPort;
    if (!port) throw new Error('The source session for this file is no longer available.');
    doc.saveState = 'saving';
    doc.error = undefined;
    try {
      await port.save(doc.path, doc.content, doc.encoding);
      doc.rawContentBase64 = encodeEditorContentBase64(doc.content, doc.encoding);
      doc.originalContent = doc.content;
      doc.dirty = false;
      doc.saveState = 'saved';
    } catch (cause) {
      doc.saveState = 'error';
      doc.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
  }

  async function reload(id: string): Promise<void> {
    const doc = tabs.value.find((item) => item.id === id);
    if (!doc) return;
    const port = ports.get(doc.id) ?? defaultPort;
    if (!port) throw new Error('The source session for this file is no longer available.');
    loading.value = true;
    doc.error = undefined;
    try {
      const loaded = await port.load(doc.path);
      doc.content = loaded.content;
      doc.originalContent = loaded.content;
      doc.rawContentBase64 = loaded.rawContentBase64;
      doc.encoding = canonicalEditorEncoding(loaded.encoding);
      doc.dirty = false;
      doc.saveState = 'idle';
    } catch (cause) {
      doc.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  async function changeEncoding(id: string, encoding: string): Promise<void> {
    const doc = tabs.value.find((item) => item.id === id);
    if (!doc || !encoding || doc.encoding === encoding) return;
    loading.value = true;
    doc.error = undefined;
    try {
      doc.content = decodeEditorRawContent(doc.rawContentBase64, encoding);
      doc.originalContent = doc.content;
      doc.encoding = encoding;
      doc.dirty = false;
      doc.saveState = 'idle';
    } catch (cause) {
      doc.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    } finally {
      loading.value = false;
    }
  }

  function changeLineEnding(id: string, lineEnding: EditorLineEnding): void {
    const doc = tabs.value.find((item) => item.id === id);
    if (!doc) return;
    const delimiter = lineEnding === 'crlf' ? '\r\n' : lineEnding === 'cr' ? '\r' : '\n';
    const normalized = doc.content.replace(/\r\n|\r|\n/g, '\n');
    const next = normalized.replace(/\n/g, delimiter);
    if (next === doc.content) return;
    doc.content = next;
    doc.dirty = next !== doc.originalContent;
    doc.saveState = 'idle';
  }

  function updateScrollPosition(id: string, scrollTop: number, scrollLeft: number): void {
    const doc = tabs.value.find((item) => item.id === id);
    if (!doc) return;
    doc.scrollTop = Math.max(0, scrollTop);
    doc.scrollLeft = Math.max(0, scrollLeft);
  }

  function close(id: string): void {
    const index = tabs.value.findIndex((item) => item.id === id);
    if (index < 0) return;
    tabs.value.splice(index, 1);
    ports.delete(id);
    if (activeId.value === id) activeId.value = tabs.value[Math.min(index, tabs.value.length - 1)]?.id ?? null;
  }

  function closeOthers(id: string): void {
    if (!tabs.value.some((item) => item.id === id)) return;
    for (const tab of [...tabs.value]) if (tab.id !== id) close(tab.id);
    activeId.value = id;
  }

  function closeToRight(id: string): void {
    const index = tabs.value.findIndex((item) => item.id === id);
    if (index < 0) return;
    for (const tab of tabs.value.slice(index + 1)) close(tab.id);
  }

  function closeToLeft(id: string): void {
    const index = tabs.value.findIndex((item) => item.id === id);
    if (index < 0) return;
    for (const tab of tabs.value.slice(0, index)) close(tab.id);
  }

  function closeAll(): void {
    for (const tab of [...tabs.value]) close(tab.id);
  }

  function closeScope(scopeId: string): void {
    for (const tab of [...tabs.value]) if (tab.scopeId === scopeId) close(tab.id);
  }

  function activateRelative(delta: number): void {
    if (tabs.value.length <= 1 || !activeId.value) return;
    const index = tabs.value.findIndex((item) => item.id === activeId.value);
    if (index < 0) return;
    activeId.value = tabs.value[(index + delta + tabs.value.length) % tabs.value.length]!.id;
  }

  return {
    tabs,
    activeId,
    active,
    loading,
    open,
    update,
    save,
    reload,
    changeEncoding,
    changeLineEnding,
    updateScrollPosition,
    close,
    closeOthers,
    closeToRight,
    closeToLeft,
    closeAll,
    closeScope,
    activateRelative,
  };
}

export const useFileEditorSession = createFileEditorSession;
