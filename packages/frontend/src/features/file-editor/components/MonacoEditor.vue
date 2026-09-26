<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  // Register before the first editor.create() snapshots Monaco's standalone service collection.
  import 'monaco-editor/platform/actionWidget/browser/actionWidget';
  import 'monaco-editor/editor/contrib/comment/browser/comment';
  import 'monaco-editor/editor/contrib/find/browser/findController';
  import * as monaco from 'monaco-editor/editor/editor.api';
  import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
  import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
  import 'monaco-editor/basic-languages/monaco.contribution';
  import 'monaco-editor/language/json/monaco.contribution';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  // Monaco keeps these services internal; its own comment action reads the same configuration service.
  // @ts-ignore internal Monaco ESM module
  import { StandaloneServices } from 'monaco-editor/editor/standalone/browser/standaloneServices';
  // @ts-ignore internal Monaco ESM module
  import { ILanguageConfigurationService } from 'monaco-editor/editor/common/languages/languageConfigurationRegistry';

  const { t } = useI18n();

  interface ResolvedComments {
    lineCommentToken?: string;
  }

  interface LanguageConfigurationService {
    getLanguageConfiguration(languageId: string): { comments: ResolvedComments | null };
  }

  interface ContextualTextModel extends monaco.editor.ITextModel {
    getLanguageIdAtPosition(lineNumber: number, column: number): string;
    tokenization?: { tokenizeIfCheap(lineNumber: number): void };
  }

  interface SelectedLine {
    lineNumber: number;
    indent: number;
    token: string;
    text: string;
    commented: boolean;
  }

  interface OffsetEdit {
    start: number;
    end: number;
    text: string;
  }

  const registerLanguageAlias = (
    id: string,
    extensions: readonly string[],
    filenames: readonly string[] = [],
  ): void => {
    const current = monaco.languages.getLanguages().find((language) => language.id === id);
    const missingExtension = extensions.some((extension) => !current?.extensions?.includes(extension));
    const missingFilename = filenames.some((filename) => !current?.filenames?.includes(filename));
    if (missingExtension || missingFilename)
      monaco.languages.register({ id, extensions: [...extensions], filenames: [...filenames] });
  };

  const ensureFallbackLanguage = (
    id: string,
    extensions: readonly string[],
    comments: monaco.languages.CommentRule,
    filenames: readonly string[] = [],
  ): void => {
    if (!monaco.languages.getLanguages().some((language) => language.id === id)) {
      monaco.languages.register({ id, extensions: [...extensions], filenames: [...filenames] });
    } else {
      registerLanguageAlias(id, extensions, filenames);
    }
    monaco.languages.setLanguageConfiguration(id, { comments });
  };

  const registryState = globalThis as typeof globalThis & { __nexusFileEditorMonacoLanguages?: boolean };
  if (!registryState.__nexusFileEditorMonacoLanguages) {
    registryState.__nexusFileEditorMonacoLanguages = true;
    registerLanguageAlias('html', ['.vue', '.svelte']);
    monaco.languages.register({ id: 'jsonc', extensions: ['.jsonc'], aliases: ['JSON with Comments', 'jsonc'] });
    monaco.languages.setMonarchTokensProvider('jsonc', {
      tokenPostfix: '.json',
      brackets: [
        { open: '{', close: '}', token: 'delimiter.bracket' },
        { open: '[', close: ']', token: 'delimiter.array' },
      ],
      tokenizer: {
        root: [
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          [/[{}\[\]]/, '@brackets'],
          [/[,:]/, 'delimiter'],
          [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
          [/"(?:[^"\\]|\\.)*"/, 'string.value'],
          [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
          [/\b(?:true|false|null)\b/, 'keyword'],
          [/\s+/, 'white'],
        ],
        comment: [
          [/[^/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[/*]/, 'comment'],
        ],
      },
    });
    monaco.languages.setLanguageConfiguration('jsonc', {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [
        ['{', '}'],
        ['[', ']'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}', notIn: ['string'] },
        { open: '[', close: ']', notIn: ['string'] },
        { open: '"', close: '"', notIn: ['string'] },
      ],
    });
    registerLanguageAlias('ini', ['.properties']);
    ensureFallbackLanguage('toml', ['.toml'], { lineComment: '#' });
    ensureFallbackLanguage('haskell', ['.hs', '.lhs'], { lineComment: '--', blockComment: ['{-', '-}'] });
    ensureFallbackLanguage('makefile', ['.mk', '.make'], { lineComment: '#' }, ['Makefile', 'GNUmakefile']);
    monaco.languages.setLanguageConfiguration('dockerfile', { comments: { lineComment: '#' } });
  }

  const modelUriForPath = (path: string): monaco.Uri => {
    const normalized = path.replace(/\\/g, '/');
    const uriPath = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return monaco.Uri.from({ scheme: 'file', path: uriPath, query: crypto.randomUUID() });
  };

  const firstNonWhitespace = (text: string): number => /\S/.exec(text)?.index ?? -1;

  const selectedCommentLines = (
    activeEditor: monaco.editor.IStandaloneCodeEditor,
    activeModel: ContextualTextModel,
  ): SelectedLine[] | null => {
    const service = StandaloneServices.get(ILanguageConfigurationService) as LanguageConfigurationService;
    const selected = new Map<number, SelectedLine>();
    for (const selection of activeEditor.getSelections() ?? []) {
      let endLine = selection.endLineNumber;
      if (selection.startLineNumber < endLine && selection.endColumn === 1) endLine -= 1;
      for (let lineNumber = selection.startLineNumber; lineNumber <= endLine; lineNumber += 1) {
        if (selected.has(lineNumber)) continue;
        const text = activeModel.getLineContent(lineNumber);
        const indent = firstNonWhitespace(text);
        if (indent < 0) continue;
        activeModel.tokenization?.tokenizeIfCheap(lineNumber);
        const languageId = activeModel.getLanguageIdAtPosition(lineNumber, indent + 1);
        const token = service.getLanguageConfiguration(languageId).comments?.lineCommentToken;
        if (!token) return null;
        selected.set(lineNumber, {
          lineNumber,
          indent,
          token,
          text,
          commented: text.startsWith(token, indent),
        });
      }
    }
    return [...selected.values()];
  };

  const mapOffset = (offset: number, edits: readonly OffsetEdit[]): number => {
    let delta = 0;
    for (const edit of edits) {
      if (offset < edit.start) break;
      const removed = edit.end - edit.start;
      const inserted = edit.text.length;
      if (removed === 0 && offset === edit.start) {
        delta += inserted;
        continue;
      }
      if (offset <= edit.end) return edit.start + delta + inserted;
      delta += inserted - removed;
    }
    return offset + delta;
  };

  const toggleEditorComment = async (activeEditor: monaco.editor.IStandaloneCodeEditor): Promise<boolean> => {
    const activeModel = activeEditor.getModel() as ContextualTextModel | null;
    if (!activeModel || activeEditor.getOption(monaco.editor.EditorOption.readOnly)) return false;
    const lines = selectedCommentLines(activeEditor, activeModel);
    if (lines === null) {
      const action = activeEditor.getAction('editor.action.commentLine');
      if (!action) return false;
      await action.run();
      return true;
    }
    if (lines.length === 0) return false;

    const remove = lines.every((line) => line.commented);
    const edits: monaco.editor.IIdentifiedSingleEditOperation[] = [];
    const offsetEdits: OffsetEdit[] = [];
    for (const line of lines) {
      if (remove) {
        let length = line.token.length;
        if (line.text[line.indent + line.token.length] === ' ') length += 1;
        const startColumn = line.indent + 1;
        const range = new monaco.Range(line.lineNumber, startColumn, line.lineNumber, startColumn + length);
        edits.push({ range, text: '' });
        offsetEdits.push({
          start: activeModel.getOffsetAt(range.getStartPosition()),
          end: activeModel.getOffsetAt(range.getEndPosition()),
          text: '',
        });
      } else if (!line.commented) {
        const column = line.indent + 1;
        const range = new monaco.Range(line.lineNumber, column, line.lineNumber, column);
        const text = `${line.token} `;
        edits.push({ range, text });
        const offset = activeModel.getOffsetAt(range.getStartPosition());
        offsetEdits.push({ start: offset, end: offset, text });
      }
    }
    if (edits.length === 0) return false;

    offsetEdits.sort((left, right) => left.start - right.start || left.end - right.end);
    const offsets = (activeEditor.getSelections() ?? []).map((selection) => ({
      anchor: activeModel.getOffsetAt({
        lineNumber: selection.selectionStartLineNumber,
        column: selection.selectionStartColumn,
      }),
      active: activeModel.getOffsetAt({ lineNumber: selection.positionLineNumber, column: selection.positionColumn }),
    }));
    activeEditor.pushUndoStop();
    activeEditor.executeEdits('nexus-toggle-comment', edits, () =>
      offsets.map(({ anchor, active }) =>
        monaco.Selection.fromPositions(
          activeModel.getPositionAt(mapOffset(anchor, offsetEdits)),
          activeModel.getPositionAt(mapOffset(active, offsetEdits)),
        ),
      ),
    );
    activeEditor.pushUndoStop();
    return true;
  };
  const props = withDefaults(
    defineProps<{
      modelValue: string;
      path: string;
      fontSize?: number;
      fontFamily?: string;
      readOnly?: boolean;
      largeFile?: boolean;
      initialScrollTop?: number;
      initialScrollLeft?: number;
    }>(),
    { fontSize: 14, readOnly: false, largeFile: false },
  );
  const emit = defineEmits<{
    'update:modelValue': [value: string];
    requestSave: [];
    updateScrollPosition: [position: { scrollTop: number; scrollLeft: number }];
    fontSize: [size: number];
  }>();
  const root = ref<HTMLElement | null>(null);
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let model: monaco.editor.ITextModel | undefined;
  const focusEditor = (): void => editor?.focus();
  let wheelHandler: ((event: WheelEvent) => void) | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let layoutFrame: number | undefined;
  let appliedFontSize = props.fontSize;
  let suppress = false;
  const scheduleLayout = (): void => {
    if (!editor || !root.value) return;
    if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = undefined;
      const element = root.value;
      if (!editor || !element || element.clientWidth <= 0 || element.clientHeight <= 0) return;
      editor.layout({ width: element.clientWidth, height: element.clientHeight });
    });
  };
  const resolveWheelScale = createWheelScaleResolver({ min: 8, max: 40, step: 1, precision: 0, thresholdPx: 72 });
  (globalThis as typeof globalThis & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
  };
  onMounted(() => {
    model = monaco.editor.createModel(
      props.modelValue,
      props.largeFile ? 'plaintext' : undefined,
      modelUriForPath(props.path),
    );
    editor = monaco.editor.create(root.value!, {
      model,
      automaticLayout: false,
      fontSize: appliedFontSize,
      fontFamily: props.fontFamily,
      theme: 'vs-dark',
      readOnly: props.readOnly,
      wordWrap: 'on',
      wrappingIndent: 'same',
      wrappingStrategy: 'simple',
      stopRenderingLineAfter: -1,
      largeFileOptimizations: true,
      maxTokenizationLineLength: 20_000,
      minimap: { enabled: !props.largeFile },
      folding: !props.largeFile,
      wordBasedSuggestions: props.largeFile ? 'off' : 'currentDocument',
      'semanticHighlighting.enabled': !props.largeFile,
      stickyScroll: { enabled: !props.largeFile },
      bracketPairColorization: { enabled: !props.largeFile },
      scrollBeyondLastLine: false,
    });
    editor.onDidChangeModelContent(() => {
      if (!suppress) emit('update:modelValue', editor!.getValue());
    });
    editor.setScrollPosition({ scrollTop: props.initialScrollTop ?? 0, scrollLeft: props.initialScrollLeft ?? 0 });
    editor.onDidScrollChange(() => {
      if (editor)
        emit('updateScrollPosition', { scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft() });
    });
    editor.addAction({
      id: 'nexus-save-file',
      label: t('fileEditor.saveFile'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => emit('requestSave'),
    });
    editor.addAction({
      id: 'nexus-toggle-comment',
      label: t('fileEditor.toggleComment'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Slash],
      precondition: '!editorReadonly',
      run: async () => {
        if (editor) await toggleEditorComment(editor);
      },
    });
    const domNode = editor.getDomNode();
    if (domNode) {
      wheelHandler = (event: WheelEvent) => {
        if (!editor) return;
        const change = resolveWheelScale(event, appliedFontSize);
        if (!change) return;
        appliedFontSize = change.next;
        editor.updateOptions({ fontSize: appliedFontSize });
        emit('fontSize', appliedFontSize);
      };
      domNode.addEventListener('wheel', wheelHandler, { passive: false });
    }
    resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(root.value!);
    void nextTick(scheduleLayout);
  });
  watch(
    () => props.modelValue,
    (value) => {
      if (editor && editor.getValue() !== value) {
        suppress = true;
        editor.setValue(value);
        suppress = false;
      }
    },
  );
  watch(
    () => props.fontSize,
    (fontSize) => {
      if (Object.is(fontSize, appliedFontSize)) return;
      appliedFontSize = fontSize;
      editor?.updateOptions({ fontSize: appliedFontSize });
    },
  );
  watch(
    () => [props.fontFamily, props.readOnly, props.largeFile] as const,
    ([fontFamily, readOnly, largeFile]) =>
      editor?.updateOptions({
        fontFamily,
        readOnly,
        minimap: { enabled: !largeFile },
        folding: !largeFile,
        wordBasedSuggestions: largeFile ? 'off' : 'currentDocument',
        'semanticHighlighting.enabled': !largeFile,
        stickyScroll: { enabled: !largeFile },
        bracketPairColorization: { enabled: !largeFile },
      }),
  );

  onBeforeUnmount(() => {
    const domNode = editor?.getDomNode();
    if (domNode && wheelHandler) domNode.removeEventListener('wheel', wheelHandler);
    wheelHandler = undefined;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
    layoutFrame = undefined;
    editor?.dispose();
    model?.dispose();
    model = undefined;
  });
  defineExpose({
    focus: focusEditor,
    openSearch: () => editor?.getAction('actions.find')?.run(),
    toggleComment: () => (editor ? toggleEditorComment(editor) : Promise.resolve(false)),
  });
</script>

<template>
  <div
    ref="root"
    data-testid="monaco-editor"
    class="monaco-editor-container"
    :data-large-file="largeFile ? 'true' : 'false'"
    data-word-wrap="on"
    @click="focusEditor"
  ></div>
</template>

<style scoped>
  .monaco-editor-container {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    text-align: left;
  }
</style>
