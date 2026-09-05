<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { BaseButton, BaseContextMenu, BaseSpinner, OverlayPanel } from '@/foundation/ui';
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
      showEditorButton?: boolean;
    }>(),
    { confirmDelete: true, rowScale: 1, showEditorButton: false },
  );
  const emit = defineEmits<{
    openFile: [entry: RemoteFileEntry];
    openAsText: [entry: RemoteFileEntry];
    openEditor: [];
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
  const searchExpanded = ref(false);
  const pathDraft = ref(props.initialPath ?? '/');
  const pathHistoryOpen = ref(false);
  const pathHistoryIndex = ref(-1);
  let pathHistoryCloseTimer: number | undefined;
  const root = ref<HTMLElement | null>(null);
  const pathInput = ref<{ focus?: () => void; select?: () => void } | null>(null);
  const searchInput = ref<{ focus?: () => void } | null>(null);
  const favoriteButton = ref<HTMLButtonElement | null>(null);
  const actionInput = ref<HTMLInputElement | null>(null);
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
  const contextDownloadLabel = computed(() => {
    const value = context.value;
    if (!value || value.scope !== 'entry') return t('fileManager.actions.download');
    return value.entry.metadata.isDirectory
      ? t('fileManager.actions.downloadFolder')
      : t('fileManager.actions.download');
  });
  const actionTitle = computed(() => {
    if (action.value === 'mkdir') return t('fileManager.modals.titles.newFolder');
    if (action.value === 'file') return t('fileManager.modals.titles.newFile');
    if (action.value === 'rename') return t('fileManager.modals.titles.rename', { name: target.value?.name ?? '' });
    if (action.value === 'chmod') return t('fileManager.modals.titles.chmod', { name: target.value?.name ?? '' });
    return '';
  });
  const actionLabel = computed(() => {
    if (action.value === 'mkdir') return t('fileManager.modals.labels.folderName');
    if (action.value === 'file') return t('fileManager.modals.labels.fileName');
    if (action.value === 'rename') return t('fileManager.modals.labels.newName');
    if (action.value === 'chmod') return t('fileManager.modals.labels.newPermissions');
    return '';
  });
  const actionPlaceholder = computed(() => {
    if (action.value === 'mkdir') return t('fileManager.modals.placeholders.newFolder');
    if (action.value === 'file') return t('fileManager.modals.placeholders.newFile');
    if (action.value === 'rename') return target.value?.name ?? t('fileManager.modals.placeholders.newName');
    if (action.value === 'chmod') return value.value || '0755';
    return '';
  });
  const actionConfirmLabel = computed(() => {
    if (action.value === 'mkdir' || action.value === 'file') return t('fileManager.modals.buttons.create');
    if (action.value === 'rename') return t('fileManager.modals.buttons.rename');
    if (action.value === 'chmod') return t('fileManager.modals.buttons.changePermissions');
    return t('fileManager.modals.buttons.confirm');
  });
  const actionConfirmDisabled = computed(() => {
    const text = value.value.trim();
    if (!text) return true;
    if (action.value === 'rename' && text === target.value?.name) return true;
    if (action.value === 'chmod' && !/^[0-7]{3,4}$/.test(text)) return true;
    return false;
  });
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
  const totalColumnWidth = computed(() =>
    Object.values(renderedColumnWidths.value).reduce((sum, width) => sum + width, 0),
  );
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
  const formatModeOctal = (mode: number): string => (mode & 0o7777).toString(8).padStart(3, '0');
  const formatMode = (mode: number): string => {
    const permissions = mode & 0o777;
    return [
      permissions & 0o400 ? 'r' : '-',
      permissions & 0o200 ? 'w' : '-',
      permissions & 0o100 ? 'x' : '-',
      permissions & 0o040 ? 'r' : '-',
      permissions & 0o020 ? 'w' : '-',
      permissions & 0o010 ? 'x' : '-',
      permissions & 0o004 ? 'r' : '-',
      permissions & 0o002 ? 'w' : '-',
      permissions & 0o001 ? 'x' : '-',
    ].join('');
  };
  const getFileIconClass = (filename: string): string => {
    const lower = filename.toLowerCase();
    const dot = lower.lastIndexOf('.');
    const extension = dot > 0 && dot < lower.length - 1 ? lower.slice(dot + 1) : dot === 0 ? lower.slice(1) : '';
    if (lower === 'makefile') return 'fas fa-cogs';
    if (lower === 'dockerfile' || lower.endsWith('docker-compose.yml') || lower.endsWith('docker-compose.yaml'))
      return 'fab fa-docker';
    if (lower === 'package.json' || lower === 'package-lock.json') return 'fab fa-npm';
    if (lower === 'yarn.lock') return 'fab fa-yarn';
    if (lower === 'composer.json' || lower === 'composer.lock') return 'fab fa-php';
    if (lower === 'gemfile' || lower === 'gemfile.lock') return 'fas fa-gem';
    if (lower.startsWith('.env')) return 'fas fa-shield-alt';
    if (['.git', '.gitignore', '.gitattributes', '.gitmodules'].includes(lower)) return 'fab fa-git-alt';
    if (lower === 'readme' || lower.startsWith('readme.')) return 'fas fa-book-reader';
    if (lower === 'license' || lower.startsWith('license.')) return 'fas fa-balance-scale';
    const iconMap: Record<string, string> = {
      jpg: 'fas fa-file-image',
      jpeg: 'fas fa-file-image',
      png: 'fas fa-file-image',
      gif: 'fas fa-file-image',
      bmp: 'fas fa-file-image',
      svg: 'fas fa-file-image',
      webp: 'fas fa-file-image',
      ico: 'fas fa-file-image',
      tiff: 'fas fa-file-image',
      mp4: 'fas fa-file-video',
      mkv: 'fas fa-file-video',
      avi: 'fas fa-file-video',
      mov: 'fas fa-file-video',
      webm: 'fas fa-file-video',
      mp3: 'fas fa-file-audio',
      wav: 'fas fa-file-audio',
      ogg: 'fas fa-file-audio',
      flac: 'fas fa-file-audio',
      doc: 'fas fa-file-word',
      docx: 'fas fa-file-word',
      xls: 'fas fa-file-excel',
      xlsx: 'fas fa-file-excel',
      ppt: 'fas fa-file-powerpoint',
      pptx: 'fas fa-file-powerpoint',
      pdf: 'fas fa-file-pdf',
      csv: 'fas fa-file-csv',
      tsv: 'fas fa-file-csv',
      zip: 'fas fa-file-archive',
      rar: 'fas fa-file-archive',
      tar: 'fas fa-file-archive',
      gz: 'fas fa-file-archive',
      '7z': 'fas fa-file-archive',
      bz2: 'fas fa-file-archive',
      xz: 'fas fa-file-archive',
      iso: 'fas fa-compact-disc',
      js: 'fab fa-js-square',
      mjs: 'fab fa-js-square',
      cjs: 'fab fa-js-square',
      jsx: 'fab fa-react',
      ts: 'fas fa-file-code',
      tsx: 'fab fa-react',
      vue: 'fab fa-vuejs',
      py: 'fab fa-python',
      java: 'fab fa-java',
      jar: 'fab fa-java',
      go: 'fas fa-file-code',
      rs: 'fas fa-file-code',
      c: 'fas fa-file-code',
      h: 'fas fa-file-code',
      cpp: 'fas fa-file-code',
      rb: 'fas fa-gem',
      php: 'fab fa-php',
      html: 'fab fa-html5',
      htm: 'fab fa-html5',
      css: 'fab fa-css3-alt',
      scss: 'fab fa-sass',
      sass: 'fab fa-sass',
      less: 'fab fa-less',
      json: 'fas fa-file-code',
      xml: 'fas fa-file-code',
      yml: 'fas fa-cog',
      yaml: 'fas fa-cog',
      ini: 'fas fa-cog',
      conf: 'fas fa-cog',
      toml: 'fas fa-cog',
      md: 'fab fa-markdown',
      markdown: 'fab fa-markdown',
      sql: 'fas fa-database',
      db: 'fas fa-database',
      sqlite: 'fas fa-database',
      txt: 'fas fa-file-alt',
      text: 'fas fa-file-alt',
      log: 'fas fa-file-alt',
      key: 'fas fa-key',
      pem: 'fas fa-key',
      pub: 'fas fa-key',
      sh: 'fas fa-terminal',
      bash: 'fas fa-terminal',
      zsh: 'fas fa-terminal',
      fish: 'fas fa-terminal',
      bat: 'fas fa-terminal',
      cmd: 'fas fa-terminal',
      ps1: 'fas fa-terminal',
      ttf: 'fas fa-font',
      otf: 'fas fa-font',
      woff: 'fas fa-font',
      woff2: 'fas fa-font',
      bashrc: 'fas fa-cog',
      zshrc: 'fas fa-cog',
      profile: 'fas fa-cog',
      gitconfig: 'fab fa-git-alt',
    };
    return iconMap[extension] ?? 'far fa-file';
  };
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
        searchExpanded.value = true;
        void nextTick(() => searchInput.value?.focus?.());
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
    if (pathHistoryCloseTimer !== undefined) window.clearTimeout(pathHistoryCloseTimer);
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
      feedback.notifyError(
        entry.metadata.isSymbolicLink
          ? t('fileManager.errors.readFileFailed')
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
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
      type === 'rename' ? (entry?.name ?? '') : type === 'chmod' ? formatModeOctal(entry?.metadata.mode ?? 0) : '';
    context.value = null;
  };
  watch(action, async (type) => {
    if (!type) return;
    await nextTick();
    actionInput.value?.focus();
    actionInput.value?.select();
  });
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
    if (pathHistoryCloseTimer !== undefined) {
      window.clearTimeout(pathHistoryCloseTimer);
      pathHistoryCloseTimer = undefined;
    }
    pathHistoryOpen.value = true;
    pathHistoryIndex.value = -1;
    catalog.historySearch.value = pathDraft.value;
    await catalog.loadHistory().catch(() => undefined);
  };
  const closePathHistory = (restore = false) => {
    if (pathHistoryCloseTimer !== undefined) {
      window.clearTimeout(pathHistoryCloseTimer);
      pathHistoryCloseTimer = undefined;
    }
    pathHistoryOpen.value = false;
    pathHistoryIndex.value = -1;
    if (restore) pathDraft.value = browser.path.value;
  };
  const updatePathHistorySearch = () => {
    catalog.historySearch.value = pathDraft.value;
    pathHistoryIndex.value = -1;
  };
  const deferClosePathHistory = () => {
    if (pathHistoryCloseTimer !== undefined) window.clearTimeout(pathHistoryCloseTimer);
    pathHistoryCloseTimer = window.setTimeout(() => {
      pathHistoryCloseTimer = undefined;
      closePathHistory();
    }, 120);
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
  const closeSearch = () => {
    browser.clearSearch();
    searchExpanded.value = false;
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
    class="file-manager-root relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-sm text-foreground"
    @click="context = null"
    @keydown="handleKeyboardNavigation"
    @dragenter="handleDragEnter"
    @dragover="handleContainerDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="dropFiles"
  >
    <header class="file-manager-toolbar flex shrink-0 flex-wrap items-center gap-1 bg-header p-2">
      <div class="file-manager-actions flex min-w-0 items-center gap-1">
        <button
          type="button"
          class="file-manager-path-button file-manager-action-button"
          :disabled="!props.terminalDirectory || changingTerminalPath"
          :title="t('fileManager.actions.cdToTerminal')"
          @click.stop="changeTerminalToCurrent"
        >
          <i :class="['fas', changingTerminalPath ? 'fa-spinner fa-spin' : 'fa-terminal', 'text-sm']"></i>
        </button>
        <button
          type="button"
          class="file-manager-path-button file-manager-action-button"
          :disabled="!props.terminalDirectory || syncingTerminalPath"
          :title="t('fileManager.actions.syncFromTerminalPath')"
          @click.stop="syncFromTerminal"
        >
          <i :class="['fas', syncingTerminalPath ? 'fa-spinner fa-spin' : 'fa-folder-open', 'text-sm']"></i>
        </button>
        <button
          type="button"
          class="file-manager-path-button file-manager-action-button"
          :title="t('fileManager.actions.refresh')"
          @click.stop="browser.refresh()"
        >
          <i class="fas fa-sync-alt text-sm"></i>
        </button>
        <button
          type="button"
          data-file-parent
          class="file-manager-path-button file-manager-action-button"
          :class="keyboardCursor === PARENT_CURSOR ? 'border-primary text-primary' : ''"
          :disabled="browser.path.value === '/'"
          :title="t('fileManager.actions.parentDirectory')"
          @click="
            keyboardCursor = PARENT_CURSOR;
            browser.goParent();
          "
          @dragover="handleRemoteTargetDragOver($event, parentOf(browser.path.value))"
          @drop="dropRemote($event, parentOf(browser.path.value))"
          @contextmenu="openDirectoryContext($event, 'parent-directory', parentOf(browser.path.value))"
        >
          <i class="fas fa-arrow-up text-sm"></i>
        </button>

        <div class="file-manager-search-slot flex shrink-0 items-center" :class="{ 'is-active': searchExpanded }">
          <button
            v-if="!searchExpanded"
            type="button"
            data-testid="file-manager-search-toggle"
            class="file-manager-path-button file-manager-action-button"
            :title="t('fileManager.searchPlaceholder')"
            :aria-label="t('fileManager.searchPlaceholder')"
            @click.stop="
              searchExpanded = true;
              nextTick(() => searchInput?.focus?.());
            "
          >
            <i class="fas fa-search text-sm"></i>
          </button>
          <div v-else class="file-manager-search-box relative flex min-w-[150px] shrink items-center">
            <i
              class="fas fa-search pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary"
            ></i>
            <input
              ref="searchInput"
              v-model="browser.searchQuery.value"
              data-testid="file-manager-search-input"
              data-focus-id="fileManagerSearch"
              type="text"
              class="min-w-[10px] flex-grow rounded border border-border bg-background py-1 pl-7 pr-2 text-sm text-foreground outline-none transition-colors duration-200 focus:border-primary focus:ring-1 focus:ring-primary"
              :placeholder="t('fileManager.searchPlaceholder')"
              @keyup.enter="browser.search"
              @keyup.esc="closeSearch"
              @blur="!browser.searchQuery.value && (searchExpanded = false)"
            />
          </div>
        </div>

        <button
          ref="favoriteButton"
          type="button"
          class="file-manager-path-button file-manager-action-button"
          :title="t('favoritePaths.title')"
          :aria-label="t('favoritePaths.title')"
          @click="catalogVisible = !catalogVisible"
        >
          <i class="fas fa-star text-sm"></i>
        </button>
        <button
          v-if="showEditorButton"
          type="button"
          class="file-manager-action-button"
          :title="t('fileManager.actions.openEditor')"
          :aria-label="t('fileManager.actions.openEditor')"
          @click="emit('openEditor')"
        >
          <i class="far fa-edit text-sm"></i>
        </button>
        <button
          data-testid="file-upload-button"
          type="button"
          class="file-manager-action-button"
          :title="t('fileManager.actions.uploadFile')"
          @click="emit('upload', browser.path.value)"
        >
          <i class="fas fa-upload text-sm"></i>
        </button>
        <button
          type="button"
          class="file-manager-action-button"
          :title="t('fileManager.actions.newFolder')"
          @click="begin('mkdir')"
        >
          <i class="fas fa-folder-plus text-sm"></i>
        </button>
        <button
          type="button"
          class="file-manager-action-button"
          :title="t('fileManager.actions.newFile')"
          @click="begin('file')"
        >
          <i class="far fa-file-alt text-sm"></i>
        </button>
        <button
          v-if="device.isMobile.value || device.hasTouch.value"
          type="button"
          class="file-manager-action-button"
          :class="multiSelect ? 'border-primary bg-primary text-white' : ''"
          :title="multiSelect ? t('fileManager.actions.exitMultiSelect') : t('fileManager.actions.multiSelect')"
          :aria-label="multiSelect ? t('fileManager.actions.exitMultiSelect') : t('fileManager.actions.multiSelect')"
          @click="toggleMultiSelect"
        >
          <i class="fas fa-check-square text-sm"></i>
        </button>
      </div>

      <div
        class="file-manager-path-input relative flex min-w-0 items-center rounded border border-border bg-background px-1.5 py-0.5"
      >
        <input
          ref="pathInput"
          v-model="pathDraft"
          data-testid="file-manager-path-input"
          data-focus-id="fileManagerPathInput"
          type="text"
          class="min-w-[100px] flex-grow bg-transparent p-0.5 font-medium text-link outline-none"
          :title="t('fileManager.editPathTooltip')"
          @focus="openPathHistory"
          @click="openPathHistory"
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
    </header>

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
      <table
        class="file-table w-full table-fixed border-collapse border-border"
        :style="{ minWidth: `${totalColumnWidth}px` }"
      >
        <colgroup>
          <col :style="columnStyle('type')" />
          <col :style="columnStyle('name')" />
          <col :style="columnStyle('size')" />
          <col :style="columnStyle('permissions')" />
          <col :style="columnStyle('modified')" />
        </colgroup>
        <thead class="sticky top-0 z-10 bg-header">
          <tr>
            <th
              data-testid="file-manager-type-header"
              class="file-table-header relative whitespace-nowrap"
              :style="columnStyle('type')"
            >
              {{ t('fileManager.headers.type') }}
              <span
                v-if="!device.isMobile.value"
                class="absolute right-[-3px] top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                @pointerdown="startColumnResize($event, 'type')"
              ></span>
            </th>
            <th class="file-table-header relative whitespace-nowrap" :style="columnStyle('name')">
              <button type="button" @click="browser.setSort('name')">
                {{ t('fileManager.headers.name') }}{{ sortMark('name') }}
              </button>
              <span
                v-if="!device.isMobile.value"
                class="absolute right-[-3px] top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                @pointerdown="startColumnResize($event, 'name')"
              ></span>
            </th>
            <th class="file-table-header relative whitespace-nowrap" :style="columnStyle('size')">
              <button type="button" @click="browser.setSort('size')">
                {{ t('fileManager.headers.size') }}{{ sortMark('size') }}
              </button>
              <span
                v-if="!device.isMobile.value"
                class="absolute right-[-3px] top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                @pointerdown="startColumnResize($event, 'size')"
              ></span>
            </th>
            <th class="file-table-header relative whitespace-nowrap" :style="columnStyle('permissions')">
              {{ t('fileManager.headers.permissions') }}
              <span
                v-if="!device.isMobile.value"
                class="absolute right-[-3px] top-0 z-20 h-full w-1.5 cursor-col-resize hover:bg-primary/20"
                @pointerdown="startColumnResize($event, 'permissions')"
              ></span>
            </th>
            <th class="file-table-header relative whitespace-nowrap" :style="columnStyle('modified')">
              <button type="button" @click="browser.setSort('modified')">
                {{ t('fileManager.headers.modified') }}{{ sortMark('modified') }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-if="browser.path.value !== '/'"
            data-filename=".."
            class="cursor-pointer select-none transition-colors duration-150 hover:bg-header/50"
            :class="keyboardCursor === PARENT_CURSOR ? 'bg-primary/10' : ''"
            @click="
              keyboardCursor = PARENT_CURSOR;
              browser.goParent();
            "
            @dragover="handleRemoteTargetDragOver($event, parentOf(browser.path.value))"
            @drop="dropRemote($event, parentOf(browser.path.value))"
            @contextmenu.stop="openDirectoryContext($event, 'parent-directory', parentOf(browser.path.value))"
          >
            <td class="file-row-cell file-row-type text-center" :style="columnStyle('type')">
              <i class="fas fa-level-up-alt text-primary"></i>
            </td>
            <td class="file-row-cell file-row-name" :style="columnStyle('name')">..</td>
            <td class="file-row-cell" :style="columnStyle('size')"></td>
            <td class="file-row-cell" :style="columnStyle('permissions')"></td>
            <td class="file-row-cell" :style="columnStyle('modified')"></td>
          </tr>
          <tr v-if="browser.visible.value.length === 0">
            <td colspan="5" class="px-4 py-6 text-center italic text-text-secondary">
              {{ browser.searchQuery.value ? t('fileManager.noSearchResults') : t('fileManager.emptyDirectory') }}
            </td>
          </tr>
          <tr v-if="virtualTopPadding" aria-hidden="true">
            <td colspan="5" class="border-0 p-0" :style="{ height: `${virtualTopPadding}px` }"></td>
          </tr>
          <tr
            v-for="entry in virtualEntries"
            :key="entry.path"
            :data-filename="entry.name"
            :data-file-path="entry.path"
            class="file-row select-none transition-colors duration-150"
            :class="[
              browser.selected.value.has(entry.path) ? 'bg-primary text-white' : 'hover:bg-header/50',
              remoteDragTarget === entry.path ? 'outline-dashed outline-2 outline-offset-[-1px] outline-primary' : '',
              entry.metadata.isDirectory || entry.metadata.isFile || entry.metadata.isSymbolicLink
                ? 'cursor-pointer'
                : '',
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
            <td class="file-row-cell file-row-type text-center" :style="columnStyle('type')">
              <i
                :class="[
                  'transition-colors duration-150',
                  entry.metadata.isDirectory
                    ? 'fas fa-folder text-primary'
                    : entry.metadata.isSymbolicLink
                      ? 'fas fa-link text-cyan-500'
                      : `${getFileIconClass(entry.name)} text-text-secondary`,
                  browser.selected.value.has(entry.path) ? '!text-white' : '',
                ]"
              ></i>
            </td>
            <td
              class="file-row-cell file-row-name truncate"
              :class="entry.metadata.isDirectory ? 'font-medium' : ''"
              :style="columnStyle('name')"
            >
              <button
                type="button"
                class="w-full truncate text-left"
                :data-file-path="entry.path"
                @mousedown="preserveListFocusOnMouseOpen"
              >
                {{ displayEntryName(entry) }}
              </button>
            </td>
            <td
              class="file-row-cell file-row-meta truncate"
              :class="browser.selected.value.has(entry.path) ? 'text-white' : 'text-text-secondary'"
              :style="columnStyle('size')"
            >
              {{ entry.metadata.isDirectory ? '' : formatSize(entry.metadata.size) }}
            </td>
            <td
              class="file-row-cell file-row-meta truncate font-mono"
              :class="browser.selected.value.has(entry.path) ? 'text-white' : 'text-text-secondary'"
              :style="columnStyle('permissions')"
            >
              {{ formatMode(entry.metadata.mode) }}
            </td>
            <td
              class="file-row-cell file-row-meta truncate"
              :class="browser.selected.value.has(entry.path) ? 'text-white' : 'text-text-secondary'"
              :style="columnStyle('modified')"
            >
              {{ new Date(entry.metadata.modifiedAt).toLocaleString() }}
            </td>
          </tr>
          <tr v-if="virtualBottomPadding" aria-hidden="true">
            <td colspan="5" class="border-0 p-0" :style="{ height: `${virtualBottomPadding}px` }"></td>
          </tr>
        </tbody>
      </table>
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
      auto-width
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
          {{ contextDownloadLabel }}
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

    <OverlayPanel
      :visible="Boolean(action)"
      :z-index="100"
      :close-on-escape="true"
      panel-class="max-w-md flex flex-col p-5"
      data-testid="file-manager-action-modal"
      :data-action-type="action || ''"
      role="dialog"
      :aria-modal="true"
      :aria-label="actionTitle"
      @close="action = null"
    >
      <button
        type="button"
        class="absolute right-3 top-3 z-10 p-1 text-text-secondary transition-colors hover:text-foreground"
        :title="t('fileManager.modals.buttons.close')"
        :aria-label="t('fileManager.modals.buttons.close')"
        @click="action = null"
      >
        <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <h3 class="mb-4 shrink-0 text-center text-xl font-semibold">{{ actionTitle }}</h3>
      <form class="flex-grow" @submit.prevent="submit">
        <label for="fileManagerActionValue" class="mb-1 block text-sm font-medium text-text-secondary">
          {{ actionLabel }}
        </label>
        <input
          id="fileManagerActionValue"
          ref="actionInput"
          v-model="value"
          type="text"
          class="w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          :placeholder="actionPlaceholder"
        />
        <p
          v-if="action === 'chmod' && value.trim() && !/^[0-7]{3,4}$/.test(value.trim())"
          class="mt-1 text-xs text-error"
        >
          {{ t('fileManager.errors.invalidPermissionsFormat') }}
        </p>
        <p v-else-if="action === 'chmod'" class="mt-1 text-xs text-text-secondary">
          {{ t('fileManager.modals.chmodHelp') }}
        </p>
      </form>
      <div class="mt-6 flex shrink-0 justify-end gap-3">
        <button
          type="button"
          class="rounded-md border border-border/50 bg-background px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-150 hover:bg-border hover:text-foreground"
          @click="action = null"
        >
          {{ t('fileManager.modals.buttons.cancel') }}
        </button>
        <button
          data-testid="file-manager-action-confirm"
          type="button"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-button-hover disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="actionConfirmDisabled"
          @click="submit"
        >
          {{ actionConfirmLabel }}
        </button>
      </div>
    </OverlayPanel>
    <FilesystemCatalogModal
      :visible="catalogVisible"
      :current-path="browser.path.value"
      :trigger-element="favoriteButton"
      @close="catalogVisible = false"
      @navigate="navigate"
      @terminal="sendPathToTerminal"
    />
  </section>
</template>

<style scoped>
  .file-manager-root {
    container-type: inline-size;
    container-name: file-manager-pane;
    font-family: var(--font-family-sans-serif, sans-serif);
  }
  .file-manager-toolbar,
  .file-manager-actions {
    min-width: 0;
  }
  .file-manager-toolbar {
    justify-content: flex-start !important;
    column-gap: 0.35rem;
    row-gap: 0.3rem;
  }
  .file-manager-actions {
    order: 2;
    display: flex;
    max-width: 100%;
    flex: 1 1 auto;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .file-manager-action-button {
    display: flex;
    min-width: 1.75rem;
    min-height: 1.75rem;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    cursor: pointer;
    border: 1px solid var(--border-color);
    border-radius: 0.25rem;
    background: var(--app-bg-color);
    color: var(--text-color);
    font-size: 0.75rem;
    white-space: nowrap;
    transition:
      background-color 0.2s,
      border-color 0.2s,
      color 0.2s;
  }
  .file-manager-action-button:hover:not(:disabled) {
    border-color: var(--link-active-color);
    background: var(--header-bg-color);
    color: var(--link-active-color);
  }
  .file-manager-action-button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  .file-manager-path-button {
    width: 1.75rem;
    height: 1.75rem;
    min-width: 1.75rem;
    min-height: 1.75rem;
    flex: 0 0 1.75rem;
    padding: 0;
  }
  .file-manager-search-slot > .file-manager-path-button {
    width: 1.75rem;
    height: 1.75rem;
    flex-basis: 1.75rem;
  }
  .file-manager-search-box,
  .file-manager-path-input {
    max-width: 100%;
  }
  .file-manager-path-input {
    order: 3;
    min-width: 8rem;
    flex: 1 1 12rem;
  }

  .file-table-header {
    overflow: hidden;
    padding-top: calc(0.4rem * var(--file-row-scale));
    padding-right: 0.8rem;
    padding-bottom: calc(0.4rem * var(--file-row-scale));
    padding-left: 0.8rem;
    cursor: default;
    border-bottom: 2px solid var(--border-color);
    color: var(--text-color-secondary);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.05em;
    text-align: left;
    text-transform: uppercase;
    user-select: none;
  }
  .file-table-header:first-child {
    padding-right: 0.5rem;
    padding-left: 1rem;
  }
  .file-table-header button {
    width: 100%;
    cursor: pointer;
    text-align: left;
  }
  .file-table-header button:hover {
    color: var(--text-color);
  }
  .file-row-cell {
    padding-top: calc(0.4rem * var(--file-row-scale));
    padding-right: 0.8rem;
    padding-bottom: calc(0.4rem * var(--file-row-scale));
    padding-left: 0.8rem;
    border-bottom: 1px solid var(--border-color);
    font-size: calc(0.8rem * max(0.85, var(--file-row-scale) * 0.5 + 0.5));
    vertical-align: middle;
  }
  .file-row-type {
    padding-right: 0.5rem;
    padding-left: 1rem;
  }
  .file-row-type i {
    font-size: calc(1.1em * max(0.85, var(--file-row-scale) * 0.5 + 0.5));
  }
  .file-row-meta {
    font-size: calc(0.72rem * max(0.85, var(--file-row-scale) * 0.5 + 0.5));
  }

  .context-item {
    display: flex;
    width: calc(100% - 0.5rem);
    align-items: center;
    margin-right: 0.25rem;
    margin-left: 0.25rem;
    border-radius: 0.25rem;
    padding: 0.375rem 1rem;
    color: var(--text-color);
    font-size: 0.875rem;
    text-align: left;
    transition:
      background-color 0.15s,
      color 0.15s;
  }
  .context-item:hover {
    background: color-mix(in srgb, var(--link-active-color) 12%, transparent);
  }

  @container file-manager-pane (max-width: 520px) {
    .file-manager-search-box {
      width: min(100%, 10rem);
      min-width: 0 !important;
    }
    .file-manager-actions {
      gap: 0.25rem;
    }
    .file-manager-action-button {
      padding-right: 0.45rem;
      padding-left: 0.45rem;
    }
  }
  @container file-manager-pane (max-width: 420px) {
    .file-manager-actions {
      display: grid;
      width: 100%;
      flex: 1 1 100%;
      grid-template-columns: repeat(auto-fit, minmax(1.75rem, 1fr));
      gap: 0.25rem;
    }
    .file-manager-actions > .file-manager-action-button,
    .file-manager-search-slot {
      width: 100%;
      min-width: 0;
      flex: none;
    }
    .file-manager-action-button,
    .file-manager-search-slot .file-manager-action-button,
    .file-manager-actions .file-manager-search-slot > .file-manager-path-button {
      width: 100% !important;
      height: 1.75rem !important;
    }
    .file-manager-actions .file-manager-search-slot > .file-manager-path-button {
      min-width: 0;
      flex-basis: auto;
    }
    .file-manager-search-slot.is-active {
      grid-column: 1 / -1;
    }
    .file-manager-search-slot.is-active .file-manager-search-box {
      width: 100%;
    }
    .file-manager-action-button {
      padding-right: 0.35rem;
      padding-left: 0.35rem;
    }
  }
  @container file-manager-pane (max-width: 320px) {
    .file-manager-toolbar {
      gap: 0.25rem;
      padding: 0.35rem;
    }
    .file-manager-actions {
      gap: 0.25rem;
    }
    .file-manager-action-button {
      width: auto !important;
      height: 1.75rem !important;
    }
    .file-manager-action-button i {
      font-size: 0.8rem !important;
    }
  }
</style>
