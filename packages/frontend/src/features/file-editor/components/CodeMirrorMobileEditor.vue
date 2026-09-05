<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { Compartment, EditorState, type Extension } from '@codemirror/state';
  import { EditorView, drawSelection, dropCursor, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import {
    bracketMatching,
    defaultHighlightStyle,
    foldGutter,
    foldKeymap,
    indentOnInput,
    StreamLanguage,
    syntaxHighlighting,
  } from '@codemirror/language';
  import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
  import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search';
  import { vscodeDark } from '@uiw/codemirror-theme-vscode';

  const props = withDefaults(
    defineProps<{
      modelValue: string;
      language?: string;
      fontSize?: number;
      fontFamily?: string;
      readOnly?: boolean;
      scrollTop?: number;
      scrollLeft?: number;
    }>(),
    {
      language: 'plaintext',
      fontSize: 16,
      readOnly: false,
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
  let syncing = false;
  let syncingScroll = false;
  let languageGeneration = 0;
  let pinchStartDistance = 0;
  let pinchStartFontSize = props.fontSize;

  const presentationExtension = (): Extension =>
    EditorView.theme({
      '&': {
        height: '100%',
        fontSize: `${props.fontSize}px`,
        ...(props.fontFamily ? { fontFamily: props.fontFamily } : {}),
      },
      '.cm-scroller': { overflow: 'auto' },
    });

  const languageExtension = async (language: string): Promise<Extension> => {
    switch (language) {
      case 'javascript': {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript();
      }
      case 'typescript': {
        const { javascript } = await import('@codemirror/lang-javascript');
        return javascript({ typescript: true, jsx: true });
      }
      case 'json': {
        const { json } = await import('@codemirror/lang-json');
        return json();
      }
      case 'css': {
        const { css } = await import('@codemirror/lang-css');
        return css();
      }
      case 'scss': {
        const { sCSS } = await import('@codemirror/legacy-modes/mode/css');
        return StreamLanguage.define(sCSS);
      }
      case 'less': {
        const { less } = await import('@codemirror/legacy-modes/mode/css');
        return StreamLanguage.define(less);
      }
      case 'html': {
        const { html } = await import('@codemirror/lang-html');
        return html();
      }
      case 'markdown': {
        const { markdown } = await import('@codemirror/lang-markdown');
        return markdown();
      }
      case 'python': {
        const { python } = await import('@codemirror/lang-python');
        return python();
      }
      case 'java': {
        const { java } = await import('@codemirror/lang-java');
        return java();
      }
      case 'c':
      case 'cpp': {
        const { cpp } = await import('@codemirror/lang-cpp');
        return cpp();
      }
      case 'csharp': {
        const { csharp } = await import('@codemirror/legacy-modes/mode/clike');
        return StreamLanguage.define(csharp);
      }
      case 'go': {
        const { go } = await import('@codemirror/lang-go');
        return go();
      }
      case 'php': {
        const { php } = await import('@codemirror/lang-php');
        return php();
      }
      case 'ruby': {
        const { ruby } = await import('@codemirror/legacy-modes/mode/ruby');
        return StreamLanguage.define(ruby);
      }
      case 'rust': {
        const { rust } = await import('@codemirror/lang-rust');
        return rust();
      }
      case 'sql': {
        const { sql } = await import('@codemirror/lang-sql');
        return sql();
      }
      case 'shell':
      case 'bat': {
        const { shell } = await import('@codemirror/legacy-modes/mode/shell');
        return StreamLanguage.define(shell);
      }
      case 'yaml': {
        const { yaml } = await import('@codemirror/lang-yaml');
        return yaml();
      }
      case 'xml': {
        const { xml } = await import('@codemirror/lang-xml');
        return xml();
      }
      case 'ini': {
        const { properties } = await import('@codemirror/legacy-modes/mode/properties');
        return StreamLanguage.define(properties);
      }
      case 'dockerfile': {
        const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
        return StreamLanguage.define(dockerFile);
      }
      default:
        return [];
    }
  };

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
    const initialLanguage = await languageExtension(props.language);
    view = new EditorView({
      state: EditorState.create({
        doc: props.modelValue,
        extensions: [
          languageCompartment.of(initialLanguage),
          presentationCompartment.of(presentationExtension()),
          editableCompartment.of(EditorView.editable.of(!props.readOnly)),
          vscodeDark,
          lineNumbers(),
          foldGutter(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          history(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          closeBrackets(),
          autocompletion(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([
            ...closeBracketsKeymap,
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
    () => props.language,
    async (language) => {
      if (!view) return;
      const generation = ++languageGeneration;
      const extension = await languageExtension(language);
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
    view?.scrollDOM.removeEventListener('scroll', handleScroll);
    root.value?.removeEventListener('touchstart', handleTouchStart);
    root.value?.removeEventListener('touchmove', handleTouchMove);
    root.value?.removeEventListener('touchend', handleTouchEnd);
    root.value?.removeEventListener('touchcancel', handleTouchEnd);
    view?.destroy();
  });

  defineExpose({
    focus: () => view?.focus(),
    openSearch: () => {
      if (view) openSearchPanel(view);
    },
  });
</script>

<template>
  <div ref="root" class="codemirror-mobile-editor-container"></div>
</template>

<style scoped>
  .codemirror-mobile-editor-container {
    width: 100%;
    height: 100%;
    min-height: 200px;
    overflow: auto;
    text-align: left;
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
