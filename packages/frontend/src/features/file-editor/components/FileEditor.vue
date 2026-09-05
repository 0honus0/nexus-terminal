<script setup lang="ts">
  import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseContextMenu, BaseSpinner } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser/useDeviceCapabilities';
  import { focusRegistry } from '@/shared/focus/public';
  import { useFeedback } from '@/shared/feedback/public';
  const MonacoEditor = defineAsyncComponent({
    loader: () => import('./MonacoEditor.vue'),
    loadingComponent: BaseSpinner,
    delay: 120,
  });
  const CodeMirrorMobileEditor = defineAsyncComponent({
    loader: () => import('./CodeMirrorMobileEditor.vue'),
    loadingComponent: BaseSpinner,
    delay: 120,
  });
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
      showCloseButton?: boolean;
    }>(),
    { fontSize: 14, mobileFontSize: 16, showCloseButton: false },
  );
  const emit = defineEmits<{ fontSize: [size: number]; mobileFontSize: [size: number]; close: [] }>();
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
  const mobileEditor = ref<{ focus?: () => void; openSearch?: () => void } | null>(null);
  const desktopEditor = ref<{ focus?: () => void } | null>(null);
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
  const saveDisabled = computed(() => {
    const active = session.active.value;
    if (!active) return true;
    return (
      session.loading.value ||
      active.saveState === 'saving' ||
      Boolean(active.error) ||
      (!props.showCloseButton && !active.dirty)
    );
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
  <section ref="root" data-testid="file-editor-view" class="file-editor-container">
    <div class="file-editor-tabs" role="tablist">
      <div
        v-for="tab in session.tabs.value"
        :key="tab.id"
        class="tab-item"
        :class="{ active: session.activeId.value === tab.id }"
        :title="showScopeLabel && tab.scopeLabel ? `${tab.scopeLabel}: ${tab.path}` : tab.path"
        role="tab"
        :aria-selected="session.activeId.value === tab.id"
        tabindex="0"
        @click="session.activeId.value = tab.id"
        @keydown.enter.prevent="session.activeId.value = tab.id"
        @keydown.space.prevent="session.activeId.value = tab.id"
        @contextmenu="openContext($event, tab.id)"
      >
        <span class="tab-filename">{{ tab.name }}</span>
        <span v-if="tab.dirty" class="tab-modified-indicator">*</span>
        <button
          type="button"
          class="close-tab-btn"
          :title="t('fileManager.actions.closeTab')"
          :aria-label="t('fileManager.actions.closeTab')"
          @click.stop="session.close(tab.id)"
        >
          ×
        </button>
      </div>
      <div v-if="!session.tabs.value.length" class="no-tabs-placeholder"></div>
    </div>

    <div v-if="session.active.value" class="editor-header" :class="{ 'is-mobile': device.isMobile.value }">
      <span class="editor-path-label" :title="session.active.value.path">
        {{ t('fileManager.editingFile')
        }}<template v-if="showScopeLabel && session.active.value.scopeLabel"
          >({{ session.active.value.scopeLabel }})</template
        >: {{ session.active.value.path }}
        <span v-if="session.active.value.dirty" class="modified-indicator">*</span>
      </span>

      <div class="editor-actions">
        <select
          data-testid="file-editor-encoding"
          :value="selectedEncoding"
          class="encoding-select"
          :title="t('fileManager.changeEncodingTooltip')"
          :disabled="session.loading.value"
          @change="changeEncoding"
        >
          <option v-for="option in encodingOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
        </select>
        <select
          data-testid="file-editor-line-ending"
          :value="currentLineEnding"
          class="encoding-select line-ending-select"
          :title="t('fileEditor.lineEnding')"
          :disabled="session.loading.value"
          @change="changeLineEnding"
        >
          <option value="lf">{{ t('fileEditor.lineEndingLf') }}</option>
          <option value="crlf">{{ t('fileEditor.lineEndingCrlf') }}</option>
          <option value="cr">{{ t('fileEditor.lineEndingCr') }}</option>
        </select>

        <span v-if="session.active.value.saveState === 'saving'" class="save-status saving"
          >{{ t('fileManager.saving') }}...</span
        >
        <span v-else-if="session.active.value.saveState === 'saved'" role="status" class="save-status success"
          >✅ {{ t('fileManager.saveSuccess') }}</span
        >
        <span v-else-if="session.active.value.saveState === 'error'" role="alert" class="save-status error"
          >❌ {{ t('fileManager.saveError') }}</span
        >

        <button
          type="button"
          class="save-btn"
          :title="t('fileEditor.refreshRemote')"
          :disabled="session.loading.value || session.active.value.saveState === 'saving'"
          @click="reload"
        >
          {{ t('fileManager.actions.refresh') }}
        </button>
        <button
          v-if="device.isMobile.value"
          type="button"
          class="search-btn"
          :title="t('fileManager.preview.search')"
          :aria-label="t('fileManager.preview.search')"
          @click="mobileEditor?.openSearch?.()"
        >
          <i class="fas fa-search" aria-hidden="true"></i>
        </button>
        <button type="button" class="save-btn" :disabled="saveDisabled" @click="save">
          {{ t('fileManager.actions.save') }}
        </button>
        <button
          v-if="showCloseButton && !device.isMobile.value"
          type="button"
          class="close-editor-btn"
          :title="t('fileManager.actions.closeEditor')"
          :aria-label="t('fileManager.actions.closeEditor')"
          @click="emit('close')"
        >
          ✖
        </button>
      </div>

      <button
        v-if="showCloseButton && device.isMobile.value"
        type="button"
        class="close-editor-btn mobile-close"
        :title="t('fileManager.actions.closeEditor')"
        :aria-label="t('fileManager.actions.closeEditor')"
        @click="emit('close')"
      >
        ✖
      </button>
    </div>
    <div v-else class="editor-header editor-header-placeholder" :class="{ 'is-mobile': device.isMobile.value }">
      <span>{{ t('fileManager.noOpenFile') }}</span>
      <button
        v-if="showCloseButton"
        type="button"
        class="close-editor-btn"
        :class="{ 'mobile-close': device.isMobile.value }"
        :title="t('fileManager.actions.closeEditor')"
        :aria-label="t('fileManager.actions.closeEditor')"
        @click="emit('close')"
      >
        ✖
      </button>
    </div>

    <div class="editor-content-area">
      <BaseSpinner v-if="session.loading.value" class="m-6" />
      <template v-else-if="session.active.value">
        <CodeMirrorMobileEditor
          v-if="device.isMobile.value"
          ref="mobileEditor"
          v-model="content"
          class="editor-instance"
          :language="session.active.value.language"
          :font-size="mobileFontSize"
          :font-family="fontFamily"
          :scroll-top="session.active.value.scrollTop"
          :scroll-left="session.active.value.scrollLeft"
          @request-save="save"
          @font-size-change="emit('mobileFontSize', $event)"
          @update-scroll-position="updateScrollPosition"
        />
        <MonacoEditor
          v-else
          ref="desktopEditor"
          v-model="content"
          class="editor-instance"
          :language="session.active.value.language"
          :font-size="fontSize"
          :font-family="fontFamily"
          :scroll-top="session.active.value.scrollTop"
          :scroll-left="session.active.value.scrollLeft"
          @request-save="save"
          @font-size="emit('fontSize', $event)"
          @update-scroll-position="updateScrollPosition"
        />
      </template>
      <div v-else class="editor-placeholder">{{ t('fileManager.selectFileToEdit') }}</div>
    </div>

    <p v-if="session.active.value?.error" class="editor-error">{{ session.active.value.error }}</p>

    <BaseContextMenu :visible="Boolean(context)" :x="context?.x ?? 0" :y="context?.y ?? 0" @close="context = null">
      <button
        class="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-4 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
        role="menuitem"
        @click="contextAction('close')"
      >
        {{ t('fileEditor.contextMenu.close') }}
      </button>
      <button
        v-if="contextCanCloseOthers"
        class="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-4 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
        role="menuitem"
        @click="contextAction('others')"
      >
        {{ t('fileEditor.contextMenu.closeOthers') }}
      </button>
      <button
        v-if="contextCanCloseRight"
        class="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-4 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
        role="menuitem"
        @click="contextAction('right')"
      >
        {{ t('fileEditor.contextMenu.closeRight') }}
      </button>
      <button
        v-if="contextCanCloseLeft"
        class="mx-1 flex w-[calc(100%-0.5rem)] items-center rounded-md px-4 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-primary/10 hover:text-primary"
        role="menuitem"
        @click="contextAction('left')"
      >
        {{ t('fileEditor.contextMenu.closeLeft') }}
      </button>
    </BaseContextMenu>
  </section>
</template>

<style scoped>
  .file-editor-container {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background-color: #2d2d2d;
    color: #f0f0f0;
  }

  .file-editor-tabs {
    display: flex;
    flex-shrink: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    border-bottom: 1px solid #3f3f46;
    background-color: #252526;
    scrollbar-width: thin;
    scrollbar-color: #555 #252526;
  }
  .file-editor-tabs::-webkit-scrollbar {
    height: 4px;
  }
  .file-editor-tabs::-webkit-scrollbar-track {
    background: #252526;
  }
  .file-editor-tabs::-webkit-scrollbar-thumb {
    border-radius: 2px;
    background-color: #555;
  }
  .file-editor-tabs::-webkit-scrollbar-thumb:hover {
    background-color: #666;
  }

  .tab-item {
    position: relative;
    display: flex;
    align-items: center;
    padding: 6px 10px 6px 12px;
    cursor: pointer;
    border-right: 1px solid #3f3f46;
    background-color: #2d2d2d;
    color: #ccc;
    white-space: nowrap;
    font-size: 0.85em;
    transition: background-color 0.1s ease-in-out;
  }
  .tab-item:hover {
    background-color: #3e3e42;
  }
  .tab-item.active {
    margin-bottom: -1px;
    border-bottom: 1px solid #1e1e1e;
    background-color: #1e1e1e;
    color: #fff;
  }
  .tab-filename {
    max-width: 150px;
    overflow: hidden;
    margin-right: 4px;
    text-overflow: ellipsis;
  }
  .tab-modified-indicator {
    margin-right: 4px;
    margin-left: 2px;
    color: #ccc;
    font-weight: normal;
  }
  .tab-item.active .tab-modified-indicator {
    color: #fff;
  }
  .close-tab-btn {
    margin-left: 4px;
    padding: 0 4px;
    border: 0;
    border-radius: 3px;
    background: none;
    color: #ccc;
    font-size: 1.1em;
    line-height: 1;
    opacity: 0.6;
    transition:
      opacity 0.1s ease-in-out,
      background-color 0.1s ease-in-out;
  }
  .tab-item:hover .close-tab-btn,
  .tab-item.active .close-tab-btn {
    opacity: 1;
  }
  .close-tab-btn:hover {
    background-color: rgb(255 255 255 / 15%);
    color: #fff;
  }
  .no-tabs-placeholder {
    flex-grow: 1;
  }

  .editor-header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid #555;
    background-color: #333;
    font-size: 0.9em;
  }
  .editor-header.is-mobile {
    position: relative;
    flex-direction: column;
    align-items: flex-start;
    padding: 1.5rem 2.5rem 0.5rem 1rem;
  }
  .editor-header-placeholder {
    color: #888;
  }
  .editor-path-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-header.is-mobile .editor-path-label {
    width: 100%;
  }
  .modified-indicator {
    margin-left: 4px;
    color: #ffeb3b;
    font-weight: bold;
  }

  .editor-actions {
    display: flex;
    align-items: center;
    gap: 0.8rem;
  }
  .editor-header.is-mobile .editor-actions {
    width: 100%;
    max-width: 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
    margin-top: 1rem;
  }

  .encoding-select {
    width: auto;
    max-width: 12rem;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    border: 1px solid #666;
    border-radius: 3px;
    outline: none;
    background-color: #444;
    color: #f0f0f0;
    font-size: 0.85em;
  }
  .encoding-select:hover {
    background-color: #555;
  }
  .encoding-select:focus {
    border-color: #888;
  }
  .line-ending-select {
    max-width: 5.5rem;
  }

  .save-btn {
    padding: 0.4rem 0.8rem;
    cursor: pointer;
    border: 0;
    border-radius: 3px;
    background-color: #4caf50;
    color: #fff;
    font-size: 0.9em;
  }
  .save-btn:disabled {
    cursor: not-allowed;
    background-color: #aaa;
  }
  .save-btn:hover:not(:disabled) {
    background-color: #45a049;
  }
  .search-btn {
    display: flex;
    width: 1.75rem;
    height: 1.75rem;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    border: 0;
    border-radius: 0.25rem;
    background-color: transparent;
    color: #ccc;
    transition:
      background-color 0.2s,
      color 0.2s;
  }
  .search-btn:hover {
    background-color: rgb(0 0 0 / 10%);
    color: #f0f0f0;
  }
  .search-btn i {
    font-size: 1rem;
    line-height: 1;
  }
  .save-status {
    padding: 0.2rem 0.5rem;
    border-radius: 3px;
    font-size: 0.9em;
    white-space: nowrap;
  }
  .save-status.saving {
    color: #888;
  }
  .save-status.success {
    background-color: #e8f5e9;
    color: #4caf50;
  }
  .save-status.error {
    background-color: #ffebee;
    color: #f44336;
  }
  .close-editor-btn {
    padding: 0.2rem 0.5rem;
    cursor: pointer;
    border: 0;
    background: none;
    color: #ccc;
    font-size: 1.2em;
  }
  .close-editor-btn:hover {
    color: #fff;
  }
  .mobile-close {
    position: absolute;
    top: 1.5rem;
    right: 1rem;
    z-index: 10;
  }

  .editor-content-area {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
    flex-direction: column;
    overflow: hidden;
  }
  .editor-instance {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1 1 auto;
  }
  .editor-placeholder,
  .editor-error {
    display: flex;
    flex-grow: 1;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
    font-size: 1.1em;
  }
  .editor-placeholder {
    color: #666;
  }
  .editor-error {
    color: #ff8a8a;
  }
</style>
