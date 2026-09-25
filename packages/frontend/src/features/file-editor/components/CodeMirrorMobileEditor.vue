<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { Compartment, EditorState, type ChangeSpec, type Extension } from '@codemirror/state';
  import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap, toggleComment } from '@codemirror/commands';
  import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    syntaxHighlighting,
    LanguageDescription,
  } from '@codemirror/language';
  import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
  import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
  import { vscodeDark } from '@uiw/codemirror-theme-vscode';
  import { languages } from '@codemirror/language-data';

  interface CommentTokens {
    line?: string;
    block?: { open: string; close: string };
  }

  interface SelectedLine {
    from: number;
    text: string;
    indent: number;
    token: string;
    commented: boolean;
  }

  const commentMetadataFallbacks: Readonly<Record<string, CommentTokens>> = {
    JSON: { line: '//', block: { open: '/*', close: '*/' } },
    JSONC: { line: '//', block: { open: '/*', close: '*/' } },
    Vue: { block: { open: '<!--', close: '-->' } },
    'Properties files': { line: '#' },
    ProtoBuf: { line: '//', block: { open: '/*', close: '*/' } },
  };

  const languageDescriptions = [
    LanguageDescription.of({
      name: 'JSONC',
      alias: ['jsonc'],
      extensions: ['jsonc'],
      load: async () => {
        const { json } = await import('@codemirror/lang-json');
        return json();
      },
    }),
    LanguageDescription.of({
      name: 'Svelte',
      alias: ['svelte'],
      extensions: ['svelte'],
      load: async () => {
        const { html } = await import('@codemirror/lang-html');
        return html();
      },
    }),
    ...languages,
  ];

  const filenameFor = (path: string): string => path.split(/[\\/]/).pop() || path;

  const loadLanguageExtension = async (path: string): Promise<Extension> => {
    const description = LanguageDescription.matchFilename(languageDescriptions, filenameFor(path));
    if (!description) return [];
    const support =
      description.name === 'Markdown'
        ? await import('@codemirror/lang-markdown').then(({ markdown }) =>
            markdown({ codeLanguages: languageDescriptions }),
          )
        : await description.load();
    const commentTokens = commentMetadataFallbacks[description.name];
    const fallback = commentTokens ? EditorState.languageData.of(() => [{ commentTokens }]) : [];
    return [support, fallback];
  };

  const commentTokensAt = (state: EditorState, position: number): CommentTokens =>
    (state.languageDataAt('commentTokens', position, 1)[0] as CommentTokens | undefined) ?? {};

  const selectedCommentLines = (state: EditorState): SelectedLine[] | null => {
    const selected = new Map<number, SelectedLine>();
    for (const range of state.selection.ranges) {
      let end = range.to;
      if (end > range.from && state.doc.lineAt(end).from === end) end -= 1;
      const first = state.doc.lineAt(range.from);
      const last = state.doc.lineAt(end);
      for (let number = first.number; number <= last.number; number += 1) {
        const line = state.doc.line(number);
        if (selected.has(line.from)) continue;
        const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
        if (indent >= line.text.length) continue;
        const token = commentTokensAt(state, line.from + indent).line;
        if (!token) return null;
        selected.set(line.from, {
          from: line.from,
          text: line.text,
          indent,
          token,
          commented: line.text.startsWith(token, indent),
        });
      }
    }
    return [...selected.values()];
  };

  type CommentTarget = Pick<EditorView, 'state' | 'dispatch'>;

  const toggleEditorComment = (target: CommentTarget): boolean => {
    if (target.state.readOnly) return false;
    const lines = selectedCommentLines(target.state);
    if (lines === null) return toggleComment(target);
    if (lines.length === 0) return false;

    const remove = lines.every((line) => line.commented);
    const changes: ChangeSpec[] = [];
    for (const line of lines) {
      if (remove) {
        let to = line.from + line.indent + line.token.length;
        if (line.text[line.indent + line.token.length] === ' ') to += 1;
        changes.push({ from: line.from + line.indent, to });
      } else if (!line.commented) {
        changes.push({ from: line.from + line.indent, insert: `${line.token} ` });
      }
    }
    if (changes.length === 0) return false;
    const changeSet = target.state.changes(changes);
    target.dispatch({
      changes: changeSet,
      selection: target.state.selection.map(changeSet, 1),
      userEvent: 'input',
    });
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
      scrollTop?: number;
      scrollLeft?: number;
    }>(),
    {
      fontSize: 16,
      readOnly: false,
      largeFile: false,
    },
  );
  const emit = defineEmits<{
    'update:modelValue': [value: string];
    requestSave: [];
    fontSizeChange: [size: number];
    updateScrollPosition: [position: { scrollTop: number; scrollLeft: number }];
  }>();

  const root = ref<HTMLElement | null>(null);
  const languageCompartment = new Compartment();
  const presentationCompartment = new Compartment();
  const editableCompartment = new Compartment();
  let view: EditorView | undefined;
  let mounted = false;
  let syncing = false;
  let syncingScroll = false;
  let languageGeneration = 0;
  let pinchStartDistance = 0;
  let pinchStartFontSize = props.fontSize;

  const presentationExtension = (): Extension =>
    EditorView.theme({
      '&': {
        fontSize: `${props.fontSize}px`,
        ...(props.fontFamily ? { fontFamily: props.fontFamily } : {}),
      },
      '.cm-scroller': { overflow: 'auto' },
    });

  const handleScroll = () => {
    if (!view || syncingScroll) return;
    emit('updateScrollPosition', { scrollTop: view.scrollDOM.scrollTop, scrollLeft: view.scrollDOM.scrollLeft });
  };

  const distance = (touches: TouchList): number => {
    if (touches.length < 2) return 0;
    const first = touches[0]!;
    const second = touches[1]!;
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  };
  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 2) return;
    pinchStartDistance = distance(event.touches);
    pinchStartFontSize = props.fontSize;
    event.preventDefault();
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 2 || pinchStartDistance <= 0) return;
    const nextDistance = distance(event.touches);
    const nextSize = Math.max(
      8,
      Math.min(40, Math.round(pinchStartFontSize * (nextDistance / pinchStartDistance) * 10) / 10),
    );
    if (Math.abs(nextSize - props.fontSize) >= 0.1) emit('fontSizeChange', nextSize);
    event.preventDefault();
  };
  const handleTouchEnd = () => {
    pinchStartDistance = 0;
  };

  onMounted(async () => {
    mounted = true;
    const initialPath = props.path;
    const initialLanguage = props.largeFile ? [] : await loadLanguageExtension(initialPath);
    if (!mounted || !root.value) return;
    view = new EditorView({
      state: EditorState.create({
        doc: props.modelValue,
        extensions: [
          languageCompartment.of(initialLanguage),
          presentationCompartment.of(presentationExtension()),
          editableCompartment.of(EditorView.editable.of(!props.readOnly)),
          vscodeDark,
          lineNumbers(),
          EditorView.lineWrapping,
          ...(props.largeFile ? [] : [foldGutter()]),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          history(),
          ...(props.largeFile
            ? []
            : [
                indentOnInput(),
                bracketMatching(),
                highlightActiveLine(),
                closeBrackets(),
                autocompletion(),
                highlightSelectionMatches(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
              ]),
          search(),
          keymap.of([
            ...closeBracketsKeymap,
            { key: 'Mod-/', run: toggleEditorComment },
            ...defaultKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...searchKeymap,
            {
              key: 'Mod-s',
              run: () => {
                emit('requestSave');
                return true;
              },
            },
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing) emit('update:modelValue', update.state.doc.toString());
          }),
        ],
      }),
      parent: root.value!,
    });
    view.scrollDOM.scrollTop = props.scrollTop ?? 0;
    view.scrollDOM.scrollLeft = props.scrollLeft ?? 0;
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });
    root.value?.addEventListener('touchstart', handleTouchStart, { passive: false });
    root.value?.addEventListener('touchmove', handleTouchMove, { passive: false });
    root.value?.addEventListener('touchend', handleTouchEnd, { passive: true });
    root.value?.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    if (props.path !== initialPath) {
      const generation = ++languageGeneration;
      const extension = props.largeFile ? [] : await loadLanguageExtension(props.path);
      if (!view || generation !== languageGeneration) return;
      view.dispatch({ effects: languageCompartment.reconfigure(extension) });
    }
  });

  watch(
    () => props.modelValue,
    (value) => {
      if (!view || view.state.doc.toString() === value) return;
      syncing = true;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
      syncing = false;
    },
  );
  watch(
    () => props.path,
    async (path) => {
      if (!view) return;
      const generation = ++languageGeneration;
      const extension = props.largeFile ? [] : await loadLanguageExtension(path);
      if (!view || generation !== languageGeneration) return;
      view.dispatch({ effects: languageCompartment.reconfigure(extension) });
    },
  );
  watch(
    () => [props.fontSize, props.fontFamily] as const,
    () => view?.dispatch({ effects: presentationCompartment.reconfigure(presentationExtension()) }),
  );
  watch(
    () => props.readOnly,
    (readOnly) => view?.dispatch({ effects: editableCompartment.reconfigure(EditorView.editable.of(!readOnly)) }),
  );
  watch(
    () => [props.scrollTop ?? 0, props.scrollLeft ?? 0] as const,
    ([scrollTop, scrollLeft]) => {
      if (!view) return;
      if (Math.abs(view.scrollDOM.scrollTop - scrollTop) < 1 && Math.abs(view.scrollDOM.scrollLeft - scrollLeft) < 1)
        return;
      syncingScroll = true;
      view.scrollDOM.scrollTop = scrollTop;
      view.scrollDOM.scrollLeft = scrollLeft;
      syncingScroll = false;
    },
  );

  onBeforeUnmount(() => {
    mounted = false;
    languageGeneration += 1;
    view?.scrollDOM.removeEventListener('scroll', handleScroll);
    root.value?.removeEventListener('touchstart', handleTouchStart);
    root.value?.removeEventListener('touchmove', handleTouchMove);
    root.value?.removeEventListener('touchend', handleTouchEnd);
    root.value?.removeEventListener('touchcancel', handleTouchEnd);
    view?.destroy();
    view = undefined;
  });

  defineExpose({
    focus: () => view?.focus(),
    openSearch: () => {
      if (view) openSearchPanel(view);
    },
    toggleComment: () => (view ? toggleEditorComment(view) : false),
  });
</script>

<template>
  <div
    ref="root"
    class="codemirror-mobile-editor-container"
    :data-large-file="largeFile ? 'true' : 'false'"
    data-word-wrap="on"
  ></div>
</template>

<style scoped>
  .codemirror-mobile-editor-container {
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    background-color: #1e1e1e;
    text-align: left;
  }

  .codemirror-mobile-editor-container :deep(.cm-editor) {
    width: 100%;
    height: 100%;
    min-height: 100%;
    background-color: #1e1e1e;
  }

  .codemirror-mobile-editor-container :deep(.cm-scroller) {
    height: 100%;
    min-height: 0;
  }

  .codemirror-mobile-editor-container :deep(.cm-content) {
    min-height: 100%;
  }

  .codemirror-mobile-editor-container :deep(.cm-gutters) {
    border-right: 1px solid var(--border-color, #cccccc) !important;
    background-color: #1e1e1e !important;
    color: #858585 !important;
  }

  .codemirror-mobile-editor-container :deep(.cm-selectionBackground) {
    background-color: #5264ac !important;
  }
</style>
