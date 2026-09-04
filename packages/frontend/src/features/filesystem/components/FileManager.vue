<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import {
    BaseButton,
    BaseContextMenu,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSpinner,
    BaseTable,
  } from '@/foundation/ui';
  import { useDeviceCapabilities } from '@/foundation/browser/useDeviceCapabilities';
  import { writeClipboardText } from '@/foundation/browser';
  import { createWheelScaleResolver, useLongPressGesture } from '@/foundation/interaction';
  import { useFeedback } from '@/shared/feedback/public';
  import { focusRegistry } from '@/shared/focus/public';
  import FilesystemCatalogModal from './FilesystemCatalogModal.vue';
  import PathHistoryDropdown from './PathHistoryDropdown.vue';
  import { type FilesystemSortKey } from '../composables/useFilesystemBrowser';
  import {
    createFilesystemSessionState,
    type FilesystemSessionState,
  } from '../composables/createFilesystemSessionState';
  import { useFilesystemCatalog } from '../composables/useFilesystemCatalog';
  import { collectDroppedLocalFiles } from '../composables/collectDroppedLocalFiles';
  import type { FilesystemChannel, FilesystemDownloadPort, TerminalDirectoryPort } from '../ports/filesystem-channel';
  import type {
    ArchiveCompressionFormat,
    ArchiveCompressionIntent,
    LocalUploadFile,
    RemoteFileEntry,
  } from '../model/filesystem';

  const props = withDefaults(
    defineProps<{
      channel: FilesystemChannel;
      download?: FilesystemDownloadPort;
      terminalDirectory?: TerminalDirectoryPort;
      initialPath?: string;
      confirmDelete?: boolean;
      rowScale?: number;
      columnWidths?: Record<string, number>;
      clipboardCount?: number;
      state?: FilesystemSessionState;
    }>(),
    { confirmDelete: true, rowScale: 1 },
  );
  const emit = defineEmits<{
    openFile: [entry: RemoteFileEntry];
    openAsText: [entry: RemoteFileEntry];
    upload: [path: string];
    uploadFiles: [path: string, files: LocalUploadFile[], directories: string[]];
    copyToClipboard: [entries: RemoteFileEntry[]];
    cutToClipboard: [entries: RemoteFileEntry[]];
    moveTo: [entries: RemoteFileEntry[], destination: string];
    paste: [destination: string];
    compress: [entries: RemoteFileEntry[]];
    compressPreset: [intent: ArchiveCompressionIntent];
    decompress: [entry: RemoteFileEntry];
    sendFiles: [entries: RemoteFileEntry[]];
    rowScale: [scale: number];
    columnWidths: [widths: Record<string, number>];
  }>();
  const { t } = useI18n();
  const device = useDeviceCapabilities();
  const feedback = useFeedback();
  const ownsFilesystemState = !props.state;
  const filesystemState = props.state ?? createFilesystemSessionState(props.channel, props.initialPath ?? '/');
  const browser = filesystemState.browser;
  const catalog = useFilesystemCatalog();
  const action = ref<'mkdir' | 'file' | 'rename' | 'chmod' | null>(null);
  const target = ref<RemoteFileEntry | null>(null);
  const value = ref('');
  const catalogVisible = ref(false);
  const pathDraft = ref(props.initialPath ?? '/');
  const pathHistoryOpen = ref(false);
  const pathHistoryIndex = ref(-1);
  const root = ref<HTMLElement | null>(null);
  const pathInput = ref<{ focus?: () => void; select?: () => void } | null>(null);
  const searchInput = ref<{ focus?: () => void } | null>(null);
  const listScroller = ref<HTMLElement | null>(null);
  const keyboardCursor = ref<string | null>(null);
  const multiSelect = ref(false);
  const dragging = ref(false);
  const draggedRemoteEntries = ref<RemoteFileEntry[]>([]);
  const remoteDragTarget = ref<string | null>(null);
  let remoteDragScrollTimer: number | undefined;
  type FileManagerContext =
    | { scope: 'entry'; entry: RemoteFileEntry; x: number; y: number }
    | { scope: 'current-directory' | 'parent-directory'; destination: string; x: number; y: number };
  const context = ref<FileManagerContext | null>(null);
  const compressSubmenu = ref<{ x: number; y: number; side: 'left' | 'right' } | null>(null);
  watch(context, (value) => {
    if (!value) compressSubmenu.value = null;
  });
  const renderedRowScale = ref(props.rowScale);
  const changingTerminalPath = ref(false);
  const syncingTerminalPath = ref(false);
  const listScrollTop = ref(0);
  const listViewportHeight = ref(600);
  const FILE_VIRTUALIZATION_THRESHOLD = 250;
  const FILE_LIST_OVERSCAN = 12;
  let listResizeObserver: ResizeObserver | undefined;
  type ColumnKey = 'type' | 'name' | 'size' | 'permissions' | 'modified';
  const minimumColumnWidths: Record<ColumnKey, number> = {
    type: 42,
    name: 140,
    size: 80,
    permissions: 100,
    modified: 140,
  };
  const renderedColumnWidths = ref<Record<ColumnKey, number>>({
    type: props.columnWidths?.type ?? 50,
    name: props.columnWidths?.name ?? 300,
    size: props.columnWidths?.size ?? 100,
    permissions: props.columnWidths?.permissions ?? 120,
    modified: props.columnWidths?.modified ?? 180,
  });
  let activeColumnResize: { key: ColumnKey; pointerId: number; startX: number; startWidth: number } | undefined;
  let unregisterSearchFocus: (() => void) | undefined;
  let unregisterPathFocus: (() => void) | undefined;

  const resolveWheelScale = createWheelScaleResolver({
    min: 0.5,
    max: 1.6,
    step: 0.08,
    thresholdPx: 72,
    maxStepsPerEvent: 3,
    stopImmediatePropagation: true,
  });
  const rowStyle = computed(() => ({ '--file-row-scale': renderedRowScale.value }));
  const estimatedRowHeight = computed(() => Math.max(24, 34 * renderedRowScale.value));
  const shouldVirtualize = computed(() => browser.visible.value.length > FILE_VIRTUALIZATION_THRESHOLD);
  const virtualStartIndex = computed(() => {
    if (!shouldVirtualize.value) return 0;
    return Math.max(0, Math.floor(listScrollTop.value / estimatedRowHeight.value) - FILE_LIST_OVERSCAN);
  });
  const virtualEndIndex = computed(() => {
    if (!shouldVirtualize.value) return browser.visible.value.length;
    const visibleRows = Math.ceil(listViewportHeight.value / estimatedRowHeight.value);
    return Math.min(browser.visible.value.length, virtualStartIndex.value + visibleRows + FILE_LIST_OVERSCAN * 2);
  });
  const virtualEntries = computed(() => browser.visible.value.slice(virtualStartIndex.value, virtualEndIndex.value));
  const virtualTopPadding = computed(() =>
    shouldVirtualize.value ? virtualStartIndex.value * estimatedRowHeight.value : 0,
  );
  const virtualBottomPadding = computed(() =>
    shouldVirtualize.value
      ? Math.max(0, (browser.visible.value.length - virtualEndIndex.value) * estimatedRowHeight.value)
      : 0,
  );
  const formatSize = (bytes: number) =>
    bytes < 1024
      ? `${bytes} B`
      : bytes < 1048576
        ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1048576).toFixed(1)} MB`;
  const formatMode = (mode: number) => (mode & 0o7777).toString(8).padStart(3, '0');
  const selectedEntries = () => browser.visible.value.filter((entry) => browser.selected.value.has(entry.path));
  const joinPath = (basePath: string, name: string) => `${basePath.replace(/\/$/, '')}/${name}`.replace(/^\/\//, '/');
  const join = (name: string) => joinPath(browser.path.value, name);
  const parentOf = (path: string) => {
    const normalized = path.replace(/\/+$/, '') || '/';
    const index = normalized.lastIndexOf('/');
    return index <= 0 ? '/' : normalized.slice(0, index);
  };
  const isArchive = (entry: RemoteFileEntry) => /\.(zip|tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(entry.name);
  const canOpenAsText = (entry: RemoteFileEntry) => !entry.metadata.isDirectory && /\.(md|markdown)$/i.test(entry.name);
  const displayEntryName = (entry: RemoteFileEntry) =>
    browser.searchActive.value && 'relativePath' in entry && typeof entry.relativePath === 'string'
      ? entry.relativePath
      : entry.name;
  const sortMark = (key: FilesystemSortKey) =>
    browser.sortKey.value === key ? (browser.sortDirection.value === 'asc' ? ' ▲' : ' ▼') : '';

  const handleListScroll = () => {
    listScrollTop.value = listScroller.value?.scrollTop ?? 0;
  };
  const resetListScroll = () => {
    listScrollTop.value = 0;
    if (listScroller.value) listScroller.value.scrollTop = 0;
  };

  onMounted(async () => {
    unregisterSearchFocus = focusRegistry.register(
      'fileManagerSearch',
      () => {
        searchInput.value?.focus?.();
        return true;
      },
      () => Boolean(root.value?.getClientRects().length),
    );
    unregisterPathFocus = focusRegistry.register(
      'fileManagerPathInput',
      () => {
        pathInput.value?.focus?.();
        pathInput.value?.select?.();
        return true;
      },
      () => Boolean(root.value?.getClientRects().length),
    );
    await filesystemState.ensureLoaded();
    pathDraft.value = browser.path.value;
    listResizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height && height > 0) listViewportHeight.value = height;
    });
    await nextTick();
    if (listScroller.value) listResizeObserver.observe(listScroller.value);
  });
  const stopListScrollerWatch = watch(
    listScroller,
    (value, previous) => {
      if (!listResizeObserver) return;
      if (previous) listResizeObserver.unobserve(previous);
      if (value) {
        listViewportHeight.value = value.clientHeight || listViewportHeight.value;
        listResizeObserver.observe(value);
      }
    },
    { flush: 'post' },
  );
  const stopColumnResize = (event?: PointerEvent) => {
    if (!activeColumnResize) return;
    if (event && event.pointerId !== activeColumnResize.pointerId) return;
    activeColumnResize = undefined;
    window.removeEventListener('pointermove', moveColumnResize);
    window.removeEventListener('pointerup', stopColumnResize);
    window.removeEventListener('pointercancel', stopColumnResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    emit('columnWidths', { ...renderedColumnWidths.value });
  };
  function moveColumnResize(event: PointerEvent) {
    const current = activeColumnResize;
    if (!current || event.pointerId !== current.pointerId) return;
    const minimum = minimumColumnWidths[current.key];
    const next = Math.max(minimum, Math.min(900, current.startWidth + event.clientX - current.startX));
    renderedColumnWidths.value = { ...renderedColumnWidths.value, [current.key]: Math.round(next) };
  }
  const startColumnResize = (event: PointerEvent, key: ColumnKey) => {
    if (!event.isPrimary || activeColumnResize) return;
    event.preventDefault();
    event.stopPropagation();
    activeColumnResize = {
      key,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: renderedColumnWidths.value[key],
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', moveColumnResize);
    window.addEventListener('pointerup', stopColumnResize);
    window.addEventListener('pointercancel', stopColumnResize);
  };
  const columnStyle = (key: ColumnKey) => ({
    width: `${renderedColumnWidths.value[key]}px`,
    minWidth: `${minimumColumnWidths[key]}px`,
  });
  onBeforeUnmount(() => {
    unregisterSearchFocus?.();
    unregisterPathFocus?.();
    if (remoteDragScrollTimer !== undefined) {
      window.clearInterval(remoteDragScrollTimer);
      remoteDragScrollTimer = undefined;
    }
    if (ownsFilesystemState) filesystemState.dispose();
    stopListScrollerWatch();
    listResizeObserver?.disconnect();
    if (activeColumnResize) {
      activeColumnResize = undefined;
      window.removeEventListener('pointermove', moveColumnResize);
      window.removeEventListener('pointerup', stopColumnResize);
      window.removeEventListener('pointercancel', stopColumnResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
  watch(browser.path, (path) => {
    pathDraft.value = path;
    keyboardCursor.value = null;
    resetListScroll();
  });
  watch(browser.searchQuery, () => {
    keyboardCursor.value = null;
    resetListScroll();
  });
  watch([browser.sortKey, browser.sortDirection], resetListScroll);
  watch(
    () => props.columnWidths,
    (value) => {
      if (!value || activeColumnResize) return;
      for (const key of Object.keys(minimumColumnWidths) as ColumnKey[]) {
        const width = value[key];
        if (Number.isFinite(width)) {
          renderedColumnWidths.value[key] = Math.max(minimumColumnWidths[key], Number(width));
        }
      }
    },
    { deep: true },
  );
  watch(
    () => props.rowScale,
    (value) => {
      if (Number.isFinite(value)) renderedRowScale.value = value;
    },
  );

  const activate = async (entry: RemoteFileEntry): Promise<void> => {
    try {
      if (entry.metadata.isSymbolicLink) {
        const resolved = await props.channel.realpath(entry.path);
        if (resolved.targetType === 'directory') {
          await browser.load(resolved.path);
          return;
        }
        const name = resolved.path.split('/').pop() || entry.name;
        emit('openFile', {
          ...entry,
          name,
          path: resolved.path,
          metadata: {
            ...entry.metadata,
            isFile: true,
            isDirectory: false,
            isSymbolicLink: false,
          },
        });
        return;
      }
      if (entry.metadata.isDirectory) await browser.open(entry);
      else emit('openFile', entry);
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const openContextAt = (clientX: number, clientY: number, entry: RemoteFileEntry): void => {
    if (!browser.selected.value.has(entry.path)) browser.select(entry, 'only');
    context.value = { scope: 'entry', entry, x: clientX, y: clientY };
  };
  const contextEntries = (): RemoteFileEntry[] => {
    const entry = context.value?.scope === 'entry' ? context.value.entry : undefined;
    if (!entry) return [];
    if (!browser.selected.value.has(entry.path)) return [entry];
    const selected = selectedEntries();
    return selected.length ? selected : [entry];
  };
  const longPress = useLongPressGesture<RemoteFileEntry>({
    enabled: () => device.isMobile.value,
    vibrateMs: 15,
    onTrigger: (entry, point) => openContextAt(point.x, point.y, entry),
  });
  const clickEntry = (event: MouseEvent, entry: RemoteFileEntry) => {
    if (longPress.consumeClick(event)) return;
    keyboardCursor.value = entry.path;
    if (device.isMobile.value || device.hasTouch.value) {
      if (multiSelect.value) browser.select(entry, 'toggle');
      else void activate(entry);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      browser.select(entry, 'toggle');
      return;
    }
    if (event.shiftKey) {
      browser.select(entry, 'range');
      return;
    }
    browser.select(entry, 'only');
    if (entry.metadata.isDirectory) void activate(entry);
  };
  const doubleClickEntry = (event: MouseEvent, entry: RemoteFileEntry) => {
    if (device.isMobile.value || device.hasTouch.value || multiSelect.value) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey || entry.metadata.isDirectory) return;
    event.preventDefault();
    event.stopPropagation();
    void activate(entry);
  };
  const preserveListFocusOnMouseOpen = (event: MouseEvent): void => {
    if (document.activeElement === listScroller.value) event.preventDefault();
  };
  const PARENT_CURSOR = '__parent__';
  const keyboardPaths = computed(() => [
    ...(browser.path.value === '/' ? [] : [PARENT_CURSOR]),
    ...browser.visible.value.map((entry) => entry.path),
  ]);
  const focusKeyboardCursor = async () => {
    const cursor = keyboardCursor.value;
    if (!cursor) return;
    if (cursor === PARENT_CURSOR) {
      root.value?.querySelector<HTMLElement>('[data-file-parent]')?.focus({ preventScroll: true });
      return;
    }
    const index = browser.visible.value.findIndex((entry) => entry.path === cursor);
    if (shouldVirtualize.value && index >= 0 && listScroller.value) {
      const targetTop = index * estimatedRowHeight.value;
      const targetBottom = targetTop + estimatedRowHeight.value;
      const viewportTop = listScroller.value.scrollTop;
      const viewportBottom = viewportTop + listScroller.value.clientHeight;
      if (targetTop < viewportTop || targetBottom > viewportBottom) {
        listScroller.value.scrollTop = Math.max(0, targetTop - listScroller.value.clientHeight / 2);
        listScrollTop.value = listScroller.value.scrollTop;
        await nextTick();
      }
    }
    const row = [...(root.value?.querySelectorAll<HTMLElement>('[data-file-path]') ?? [])].find(
      (element) => element.dataset.filePath === cursor,
    );
    row?.focus({ preventScroll: true });
    row?.closest('tr')?.scrollIntoView({ block: 'nearest' });
  };
  const ensureKeyboardSelection = (): RemoteFileEntry[] => {
    const selected = selectedEntries();
    if (selected.length) return selected;
    const cursor = keyboardCursor.value;
    if (!cursor || cursor === PARENT_CURSOR) return [];
    const entry = browser.visible.value.find((item) => item.path === cursor);
    if (!entry) return [];
    browser.select(entry, 'only');
    return [entry];
  };
  const handleKeyboardNavigation = (event: KeyboardEvent) => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    )
      return;

    const key = event.key.toLowerCase();
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    if (ctrlOrMeta && key === 'a') {
      event.preventDefault();
      browser.selectAll();
      return;
    }
    if (ctrlOrMeta && key === 'c') {
      event.preventDefault();
      const entries = ensureKeyboardSelection();
      if (entries.length) emit('copyToClipboard', entries);
      return;
    }
    if (ctrlOrMeta && key === 'x') {
      event.preventDefault();
      const entries = ensureKeyboardSelection();
      if (entries.length) emit('cutToClipboard', entries);
      return;
    }
    if (ctrlOrMeta && key === 'v') {
      event.preventDefault();
      if (props.clipboardCount) emit('paste', browser.path.value);
      return;
    }
    if (ctrlOrMeta && event.shiftKey && key === 'n') {
      event.preventDefault();
      begin('mkdir');
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      const entries = ensureKeyboardSelection();
      if (entries.length) void remove(entries);
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      const entries = ensureKeyboardSelection();
      if (entries.length === 1) begin('rename', entries[0]);
      return;
    }
    if (event.key === 'F5') {
      event.preventDefault();
      void browser.refresh();
      return;
    }
    if (event.altKey && event.key === 'ArrowUp' && browser.path.value !== '/') {
      event.preventDefault();
      void browser.goParent();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Enter') return;

    const paths = keyboardPaths.value;
    if (!paths.length) return;
    if (event.key === 'Enter') {
      const cursor = keyboardCursor.value ?? browser.selectionAnchor.value;
      if (!cursor) return;
      event.preventDefault();
      if (cursor === PARENT_CURSOR) void browser.goParent();
      else {
        const entry = browser.visible.value.find((item) => item.path === cursor);
        if (entry) void activate(entry);
      }
      return;
    }

    event.preventDefault();
    const current = keyboardCursor.value ?? browser.selectionAnchor.value;
    const currentIndex = current ? paths.indexOf(current) : -1;
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex =
      currentIndex < 0 ? (delta > 0 ? 0 : paths.length - 1) : (currentIndex + delta + paths.length) % paths.length;
    const next = paths[nextIndex]!;
    keyboardCursor.value = next;
    if (next !== PARENT_CURSOR) {
      const entry = browser.visible.value.find((item) => item.path === next);
      if (entry) browser.select(entry, 'only');
    }
    void nextTick(() => void focusKeyboardCursor());
  };

  const stopRemoteDragScroll = () => {
    if (remoteDragScrollTimer === undefined) return;
    window.clearInterval(remoteDragScrollTimer);
    remoteDragScrollTimer = undefined;
  };
  const updateRemoteDragScroll = (event: DragEvent) => {
    const scroller = listScroller.value;
    if (!scroller || !draggedRemoteEntries.value.length) return;
    const rect = scroller.getBoundingClientRect();
    const edge = 48;
    const direction = event.clientY < rect.top + edge ? -1 : event.clientY > rect.bottom - edge ? 1 : 0;
    if (!direction) {
      stopRemoteDragScroll();
      return;
    }
    if (remoteDragScrollTimer !== undefined) return;
    remoteDragScrollTimer = window.setInterval(() => {
      scroller.scrollTop += direction * 12;
    }, 30);
  };
  const remoteDropAllowed = (destination: string) =>
    draggedRemoteEntries.value.length > 0 &&
    draggedRemoteEntries.value.some((entry) => {
      if (entry.path === destination || parentOf(entry.path) === destination) return false;
      return !(entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`));
    });
  const startRemoteDrag = (event: DragEvent, entry: RemoteFileEntry) => {
    if (device.isMobile.value || device.hasTouch.value || !event.dataTransfer) return;
    const selection = selectedEntries();
    draggedRemoteEntries.value = browser.selected.value.has(entry.path) && selection.length ? selection : [entry];
    keyboardCursor.value = entry.path;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(
      'application/x-nexus-remote-files',
      draggedRemoteEntries.value.map((item) => item.path).join('\n'),
    );
  };
  const endRemoteDrag = () => {
    stopRemoteDragScroll();
    draggedRemoteEntries.value = [];
    remoteDragTarget.value = null;
  };
  const handleRemoteTargetDragOver = (event: DragEvent, destination: string) => {
    if (!remoteDropAllowed(destination)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    remoteDragTarget.value = destination;
    updateRemoteDragScroll(event);
  };
  const dropRemote = (event: DragEvent, destination: string) => {
    if (!remoteDropAllowed(destination)) return;
    event.preventDefault();
    event.stopPropagation();
    const entries = draggedRemoteEntries.value.filter(
      (entry) =>
        entry.path !== destination &&
        parentOf(entry.path) !== destination &&
        !(entry.metadata.isDirectory && destination.startsWith(`${entry.path}/`)),
    );
    endRemoteDrag();
    if (entries.length) emit('moveTo', entries, destination);
  };
  const handleDragEnter = (event: DragEvent) => {
    if (draggedRemoteEntries.value.length) return;
    if (event.dataTransfer?.types.includes('Files')) dragging.value = true;
  };
  const handleContainerDragOver = (event: DragEvent) => {
    if (draggedRemoteEntries.value.length) {
      updateRemoteDragScroll(event);
      return;
    }
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  };
  const handleDragLeave = (event: DragEvent) => {
    const container = event.currentTarget as HTMLElement;
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !container.contains(related)) dragging.value = false;
  };
  const toggleMultiSelect = () => {
    multiSelect.value = !multiSelect.value;
    browser.clearSelection();
  };
  const begin = (type: typeof action.value, entry?: RemoteFileEntry) => {
    action.value = type;
    target.value = entry ?? null;
    value.value =
      type === 'rename' ? (entry?.name ?? '') : type === 'chmod' ? formatMode(entry?.metadata.mode ?? 0) : '';
    context.value = null;
  };
  const submit = async () => {
    const text = value.value.trim();
    if (!text) return;
    try {
      if (action.value === 'mkdir') await props.channel.createDirectory(join(text));
      else if (action.value === 'file') await props.channel.createFile(join(text), '');
      else if (action.value === 'rename' && target.value)
        await props.channel.rename(target.value.path, joinPath(parentOf(target.value.path), text));
      else if (action.value === 'chmod' && target.value) {
        if (!/^[0-7]{3,4}$/.test(text)) throw new Error(t('fileManager.errors.invalidPermissionsFormat'));
        await props.channel.chmod(target.value.path, Number.parseInt(text, 8));
      }
      action.value = null;
      await browser.load();
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const remove = async (entries: RemoteFileEntry[]) => {
    if (!entries.length) return;
    context.value = null;
    const key =
      entries.length > 1
        ? 'fileManager.prompts.confirmDeleteMultiple'
        : entries[0]!.metadata.isDirectory
          ? 'fileManager.prompts.confirmDeleteFolder'
          : 'fileManager.prompts.confirmDeleteFile';
    const params = entries.length > 1 ? { count: entries.length } : { name: entries[0]!.name };
    if (props.confirmDelete && !(await feedback.confirm({ message: t(key, params), destructive: true }))) return;
    try {
      await props.channel.remove(entries.map((entry) => entry.path));
      await browser.load();
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const changeTerminalToCurrent = async () => {
    if (!props.terminalDirectory || changingTerminalPath.value) return;
    changingTerminalPath.value = true;
    try {
      const result = await props.terminalDirectory.changeDirectory(browser.path.value, {
        onQueued: ({ waitingForPrompt }) => {
          if (waitingForPrompt) feedback.notifyInfo(t('fileManager.notifications.terminalPathQueued'));
        },
      });
      feedback.notifySuccess(t('fileManager.notifications.terminalPathChanged', { path: result.path }));
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      changingTerminalPath.value = false;
    }
  };
  const openPathHistory = async () => {
    pathHistoryOpen.value = true;
    pathHistoryIndex.value = -1;
    catalog.historySearch.value = pathDraft.value;
    await catalog.loadHistory().catch(() => undefined);
  };
  const closePathHistory = (restore = false) => {
    pathHistoryOpen.value = false;
    pathHistoryIndex.value = -1;
    if (restore) pathDraft.value = browser.path.value;
  };
  const updatePathHistorySearch = () => {
    catalog.historySearch.value = pathDraft.value;
    pathHistoryIndex.value = -1;
  };
  const deferClosePathHistory = () => {
    window.setTimeout(() => closePathHistory(), 120);
  };
  const navigatePathDraft = async (path = pathDraft.value) => {
    if (!path.trim()) return;
    closePathHistory();
    await browser.load(path);
  };
  const handlePathInputKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePathHistory(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!pathHistoryOpen.value) void openPathHistory();
      const length = catalog.filteredHistory.value.length;
      if (!length) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      pathHistoryIndex.value =
        pathHistoryIndex.value < 0 ? (delta > 0 ? 0 : length - 1) : (pathHistoryIndex.value + delta + length) % length;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = catalog.filteredHistory.value[pathHistoryIndex.value];
      void navigatePathDraft(selected?.path ?? pathDraft.value);
    }
  };
  const copyHistoryPath = async (path: string) => {
    try {
      await writeClipboardText(path);
      feedback.notifySuccess(t('pathHistory.copiedSuccess'));
    } catch {
      feedback.notifyError(t('pathHistory.copiedError'));
    }
  };
  const removeHistoryPath = async (id: number) => {
    await catalog.removeHistory(id);
    const length = catalog.filteredHistory.value.length;
    if (!length) pathHistoryIndex.value = -1;
    else pathHistoryIndex.value = Math.min(pathHistoryIndex.value, length - 1);
  };
  const syncFromTerminal = async () => {
    if (!props.terminalDirectory || syncingTerminalPath.value) return;
    syncingTerminalPath.value = true;
    try {
      const path = await props.terminalDirectory.readCurrentDirectory();
      if (path) await browser.load(path);
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      syncingTerminalPath.value = false;
    }
  };
  const navigate = async (path: string) => {
    await browser.load(path);
  };
  const sendPathToTerminal = async (path: string) => {
    if (!props.terminalDirectory || changingTerminalPath.value) return;
    changingTerminalPath.value = true;
    try {
      await props.terminalDirectory.changeDirectory(path, {
        onQueued: ({ waitingForPrompt }) => {
          if (waitingForPrompt) feedback.notifyInfo(t('fileManager.notifications.terminalPathQueued'));
        },
      });
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      changingTerminalPath.value = false;
    }
  };
  const download = async (entries: RemoteFileEntry[]) => {
    context.value = null;
    if (!props.download || !entries.length) return;
    try {
      for (const entry of entries) {
        let path = entry.path;
        let kind: 'file' | 'directory' = entry.metadata.isDirectory ? 'directory' : 'file';
        if (entry.metadata.isSymbolicLink) {
          const resolved = await props.channel.realpath(entry.path);
          path = resolved.path;
          kind = resolved.targetType === 'directory' ? 'directory' : 'file';
        }
        const { url } = await props.download.createDownload(path, kind);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = '';
        anchor.rel = 'noopener';
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      }
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const copyPath = async (entry: RemoteFileEntry) => {
    context.value = null;
    try {
      await writeClipboardText(entry.path);
      feedback.notifySuccess(t('fileManager.notifications.pathCopied'));
    } catch {
      feedback.notifyError(t('fileManager.errors.copyPathFailed'));
    }
  };
  const openContext = (event: MouseEvent, entry: RemoteFileEntry) => {
    event.preventDefault();
    if (!browser.selected.value.has(entry.path) && !event.ctrlKey && !event.metaKey && !event.shiftKey)
      browser.select(entry, 'only');
    if (device.isMobile.value) longPress.suppressClick();
    compressSubmenu.value = null;
    context.value = { scope: 'entry', entry, x: event.clientX, y: event.clientY };
  };
  const openDirectoryContext = (
    event: MouseEvent,
    scope: 'current-directory' | 'parent-directory',
    destination: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    browser.clearSelection();
    compressSubmenu.value = null;
    context.value = { scope, destination, x: event.clientX, y: event.clientY };
  };
  const openCompressSubmenu = (event: Event) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 220;
    const margin = 8;
    const side = rect.right + width <= window.innerWidth - margin ? 'right' : 'left';
    compressSubmenu.value = {
      x: side === 'right' ? rect.right : Math.max(margin, rect.left - width),
      y: rect.top,
      side,
    };
  };
  const compressWithPreset = (format: ArchiveCompressionFormat, passwordProtected = false) => {
    const entries = contextEntries();
    if (!entries.length) return;
    emit('compressPreset', { entries, format, ...(passwordProtected ? { passwordProtected: true } : {}) });
    compressSubmenu.value = null;
    context.value = null;
  };
  const contextAction = (kind: 'open' | 'copy' | 'move' | 'compress' | 'decompress') => {
    const entry = context.value?.scope === 'entry' ? context.value.entry : undefined;
    const entries = contextEntries();
    context.value = null;
    if (!entry) return;
    if (kind === 'open') void activate(entry);
    else if (kind === 'copy') emit('copyToClipboard', entries);
    else if (kind === 'move') emit('cutToClipboard', entries);
    else if (kind === 'compress') emit('compress', entries);
    else if (kind === 'decompress') emit('decompress', entry);
  };
  const dropFiles = async (event: DragEvent) => {
    if (draggedRemoteEntries.value.length) {
      endRemoteDrag();
      return;
    }
    dragging.value = false;
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    try {
      const batch = await collectDroppedLocalFiles(dataTransfer);
      if (batch.files.length || batch.directories.length) {
        emit('uploadFiles', browser.path.value, batch.files, batch.directories);
      }
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const scaleRows = (event: WheelEvent) => {
    const change = resolveWheelScale(event, renderedRowScale.value);
    if (!change) return;
    renderedRowScale.value = change.next;
    emit('rowScale', change.next);
  };
</script>

<template>
  <section
    ref="root"
    class="relative flex h-full min-h-0 flex-col bg-background"
    @click="context = null"
    @keydown="handleKeyboardNavigation"
    @dragenter="handleDragEnter"
    @dragover="handleContainerDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="dropFiles"
  >
    <header class="flex flex-wrap items-center gap-2 border-b border-border p-2">
      <BaseButton
        size="sm"
        data-file-parent
        :variant="keyboardCursor === PARENT_CURSOR ? 'primary' : 'secondary'"
        :title="t('fileManager.actions.parentDirectory')"
        @click="
          keyboardCursor = PARENT_CURSOR;
          browser.goParent();
        "
        @dragover="handleRemoteTargetDragOver($event, parentOf(browser.path.value))"
        @drop="dropRemote($event, parentOf(browser.path.value))"
        @contextmenu="openDirectoryContext($event, 'parent-directory', parentOf(browser.path.value))"
        >↑</BaseButton
      >
      <div class="relative min-w-48 flex-1">
        <BaseInput
          ref="pathInput"
          v-model="pathDraft"
          data-testid="file-manager-path-input"
          data-focus-id="fileManagerPathInput"
          class="w-full"
          @focus="openPathHistory"
          @input="updatePathHistorySearch"
          @keydown="handlePathInputKeydown"
          @blur="deferClosePathHistory"
        />
        <PathHistoryDropdown
          :visible="pathHistoryOpen"
          :loading="catalog.loadingHistory.value"
          :items="catalog.filteredHistory.value"
          :selected-index="pathHistoryIndex"
          @select="navigatePathDraft"
          @copy="copyHistoryPath"
          @remove="removeHistoryPath"
        />
      </div>
      <BaseButton size="sm" @click="browser.refresh()">{{ t('fileManager.actions.refresh') }}</BaseButton>
      <BaseButton
        size="sm"
        :disabled="changingTerminalPath"
        :title="t('fileManager.actions.cdToTerminal')"
        @click="changeTerminalToCurrent"
        >CD→</BaseButton
      >
      <BaseButton
        size="sm"
        :disabled="syncingTerminalPath"
        :title="t('fileManager.actions.syncFromTerminalPath')"
        @click="syncFromTerminal"
        >←CD</BaseButton
      >
      <BaseButton size="sm" @click="catalogVisible = true">★</BaseButton>
      <BaseButton size="sm" @click="begin('mkdir')">{{ t('fileManager.actions.newFolder') }}</BaseButton>
      <BaseButton size="sm" @click="begin('file')">{{ t('fileManager.actions.newFile') }}</BaseButton>
      <BaseButton data-testid="file-upload-button" size="sm" @click="emit('upload', browser.path.value)">{{
        t('fileManager.actions.upload')
      }}</BaseButton>
      <BaseButton
        v-if="device.isMobile.value || device.hasTouch.value"
        size="sm"
        :variant="multiSelect ? 'primary' : 'ghost'"
        @click="toggleMultiSelect"
        >{{ multiSelect ? t('fileManager.actions.exitMultiSelect') : t('fileManager.actions.multiSelect') }}</BaseButton
      >
    </header>

    <div class="flex flex-wrap gap-2 border-b border-border p-2">
      <BaseInput
        ref="searchInput"
        v-model="browser.searchQuery.value"
        data-testid="file-manager-search-input"
        :placeholder="t('fileManager.searchPlaceholder')"
        @keyup.enter="browser.search"
        @keyup.esc="browser.clearSearch"
      />
      <BaseButton size="sm" @click="browser.search">{{ t('common.search') }}</BaseButton>
      <BaseButton v-if="browser.searchQuery.value" size="sm" variant="ghost" @click="browser.clearSearch">×</BaseButton>
      <BaseButton v-if="props.clipboardCount" size="sm" variant="primary" @click="emit('paste', browser.path.value)">
        {{ t('fileManager.actions.paste') }} ({{ props.clipboardCount }})
      </BaseButton>
      <template v-if="browser.selected.value.size">
        <BaseButton size="sm" @click="emit('copyToClipboard', selectedEntries())">{{
          t('fileManager.actions.copy')
        }}</BaseButton>
        <BaseButton size="sm" @click="emit('cutToClipboard', selectedEntries())">{{
          t('fileManager.actions.cut')
        }}</BaseButton>
        <BaseButton size="sm" @click="emit('sendFiles', selectedEntries())">{{
          t('fileManager.actions.sendFiles')
        }}</BaseButton>
        <BaseButton size="sm" @click="emit('compress', selectedEntries())">{{
          t('fileManager.contextMenu.compress')
        }}</BaseButton>
        <BaseButton v-if="props.download" size="sm" @click="download(selectedEntries())">{{
          t('fileManager.actions.downloadMultiple', { count: browser.selected.value.size })
        }}</BaseButton>
        <BaseButton size="sm" variant="danger" @click="remove(selectedEntries())">{{
          t('fileManager.actions.deleteMultiple', { count: browser.selected.value.size })
        }}</BaseButton>
      </template>
    </div>

    <BaseSpinner v-if="browser.loading.value || browser.searching.value" class="m-6" />
    <p v-else-if="browser.error.value" class="p-4 text-error">{{ browser.error.value }}</p>
    <div
      v-else
      ref="listScroller"
      data-testid="file-manager-list"
      class="min-h-0 flex-1 overflow-auto"
      :style="rowStyle"
      :data-row-scale="renderedRowScale.toFixed(2)"
      @wheel="scaleRows"
      @scroll="handleListScroll"
      @contextmenu="openDirectoryContext($event, 'current-directory', browser.path.value)"
    >
      <p v-if="browser.searchError.value" class="border-b border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
        {{ browser.searchError.value }}
      </p>
      <p
        v-if="browser.searchActive.value && browser.searchTruncated.value"
        class="sticky top-0 z-20 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning"
      >
        {{ t('fileManager.searchTruncated') }}
      </p>
      <BaseTable
        :empty="browser.visible.value.length === 0"
        :empty-text="browser.searchQuery.value ? t('fileManager.noSearchResults') : t('fileManager.emptyDirectory')"
      >
        <template #head
          ><tr>
            <th data-testid="file-manager-type-header" class="relative whitespace-nowrap" :style="columnStyle('type')">
              <span
                v-if="!device.isMobile.value"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                @pointerdown="startColumnResize($event, 'type')"
              ></span>
            </th>
            <th class="relative px-3 py-2" :style="columnStyle('name')">
              <button @click="browser.setSort('name')">
                {{ t('fileManager.headers.name') }}{{ sortMark('name') }}
              </button>
              <span
                v-if="!device.isMobile.value"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                @pointerdown="startColumnResize($event, 'name')"
              ></span>
            </th>
            <th class="relative px-3 py-2" :style="columnStyle('size')">
              <button @click="browser.setSort('size')">
                {{ t('fileManager.headers.size') }}{{ sortMark('size') }}
              </button>
              <span
                v-if="!device.isMobile.value"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                @pointerdown="startColumnResize($event, 'size')"
              ></span>
            </th>
            <th class="relative px-3 py-2" :style="columnStyle('permissions')">
              <button @click="browser.setSort('permissions')">
                {{ t('fileManager.headers.permissions') }}{{ sortMark('permissions') }}
              </button>
              <span
                v-if="!device.isMobile.value"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                @pointerdown="startColumnResize($event, 'permissions')"
              ></span>
            </th>
            <th class="relative px-3 py-2" :style="columnStyle('modified')">
              <button @click="browser.setSort('modified')">
                {{ t('fileManager.headers.modified') }}{{ sortMark('modified') }}
              </button>
              <span
                v-if="!device.isMobile.value"
                class="absolute right-0 top-0 h-full w-1 cursor-col-resize"
                @pointerdown="startColumnResize($event, 'modified')"
              ></span>
            </th>
            <th></th></tr
        ></template>
        <tr v-if="virtualTopPadding" aria-hidden="true">
          <td colspan="6" class="p-0" :style="{ height: `${virtualTopPadding}px` }"></td>
        </tr>
        <tr
          v-for="entry in virtualEntries"
          :key="entry.path"
          :data-filename="entry.name"
          :data-file-path="entry.path"
          class="file-row"
          :class="[
            browser.selected.value.has(entry.path) ? 'bg-primary/10' : '',
            remoteDragTarget === entry.path ? 'ring-1 ring-inset ring-primary' : '',
          ]"
          :draggable="!device.isMobile.value && !device.hasTouch.value"
          @dragstart="startRemoteDrag($event, entry)"
          @dragend="endRemoteDrag"
          @dragover="entry.metadata.isDirectory && handleRemoteTargetDragOver($event, entry.path)"
          @dragleave="remoteDragTarget === entry.path && (remoteDragTarget = null)"
          @drop="entry.metadata.isDirectory && dropRemote($event, entry.path)"
          @contextmenu.stop="openContext($event, entry)"
          @mousedown="preserveListFocusOnMouseOpen"
          @click="clickEntry($event, entry)"
          @dblclick="doubleClickEntry($event, entry)"
          @pointerdown="longPress.start($event, entry)"
          @pointermove="longPress.move"
          @pointerup="longPress.end"
          @pointercancel="longPress.cancel"
        >
          <td class="file-row-cell px-3 py-2" :style="columnStyle('type')">
            <input
              type="checkbox"
              :checked="browser.selected.value.has(entry.path)"
              @click.stop
              @change="browser.toggle(entry)"
            />
          </td>
          <td class="file-row-cell px-3 py-2" :style="columnStyle('name')">
            <button
              class="flex w-full items-center gap-2 text-left"
              :data-file-path="entry.path"
              @mousedown="preserveListFocusOnMouseOpen"
            >
              <span>{{ entry.metadata.isDirectory ? '📁' : entry.metadata.isSymbolicLink ? '🔗' : '📄' }}</span
              ><span>{{ displayEntryName(entry) }}</span>
            </button>
          </td>
          <td class="file-row-cell px-3 py-2 text-text-secondary" :style="columnStyle('size')">
            {{ entry.metadata.isDirectory ? '—' : formatSize(entry.metadata.size) }}
          </td>
          <td class="file-row-cell px-3 py-2 font-mono text-xs" :style="columnStyle('permissions')">
            {{ formatMode(entry.metadata.mode) }}
          </td>
          <td class="file-row-cell px-3 py-2 text-text-secondary" :style="columnStyle('modified')">
            {{ new Date(entry.metadata.modifiedAt).toLocaleString() }}
          </td>
          <td class="file-row-cell px-3 py-2" @click.stop @dblclick.stop>
            <div class="flex flex-wrap justify-end gap-1">
              <BaseButton v-if="props.download" size="sm" @click="download([entry])">{{
                t('fileManager.actions.download')
              }}</BaseButton>
              <BaseButton
                v-if="!entry.metadata.isDirectory && isArchive(entry)"
                size="sm"
                @click="emit('decompress', entry)"
                >{{ t('fileManager.contextMenu.decompress') }}</BaseButton
              >
              <BaseButton size="sm" @click="begin('rename', entry)">{{ t('fileManager.actions.rename') }}</BaseButton>
              <BaseButton size="sm" @click="begin('chmod', entry)">{{
                t('fileManager.actions.changePermissions')
              }}</BaseButton>
              <BaseButton size="sm" variant="danger" @click="remove([entry])">{{ t('common.delete') }}</BaseButton>
            </div>
          </td>
        </tr>
        <tr v-if="virtualBottomPadding" aria-hidden="true">
          <td colspan="6" class="p-0" :style="{ height: `${virtualBottomPadding}px` }"></td>
        </tr>
      </BaseTable>
    </div>

    <div
      v-if="dragging"
      data-testid="file-upload-drop-overlay"
      class="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded border-2 border-dashed border-primary bg-background/85 text-lg font-medium"
    >
      {{ t('fileManager.dropFilesHere') }}
    </div>

    <BaseContextMenu
      v-if="context"
      :visible="true"
      :x="context.x"
      :y="context.y"
      :width="208"
      panel-test-id="file-manager-context-menu"
      @close="context = null"
    >
      <template v-if="context.scope === 'entry'">
        <button class="context-item" @click="contextAction('open')">
          {{ t('common.open') }}
        </button>
        <button
          v-if="canOpenAsText(context.entry)"
          class="context-item"
          @click="
            emit('openAsText', context.entry);
            context = null;
          "
        >
          {{ t('fileManager.actions.openAsText') }}
        </button>
        <button v-if="download" class="context-item" @click="download(contextEntries())">
          {{
            context.entry.metadata.isDirectory
              ? t('fileManager.actions.downloadFolder')
              : t('fileManager.actions.download')
          }}
        </button>
        <button class="context-item" @click="copyPath(context.entry)">{{ t('fileManager.actions.copyPath') }}</button>
        <button
          v-if="props.clipboardCount && context.entry.metadata.isDirectory"
          class="context-item"
          @click="
            emit('paste', context.entry.path);
            context = null;
          "
        >
          {{ t('fileManager.actions.paste') }}
        </button>
        <button class="context-item" @click="contextAction('copy')">{{ t('fileManager.actions.copy') }}</button>
        <button class="context-item" @click="contextAction('move')">{{ t('fileManager.actions.cut') }}</button>
        <button
          class="context-item"
          @click="
            emit('sendFiles', contextEntries());
            context = null;
          "
        >
          {{ t('fileManager.actions.sendFiles') }}
        </button>
        <template v-if="device.isMobile.value || device.hasTouch.value">
          <button class="context-item" @click="compressWithPreset('zip')">
            {{ t('fileManager.contextMenu.compressZip') }}
          </button>
          <button class="context-item" @click="compressWithPreset('zip', true)">
            {{ t('fileManager.contextMenu.compressEncryptedZip') }}
          </button>
          <button class="context-item" @click="compressWithPreset('tar.gz')">
            {{ t('fileManager.contextMenu.compressTarGz') }}
          </button>
          <button class="context-item" @click="compressWithPreset('tar.bz2')">
            {{ t('fileManager.contextMenu.compressTarBz2') }}
          </button>
        </template>
        <button
          v-else
          data-testid="file-manager-compress-menu"
          class="context-item flex items-center justify-between"
          aria-haspopup="menu"
          :aria-expanded="Boolean(compressSubmenu)"
          @mouseenter="openCompressSubmenu"
          @focus="openCompressSubmenu"
        >
          <span>{{ t('fileManager.contextMenu.compress') }}</span
          ><span aria-hidden="true">›</span>
        </button>
        <button
          v-if="!context.entry.metadata.isDirectory && isArchive(context.entry)"
          class="context-item"
          @click="contextAction('decompress')"
        >
          {{ t('fileManager.contextMenu.decompress') }}
        </button>
        <button class="context-item" @click="begin('rename', context.entry)">
          {{ t('fileManager.actions.rename') }}
        </button>
        <button class="context-item" @click="begin('chmod', context.entry)">
          {{ t('fileManager.actions.changePermissions') }}
        </button>
        <button class="context-item text-error" @click="remove(contextEntries())">
          {{ t('fileManager.actions.delete') }}
        </button>
      </template>
      <template v-else>
        <button
          v-if="props.clipboardCount"
          class="context-item"
          @click="
            emit('paste', context.destination);
            context = null;
          "
        >
          {{ t('fileManager.actions.paste') }}
        </button>
        <template v-if="context.scope === 'current-directory'">
          <button class="context-item" @click="begin('mkdir')">{{ t('fileManager.actions.newFolder') }}</button>
          <button class="context-item" @click="begin('file')">{{ t('fileManager.actions.newFile') }}</button>
          <button
            class="context-item"
            @click="
              emit('upload', browser.path.value);
              context = null;
            "
          >
            {{ t('fileManager.actions.upload') }}
          </button>
        </template>
        <button
          class="context-item"
          @click="
            browser.refresh();
            context = null;
          "
        >
          {{ t('fileManager.actions.refresh') }}
        </button>
      </template>
    </BaseContextMenu>

    <BaseContextMenu
      v-if="compressSubmenu"
      :visible="true"
      :x="compressSubmenu.x"
      :y="compressSubmenu.y"
      :width="220"
      :z-index="90"
      :blocking-layer="false"
      @close="compressSubmenu = null"
    >
      <div data-testid="file-manager-context-submenu" :data-side="compressSubmenu.side" class="w-full">
        <button class="context-item" @click="compressWithPreset('zip')">
          {{ t('fileManager.contextMenu.compressZip') }}
        </button>
        <button class="context-item" @click="compressWithPreset('zip', true)">
          {{ t('fileManager.contextMenu.compressEncryptedZip') }}
        </button>
        <button class="context-item" @click="compressWithPreset('tar.gz')">
          {{ t('fileManager.contextMenu.compressTarGz') }}
        </button>
        <button class="context-item" @click="compressWithPreset('tar.bz2')">
          {{ t('fileManager.contextMenu.compressTarBz2') }}
        </button>
      </div>
    </BaseContextMenu>

    <BaseModal
      :visible="Boolean(action)"
      :close-on-escape="true"
      :title="
        action === 'mkdir'
          ? t('fileManager.modals.titles.newFolder')
          : action === 'file'
            ? t('fileManager.modals.titles.newFile')
            : action === 'rename'
              ? t('fileManager.modals.titles.rename', { name: target?.name })
              : t('fileManager.modals.titles.chmod', { name: target?.name })
      "
      @close="action = null"
    >
      <form class="space-y-4" @submit.prevent="submit">
        <BaseFormField :label="t('common.value')" for-id="fileManagerActionValue"
          ><BaseInput id="fileManagerActionValue" v-model="value" autofocus
        /></BaseFormField>
        <div class="flex justify-end gap-2">
          <BaseButton type="button" @click="action = null">{{ t('common.cancel') }}</BaseButton
          ><BaseButton type="submit" variant="primary">{{ t('common.confirm') }}</BaseButton>
        </div>
      </form>
    </BaseModal>
    <FilesystemCatalogModal
      :visible="catalogVisible"
      :current-path="browser.path.value"
      @close="catalogVisible = false"
      @navigate="navigate"
      @terminal="sendPathToTerminal"
    />
  </section>
</template>

<style scoped>
  .file-row-cell {
    padding-top: calc(0.5rem * var(--file-row-scale));
    padding-bottom: calc(0.5rem * var(--file-row-scale));
  }
  .context-item {
    display: block;
    width: 100%;
    border-radius: 0.25rem;
    padding: 0.4rem 0.55rem;
    text-align: left;
  }
  .context-item:hover {
    background: color-mix(in srgb, var(--primary-color) 12%, transparent);
  }
</style>
