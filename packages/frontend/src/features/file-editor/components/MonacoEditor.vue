<script setup lang="ts">
  import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
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
      initialScrollTop?: number;
      initialScrollLeft?: number;
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
    editor = monaco.editor.create(root.value!, {
      value: props.modelValue,
      language: props.language,
      automaticLayout: false,
      fontSize: appliedFontSize,
      fontFamily: props.fontFamily,
      theme: 'vs-dark',
      readOnly: props.readOnly,
      minimap: { enabled: true },
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
      label: 'Save File',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => emit('requestSave'),
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
    () => props.language,
    (value) => {
      const model = editor?.getModel();
      if (model) monaco.editor.setModelLanguage(model, value);
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
    () => [props.fontFamily, props.readOnly] as const,
    ([fontFamily, readOnly]) => editor?.updateOptions({ fontFamily, readOnly }),
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
  });
  defineExpose({ focus: focusEditor });
</script>

<template>
  <div ref="root" data-testid="monaco-editor" class="monaco-editor-container" @click="focusEditor"></div>
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
