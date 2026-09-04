<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseContextMenu, BaseSelect, BaseSpinner } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser/useDeviceCapabilities';
  import { focusRegistry } from '@/shared/focus/public';
  import { useFeedback } from '@/shared/feedback/public';
  import MonacoEditor from './MonacoEditor.vue';
  import CodeMirrorMobileEditor from './CodeMirrorMobileEditor.vue';
  import { createFileEditorSession, type FileEditorSessionController } from '../composables/useFileEditorSession';
  import type { FileDocumentPort } from '../ports/file-document-port';
  import type { EditorLineEnding } from '../model/editor';

  const encodingOptions = [
    ['utf-8', 'UTF-8'],
    ['utf-16le', 'UTF-16 LE'],
    ['utf-16be', 'UTF-16 BE'],
    ['gbk', 'GBK'],
    ['gb18030', 'GB18030'],
    ['big5', 'Big5'],
    ['shift_jis', 'Shift-JIS'],
    ['euc-jp', 'EUC-JP'],
    ['euc-kr', 'EUC-KR'],
    ['iso-8859-1', 'ISO-8859-1'],
    ['iso-8859-15', 'ISO-8859-15'],
    ['cp1252', 'Windows-1252'],
    ['iso-8859-2', 'ISO-8859-2'],
    ['cp1250', 'Windows-1250'],
    ['iso-8859-5', 'ISO-8859-5'],
    ['cp1251', 'Windows-1251'],
    ['koi8-r', 'KOI8-R'],
    ['koi8-u', 'KOI8-U'],
    ['iso-8859-7', 'ISO-8859-7'],
    ['cp1253', 'Windows-1253'],
    ['iso-8859-9', 'ISO-8859-9'],
    ['cp1254', 'Windows-1254'],
    ['iso-8859-8', 'ISO-8859-8'],
    ['cp1255', 'Windows-1255'],
    ['iso-8859-6', 'ISO-8859-6'],
    ['cp1256', 'Windows-1256'],
    ['iso-8859-4', 'ISO-8859-4'],
    ['iso-8859-13', 'ISO-8859-13'],
    ['cp1257', 'Windows-1257'],
    ['cp1258', 'Windows-1258'],
    ['tis-620', 'TIS-620'],
    ['cp874', 'Windows-874'],
  ] as const;

  const props = withDefaults(
    defineProps<{
      port: FileDocumentPort;
      scopeId?: string;
      scopeLabel?: string;
      showScopeLabel?: boolean;
      session?: FileEditorSessionController;
      fontSize?: number;
      mobileFontSize?: number;
      fontFamily?: string;
    }>(),
    { fontSize: 14, mobileFontSize: 16 },
  );
  const emit = defineEmits<{ fontSize: [size: number]; mobileFontSize: [size: number] }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const device = useDeviceCapabilities();
  let localSession: FileEditorSessionController | undefined;
  const resolveSession = (): FileEditorSessionController =>
    props.session ?? (localSession ??= createFileEditorSession(props.port));
  const session = new Proxy({} as FileEditorSessionController, {
    get(_target, property) {
      return Reflect.get(resolveSession(), property);
    },
  });
  const root = ref<HTMLElement | null>(null);
  const mobileEditor = ref<InstanceType<typeof CodeMirrorMobileEditor> | null>(null);
  const desktopEditor = ref<InstanceType<typeof MonacoEditor> | null>(null);
  const context = ref<{ id: string; x: number; y: number } | null>(null);
  let unregisterFocus: (() => void) | undefined;

  const content = computed({ get: () => session.active.value?.content ?? '', set: (value) => session.update(value) });
  const selectedEncoding = computed(() => session.active.value?.encoding ?? 'utf-8');
  const currentLineEnding = computed<EditorLineEnding>(() => {
    const value = session.active.value?.content ?? '';
    if (value.includes('\r\n')) return 'crlf';
    if (value.includes('\r')) return 'cr';
    return 'lf';
  });
  const contextIndex = computed(() =>
    context.value ? session.tabs.value.findIndex((tab) => tab.id === context.value!.id) : -1,
  );
  const contextCanCloseOthers = computed(() => contextIndex.value >= 0 && session.tabs.value.length > 1);
  const contextCanCloseRight = computed(
    () => contextIndex.value >= 0 && contextIndex.value < session.tabs.value.length - 1,
  );
  const contextCanCloseLeft = computed(() => contextIndex.value > 0);

  const save = () => session.save();

  const confirmDiscardIfDirty = async (): Promise<boolean> => {
    if (!session.active.value?.dirty) return true;
    return feedback.confirm({ message: t('fileEditor.confirmDiscardChanges') });
  };
  const reload = async (): Promise<void> => {
    const active = session.active.value;
    if (!active || !(await confirmDiscardIfDirty())) return;
    await session.reload(active.id);
  };
  const changeEncoding = async (event: Event): Promise<void> => {
    const active = session.active.value;
    const encoding = (event.target as HTMLSelectElement).value;
    if (!active || !encoding || encoding === active.encoding) return;
    if (!(await confirmDiscardIfDirty())) {
      (event.target as HTMLSelectElement).value = active.encoding;
      return;
    }
    await session.changeEncoding(active.id, encoding);
  };
  const changeLineEnding = (event: Event): void => {
    const active = session.active.value;
    if (!active) return;
    session.changeLineEnding(active.id, (event.target as HTMLSelectElement).value as EditorLineEnding);
  };
  const updateScrollPosition = (position: { scrollTop: number; scrollLeft: number }): void => {
    const active = session.active.value;
    if (active) session.updateScrollPosition(active.id, position.scrollTop, position.scrollLeft);
  };

  const open = (path: string) =>
    session.open(path, { scopeId: props.scopeId, scopeLabel: props.scopeLabel, port: props.port });
  const openContext = (event: MouseEvent, id: string) => {
    event.preventDefault();
    context.value = { id, x: event.clientX, y: event.clientY };
  };
  const contextAction = (action: 'close' | 'others' | 'right' | 'left') => {
    const id = context.value?.id;
    context.value = null;
    if (!id) return;
    if (action === 'close') session.close(id);
    else if (action === 'others') session.closeOthers(id);
    else if (action === 'right') session.closeToRight(id);
    else session.closeToLeft(id);
  };
  const handleEditorKeydown = (event: KeyboardEvent) => {
    if (!root.value?.getClientRects().length || !event.altKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (session.tabs.value.length <= 1) return;
    event.preventDefault();
    event.stopPropagation();
    session.activateRelative(event.key === 'ArrowLeft' ? -1 : 1);
  };

  onMounted(() => {
    unregisterFocus = focusRegistry.register(
      'fileEditorActive',
      () => {
        if (!session.active.value) return false;
        if (device.isMobile.value) mobileEditor.value?.focus?.();
        else desktopEditor.value?.focus?.();
        return true;
      },
      () => Boolean(root.value?.getClientRects().length && session.active.value),
    );
    window.addEventListener('keydown', handleEditorKeydown, true);
  });
  onBeforeUnmount(() => {
    unregisterFocus?.();
    window.removeEventListener('keydown', handleEditorKeydown, true);
  });
  defineExpose({
    open,
    save,
    close: (id: string) => session.close(id),
    focus: () => (device.isMobile.value ? mobileEditor.value?.focus?.() : desktopEditor.value?.focus?.()),
  });
</script>
<template>
  <section ref="root" data-testid="file-editor-view" class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex min-w-0 items-center border-b border-border bg-header/40">
      <div class="flex min-w-0 flex-1 overflow-x-auto">
        <button
          v-for="tab in session.tabs.value"
          :key="tab.id"
          type="button"
          class="flex min-w-0 max-w-56 shrink-0 items-center gap-2 border-r border-border px-3 py-2 text-sm"
          :class="session.activeId.value === tab.id ? 'bg-background text-foreground' : 'text-text-secondary'"
          :title="showScopeLabel && tab.scopeLabel ? `${tab.scopeLabel}: ${tab.path}` : tab.path"
          @click="session.activeId.value = tab.id"
          @contextmenu="openContext($event, tab.id)"
        >
          <span class="truncate">{{ tab.name }}</span
          ><span v-if="tab.dirty" class="text-warning">●</span
          ><span class="ml-1" @click.stop="session.close(tab.id)">×</span>
        </button>
      </div>
      <div class="ml-auto flex shrink-0 items-center gap-1 px-2">
        <span
          v-if="showScopeLabel && session.active.value?.scopeLabel"
          class="max-w-40 truncate text-xs text-text-secondary"
          :title="session.active.value.scopeLabel"
        >
          {{ session.active.value.scopeLabel }}
        </span>
        <BaseSelect
          v-if="session.active.value"
          :model-value="selectedEncoding"
          class="max-w-36 py-1"
          :title="t('fileEditor.encoding')"
          :disabled="session.loading.value"
          @change="changeEncoding"
        >
          <option v-for="option in encodingOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
        </BaseSelect>
        <BaseSelect
          v-if="session.active.value"
          :model-value="currentLineEnding"
          class="max-w-24 py-1"
          :title="t('fileEditor.lineEnding')"
          :disabled="session.loading.value"
          @change="changeLineEnding"
        >
          <option value="lf">{{ t('fileEditor.lineEndingLf') }}</option>
          <option value="crlf">{{ t('fileEditor.lineEndingCrlf') }}</option>
          <option value="cr">{{ t('fileEditor.lineEndingCr') }}</option>
        </BaseSelect>
        <BaseButton
          v-if="session.active.value"
          size="sm"
          variant="ghost"
          :title="t('fileEditor.refreshRemote')"
          :disabled="session.loading.value || session.active.value.saveState === 'saving'"
          @click="reload"
          >↻</BaseButton
        >
        <BaseButton
          v-if="device.isMobile.value && session.active.value"
          size="sm"
          variant="ghost"
          :title="t('fileManager.preview.search')"
          @click="mobileEditor?.openSearch?.()"
          >⌕</BaseButton
        ><BaseButton size="sm" :disabled="!session.active.value || !session.active.value.dirty" @click="save">{{
          session.active.value?.saveState === 'saving' ? t('fileManager.saving') : t('common.save')
        }}</BaseButton>
      </div>
    </div>
    <BaseSpinner v-if="session.loading.value" class="m-6" />
    <div v-else-if="session.active.value" class="min-h-0 flex-1">
      <CodeMirrorMobileEditor
        v-if="device.isMobile.value"
        ref="mobileEditor"
        v-model="content"
        :language="session.active.value.language"
        :font-size="mobileFontSize"
        :font-family="fontFamily"
        :scroll-top="session.active.value.scrollTop"
        :scroll-left="session.active.value.scrollLeft"
        @request-save="save"
        @font-size-change="emit('mobileFontSize', $event)"
        @update-scroll-position="updateScrollPosition"
      /><MonacoEditor
        v-else
        ref="desktopEditor"
        v-model="content"
        :language="session.active.value.language"
        :font-size="fontSize"
        :font-family="fontFamily"
        :scroll-top="session.active.value.scrollTop"
        :scroll-left="session.active.value.scrollLeft"
        @request-save="save"
        @font-size="emit('fontSize', $event)"
        @update-scroll-position="updateScrollPosition"
      />
    </div>
    <div v-else class="grid flex-1 place-items-center text-sm text-text-secondary">
      {{ t('fileManager.selectFileToEdit') }}
    </div>
    <p v-if="session.active.value?.error" class="border-t border-border p-2 text-sm text-error">
      {{ session.active.value.error }}
    </p>
    <BaseContextMenu :visible="Boolean(context)" :x="context?.x ?? 0" :y="context?.y ?? 0" @close="context = null">
      <button
        class="block w-full rounded px-3 py-2 text-left hover:bg-header"
        role="menuitem"
        @click="contextAction('close')"
      >
        {{ t('fileEditor.contextMenu.close') }}
      </button>
      <button
        v-if="contextCanCloseOthers"
        class="block w-full rounded px-3 py-2 text-left hover:bg-header"
        role="menuitem"
        @click="contextAction('others')"
      >
        {{ t('fileEditor.contextMenu.closeOthers') }}
      </button>
      <button
        v-if="contextCanCloseRight"
        class="block w-full rounded px-3 py-2 text-left hover:bg-header"
        role="menuitem"
        @click="contextAction('right')"
      >
        {{ t('fileEditor.contextMenu.closeRight') }}
      </button>
      <button
        v-if="contextCanCloseLeft"
        class="block w-full rounded px-3 py-2 text-left hover:bg-header"
        role="menuitem"
        @click="contextAction('left')"
      >
        {{ t('fileEditor.contextMenu.closeLeft') }}
      </button>
    </BaseContextMenu>
  </section>
</template>
