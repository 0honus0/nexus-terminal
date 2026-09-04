<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import * as monaco from 'monaco-editor/editor/editor.api';
  import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
  import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
  import 'monaco-editor/basic-languages/monaco.contribution';
  import 'monaco-editor/language/json/monaco.contribution';
  import { createWheelScaleResolver } from '@/foundation/interaction';
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
    { language: 'plaintext', fontSize: 14, readOnly: false },
  );
  const emit = defineEmits<{
    'update:modelValue': [value: string];
    requestSave: [];
    updateScrollPosition: [position: { scrollTop: number; scrollLeft: number }];
    fontSize: [size: number];
  }>();
  const root = ref<HTMLElement | null>(null);
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let wheelHandler: ((event: WheelEvent) => void) | undefined;
  let suppress = false;
  let suppressScroll = false;
  const resolveWheelScale = createWheelScaleResolver({ min: 8, max: 40, step: 1, precision: 0, thresholdPx: 72 });
  (globalThis as typeof globalThis & { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: (_workerId: string, label: string) => (label === 'json' ? new JsonWorker() : new EditorWorker()),
  };
  onMounted(() => {
    editor = monaco.editor.create(root.value!, {
      value: props.modelValue,
      language: props.language,
      automaticLayout: true,
      fontSize: props.fontSize,
      fontFamily: props.fontFamily,
      theme: 'vs-dark',
      readOnly: props.readOnly,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
    });
    editor.onDidChangeModelContent(() => {
      if (!suppress) emit('update:modelValue', editor!.getValue());
    });
    editor.setScrollPosition({ scrollTop: props.scrollTop ?? 0, scrollLeft: props.scrollLeft ?? 0 });
    editor.onDidScrollChange(() => {
      if (!suppressScroll && editor) {
        emit('updateScrollPosition', { scrollTop: editor.getScrollTop(), scrollLeft: editor.getScrollLeft() });
      }
    });
    editor.addAction({
      id: 'nexus-save-file',
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => emit('requestSave'),
    });
    const domNode = editor.getDomNode();
    if (domNode) {
      wheelHandler = (event: WheelEvent) => {
        if (!editor) return;
        const change = resolveWheelScale(event, editor.getOption(monaco.editor.EditorOption.fontSize));
        if (!change) return;
        editor.updateOptions({ fontSize: change.next });
        emit('fontSize', change.next);
      };
      domNode.addEventListener('wheel', wheelHandler, { passive: false });
    }
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
    () => props.language,
    (value) => {
      const model = editor?.getModel();
      if (model) monaco.editor.setModelLanguage(model, value);
    },
  );
  watch(
    () => [props.fontSize, props.fontFamily, props.readOnly] as const,
    () => editor?.updateOptions({ fontSize: props.fontSize, fontFamily: props.fontFamily, readOnly: props.readOnly }),
  );

  watch(
    () => [props.scrollTop ?? 0, props.scrollLeft ?? 0] as const,
    ([scrollTop, scrollLeft]) => {
      if (!editor) return;
      if (Math.abs(editor.getScrollTop() - scrollTop) < 1 && Math.abs(editor.getScrollLeft() - scrollLeft) < 1) return;
      suppressScroll = true;
      editor.setScrollPosition({ scrollTop, scrollLeft });
      suppressScroll = false;
    },
  );
  onBeforeUnmount(() => {
    const domNode = editor?.getDomNode();
    if (domNode && wheelHandler) domNode.removeEventListener('wheel', wheelHandler);
    wheelHandler = undefined;
    editor?.dispose();
  });
  defineExpose({ focus: () => editor?.focus() });
</script>
<template><div ref="root" class="h-full min-h-[12rem] w-full"></div></template>
