<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { SearchAddon } from '@xterm/addon-search';
  import { SerializeAddon } from '@xterm/addon-serialize';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { useDeviceCapabilities } from '@/foundation/browser';
  import { writeClipboardText } from '@/foundation/browser';
  import { createWheelScaleResolver } from '@/foundation/interaction';
  import '@xterm/xterm/css/xterm.css';
  import type { TerminalChannel } from '../ports/terminal-channel';
  import type { TerminalVisualOptions } from '../model/terminal';
  import { serializeTerminalSnapshot } from '../model/terminalSnapshot';
  import { createTerminalSessionState, type TerminalSessionState } from '../state/terminalSessionState';

  const props = withDefaults(
    defineProps<{
      channel: TerminalChannel;
      fontFamily?: string;
      fontSize?: number;
      theme?: Record<string, string>;
      scrollback?: number;
      rightClickCopyPaste?: boolean;
      visual?: TerminalVisualOptions;
      state?: TerminalSessionState;
    }>(),
    { fontSize: 14, scrollback: 5000, rightClickCopyPaste: true },
  );
  const emit = defineEmits<{
    ready: [];
    error: [message: string];
    closed: [reason?: string];
    fontSizeChange: [size: number];
    interaction: [];
  }>();
  const { t } = useI18n();
  const device = useDeviceCapabilities();
  const terminalState = props.state ?? createTerminalSessionState();
  const wrapper = ref<HTMLElement | null>(null);
  const root = ref<HTMLElement | null>(null);
  const searchOpen = terminalState.searchOpen;
  const searchTerm = terminalState.searchTerm;
  const renderedFontSize = ref(props.fontSize);
  let terminal: Terminal | undefined;
  let fit: FitAddon | undefined;
  let searchAddon: SearchAddon | undefined;
  let serializeAddon: SerializeAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const cleanup: Array<() => void> = [];
  const HISTORY_LIVE_SCROLLBACK_LINES = 20_000;
  const HISTORY_WINDOW_SCROLLBACK_LINES = 20_000;
  const HISTORY_WINDOW_MAX_BYTES = 768 * 1024;
  const HISTORY_CONTINUATION_ROWS = 3000;
  const HISTORY_LIVE_SNAPSHOT_MAX_BYTES = 512 * 1024;
  const HISTORY_DEFERRED_OUTPUT_MAX_BYTES = 384 * 1024;
  const historyEncoder = new TextEncoder();
  let historyLoading = false;
  let historyRebuilding = false;
  let historyBrowsing = false;
  let pagedHistorySession = false;
  let historyLastViewportY = 0;
  let historyLiveSnapshot = '';
  let historyWindowChunks: Uint8Array[] = [];
  let deferredTerminalOutputBytes = 0;
  let historyRestoreTask: Promise<void> | null = null;
  let historyViewGeneration = 0;
  let mobileSelectionSyncFrame: number | null = null;
  const deferredTerminalOutput: Array<string | Uint8Array> = [];
  const hasVisualBackground = computed(() =>
    Boolean(props.visual?.backgroundEnabled && (props.visual.backgroundImageUrl || props.visual.customHtml)),
  );
  const resolvedTheme = computed(() => ({
    ...(props.theme ?? {}),
    ...(hasVisualBackground.value ? { background: 'rgba(0,0,0,0)' } : {}),
    cursor: '#ffffff',
    cursorAccent: '#000000',
  }));
  const backgroundStyle = computed(() =>
    props.visual?.backgroundImageUrl ? { backgroundImage: `url(${props.visual.backgroundImageUrl})` } : {},
  );
  const terminalStyle = computed(() => ({
    '--terminal-stroke-width': `${props.visual?.textStroke?.width ?? 0}px`,
    '--terminal-stroke-color': props.visual?.textStroke?.color ?? 'transparent',
    '--terminal-shadow': `${props.visual?.textShadow?.offsetX ?? 0}px ${props.visual?.textShadow?.offsetY ?? 0}px ${props.visual?.textShadow?.blur ?? 0}px ${props.visual?.textShadow?.color ?? 'transparent'}`,
  }));
  const customHtmlCsp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    'media-src data: blob:',
  ].join('; ');
  const customHtmlBaseStyle = 'html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}';

  const sandboxedCustomHtml = computed(() => {
    const html = props.visual?.customHtml;
    if (!html || !props.visual?.backgroundEnabled) return '';
    const imageOverride = props.visual.backgroundImageUrl
      ? 'html,body{background:transparent!important}body>:not(style):not(script){background-color:transparent!important}'
      : '';
    return [
      `<meta http-equiv="Content-Security-Policy" content="${customHtmlCsp}">`,
      `<style>${customHtmlBaseStyle}${imageOverride}</style>`,
      html,
    ].join('');
  });
  let lastColumns = 0;
  let lastRows = 0;
  const fitAndResize = () => {
    const element = root.value;
    if (!terminal || !fit || !element) return;
    // ResizeObserver fires again when an ancestor is hidden with display:none. Fitting xterm at
    // that point collapses its viewport to a tiny fallback size; FitAddon clears the renderer
    // before resizing, so restoring the tab later exposes a visible redraw/blank strip. Keep the
    // last valid terminal geometry while hidden and fit only after the surface has real dimensions.
    if (element.clientWidth <= 0 || element.clientHeight <= 0) return;
    fit.fit();
    if (terminal.cols !== lastColumns || terminal.rows !== lastRows) {
      lastColumns = terminal.cols;
      lastRows = terminal.rows;
      void props.channel.resize({ columns: terminal.cols, rows: terminal.rows });
    }
    if (device.isMobile.value && mobileTouchSelectionActive) syncMobileSelectionHandles();
  };
  const openSearch = () => {
    searchOpen.value = true;
  };
  const closeSearch = () => {
    searchOpen.value = false;
    searchTerm.value = '';
    searchAddon?.clearDecorations();
    terminal?.focus();
  };
  const findNext = () => Boolean(searchTerm.value && searchAddon?.findNext(searchTerm.value, { incremental: true }));
  const findPrevious = () =>
    Boolean(searchTerm.value && searchAddon?.findPrevious(searchTerm.value, { incremental: true }));

  const writeTerminal = (data: string | Uint8Array): Promise<void> =>
    new Promise((resolve) => {
      if (!terminal) {
        resolve();
        return;
      }
      terminal.write(data, resolve);
    });

  const outputByteLength = (data: string | Uint8Array): number =>
    typeof data === 'string' ? historyEncoder.encode(data).byteLength : data.byteLength;

  const liveScrollbackLimit = (): number =>
    pagedHistorySession ? Math.min(props.scrollback, HISTORY_LIVE_SCROLLBACK_LINES) : props.scrollback;

  const activatePagedHistoryMode = (): boolean => {
    if (!pagedHistorySession && props.channel.hasPreviousOutput?.()) pagedHistorySession = true;
    if (pagedHistorySession && terminal && !historyBrowsing && !historyRebuilding) {
      const limit = liveScrollbackLimit();
      if (terminal.options.scrollback !== limit) terminal.options.scrollback = limit;
    }
    return pagedHistorySession;
  };

  const appendDeferredTerminalOutput = (data: string | Uint8Array): boolean => {
    const copy = typeof data === 'string' ? data : data.slice();
    deferredTerminalOutput.push(copy);
    deferredTerminalOutputBytes += outputByteLength(copy);
    return deferredTerminalOutputBytes >= HISTORY_DEFERRED_OUTPUT_MAX_BYTES;
  };

  const deferredTerminalOutputReplay = (): string => {
    if (!deferredTerminalOutput.length) return '';
    const decoder = new TextDecoder();
    let replay = '';
    for (const chunk of deferredTerminalOutput) {
      if (typeof chunk === 'string') replay += chunk;
      else replay += decoder.decode(chunk, { stream: true });
    }
    replay += decoder.decode();
    return replay;
  };

  const liveReplaySnapshot = (): string => {
    if (!historyBrowsing) {
      return terminal && serializeAddon ? serializeTerminalSnapshot(terminal, serializeAddon) : '';
    }
    return `${historyLiveSnapshot}${deferredTerminalOutputReplay()}`;
  };

  const currentHistoryContinuation = (): Uint8Array => {
    if (!terminal || !serializeAddon) return new Uint8Array();
    try {
      const start = terminal.buffer.active.viewportY;
      const end = Math.min(terminal.buffer.active.length - 1, start + HISTORY_CONTINUATION_ROWS - 1);
      if (end < start) return new Uint8Array();
      return historyEncoder.encode(serializeAddon.serialize({ range: { start, end } }));
    } catch {
      return new Uint8Array();
    }
  };

  const trimHistoryWindowChunks = (chunks: Uint8Array[]): Uint8Array[] => {
    const result: Uint8Array[] = [];
    let remaining = HISTORY_WINDOW_MAX_BYTES;
    for (const chunk of chunks) {
      if (remaining <= 0 || chunk.byteLength === 0) break;
      if (chunk.byteLength <= remaining) {
        result.push(chunk);
        remaining -= chunk.byteLength;
        continue;
      }
      let end = remaining;
      const searchStart = Math.max(0, end - 4096);
      for (let index = end - 1; index >= searchStart; index -= 1) {
        if (chunk[index] === 0x0a) {
          end = index + 1;
          break;
        }
      }
      if (end > 0) result.push(chunk.subarray(0, end));
      break;
    }
    return result;
  };

  const rebuildHistoryWindow = async (newPage: Uint8Array): Promise<void> => {
    if (!terminal || !serializeAddon || newPage.byteLength === 0 || historyRebuilding) return;
    const enteringHistory = !historyBrowsing;
    if (enteringHistory) {
      historyLiveSnapshot = serializeTerminalSnapshot(terminal, serializeAddon, HISTORY_LIVE_SNAPSHOT_MAX_BYTES);
      const continuation = currentHistoryContinuation();
      historyWindowChunks = continuation.byteLength ? [continuation] : [];
      historyBrowsing = true;
      pagedHistorySession = true;
    }

    historyWindowChunks = trimHistoryWindowChunks([newPage.slice(), ...historyWindowChunks]);
    historyRebuilding = true;
    try {
      terminal.options.scrollback = HISTORY_WINDOW_SCROLLBACK_LINES;
      terminal.reset();
      const [pageChunk, ...continuation] = historyWindowChunks;
      if (pageChunk) await writeTerminal(pageChunk);
      if (!terminal) return;
      const continuationStart = Math.max(0, terminal.buffer.active.baseY + terminal.buffer.active.cursorY);
      for (const chunk of continuation) await writeTerminal(chunk);
      if (!terminal) return;
      const anchoredViewportY = Math.min(terminal.buffer.active.baseY, continuationStart);
      terminal.scrollToLine(anchoredViewportY);
      historyLastViewportY = anchoredViewportY;
      syncSearchDecorations();
    } finally {
      historyRebuilding = false;
      if (historyBrowsing && deferredTerminalOutputBytes >= HISTORY_DEFERRED_OUTPUT_MAX_BYTES) {
        void restoreLatestOutput();
      }
    }
  };

  const restoreLatestOutput = (): Promise<void> => {
    if (!historyBrowsing) {
      terminal?.scrollToBottom();
      return Promise.resolve();
    }
    if (historyRestoreTask) return historyRestoreTask;
    const generation = ++historyViewGeneration;
    const task = (async () => {
      if (!terminal) return;
      historyRebuilding = true;
      try {
        const snapshot = historyLiveSnapshot;
        historyBrowsing = false;
        historyWindowChunks = [];
        terminal.options.scrollback = liveScrollbackLimit();
        terminal.reset();
        if (snapshot) await writeTerminal(snapshot);
        await props.channel.resetPreviousOutput?.().catch(() => false);
        while (deferredTerminalOutput.length) {
          const queued = deferredTerminalOutput.splice(0);
          deferredTerminalOutputBytes = 0;
          for (const chunk of queued) await writeTerminal(chunk);
        }
        historyLiveSnapshot = '';
        if (generation === historyViewGeneration) {
          terminal.scrollToBottom();
          historyLastViewportY = terminal.buffer.active.viewportY;
          syncSearchDecorations();
        }
      } finally {
        historyRebuilding = false;
      }
    })().finally(() => {
      if (historyRestoreTask === task) historyRestoreTask = null;
    });
    historyRestoreTask = task;
    return task;
  };

  const loadPreviousOutput = async (): Promise<void> => {
    if (historyLoading || historyRebuilding || !props.channel.loadPreviousOutput) return;
    activatePagedHistoryMode();
    if (!props.channel.hasPreviousOutput?.()) return;
    const generation = historyViewGeneration;
    historyLoading = true;
    try {
      const page = await props.channel.loadPreviousOutput();
      if (generation !== historyViewGeneration) return;
      if (page?.data.byteLength) await rebuildHistoryWindow(page.data);
    } catch {
      // Lazy history is auxiliary. A failed historical-page fetch must never tear down an
      // otherwise healthy resumed terminal.
    } finally {
      historyLoading = false;
    }
  };

  const historyLoadThreshold = (): number => Math.max(4, Math.ceil((terminal?.rows ?? 24) * 0.2));
  const copySelection = async () => {
    if (terminal?.hasSelection()) await writeClipboardText(terminal.getSelection());
  };
  const paste = async () => {
    const text = await navigator.clipboard.readText();
    if (text) terminal?.paste(text.replace(/\r\n?/g, '\n'));
  };
  const selectAll = () => terminal?.selectAll();
  const clearTerminal = () => {
    // Clear xterm's local buffer without injecting ANSI erase/cursor sequences. The remote PTY/readline
    // does not observe locally-written control codes, so moving the local cursor independently can corrupt later redraws.
    if (historyBrowsing) {
      void restoreLatestOutput().then(() => terminal?.clear());
      return;
    }
    terminal?.clear();
  };

  const MOBILE_LONG_PRESS_DELAY = 520;
  const MOBILE_LONG_PRESS_MOVE_TOLERANCE = 12;
  const mobileClipboardMenu = ref({ visible: false, x: 0, y: 0, hasSelection: false });
  const mobileSelectionHandles = ref({
    visible: false,
    startVisible: false,
    endVisible: false,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
  });
  let mobileLongPressTimer: number | null = null;
  let mobileLongPressStart: { x: number; y: number } | null = null;
  let mobileLongPressTriggered = false;
  let mobileTouchMoved = false;
  let mobileGestureHadMultipleTouches = false;
  let mobileTouchScrollActive = false;
  let mobileTouchScrollLastY: number | null = null;
  let mobileTouchScrollRemainder = 0;
  let mobileSelectionLastPoint: { x: number; y: number } | null = null;
  let mobileTouchSelectionActive = false;
  let mobileKeyboardRestoreState: { readOnly: boolean; inputMode: string | null } | null = null;
  let suppressMobileContextMenuUntil = 0;
  let mobileSelectionBaseRange: { startColumn: number; startRow: number; endColumn: number; endRow: number } | null =
    null;
  let mobileSelectionHandleDrag: {
    pointerId: number;
    anchorBoundary: number;
    lastClientX: number;
    lastClientY: number;
  } | null = null;

  const clearMobileLongPressTimer = (): void => {
    if (mobileLongPressTimer === null) return;
    window.clearTimeout(mobileLongPressTimer);
    mobileLongPressTimer = null;
  };

  const resetMobileTouchScroll = (): void => {
    mobileTouchScrollActive = false;
    mobileTouchScrollLastY = null;
    mobileTouchScrollRemainder = 0;
  };

  const terminalTouchRowHeight = (): number => {
    const rows = Math.max(1, terminal?.rows ?? 24);
    const screenHeight = root.value?.querySelector<HTMLElement>('.xterm-screen')?.getBoundingClientRect().height ?? 0;
    const fallbackHeight = root.value?.getBoundingClientRect().height ?? 0;
    return Math.max(1, (screenHeight || fallbackHeight || rows * 16) / rows);
  };

  const scrollTerminalFromMobileDrag = (deltaPixels: number): void => {
    if (!terminal || !Number.isFinite(deltaPixels) || deltaPixels === 0) return;
    mobileTouchScrollRemainder += deltaPixels;
    const rowHeight = terminalTouchRowHeight();
    const lines =
      mobileTouchScrollRemainder > 0
        ? Math.floor(mobileTouchScrollRemainder / rowHeight)
        : Math.ceil(mobileTouchScrollRemainder / rowHeight);
    if (lines === 0) return;
    mobileTouchScrollRemainder -= lines * rowHeight;
    terminal.scrollLines(lines);
    if (lines < 0 && terminal.buffer.active.viewportY <= historyLoadThreshold()) void loadPreviousOutput();
  };

  const suppressMobileSoftKeyboard = (): void => {
    if (!device.isMobile.value || !terminal?.textarea) return;
    const textarea = terminal.textarea;
    if (!mobileKeyboardRestoreState) {
      mobileKeyboardRestoreState = {
        readOnly: textarea.readOnly,
        inputMode: textarea.getAttribute('inputmode'),
      };
    }
    textarea.readOnly = true;
    textarea.setAttribute('inputmode', 'none');
    terminal.blur();
    textarea.blur();
  };

  const restoreMobileSoftKeyboard = (focus = false): void => {
    const textarea = terminal?.textarea;
    const restore = mobileKeyboardRestoreState;
    if (textarea && restore) {
      terminal?.blur();
      textarea.blur();
      textarea.readOnly = restore.readOnly;
      if (restore.inputMode === null) textarea.removeAttribute('inputmode');
      else textarea.setAttribute('inputmode', restore.inputMode);
    }
    mobileKeyboardRestoreState = null;
    if (focus) terminal?.focus();
  };

  const hideMobileSelectionHandles = (): void => {
    mobileSelectionHandles.value.visible = false;
    mobileSelectionHandles.value.startVisible = false;
    mobileSelectionHandles.value.endVisible = false;
    mobileSelectionHandleDrag = null;
  };

  const closeMobileClipboardMenu = (clearSelection = false): void => {
    mobileClipboardMenu.value.visible = false;
    if (!clearSelection) return;
    terminal?.clearSelection();
    mobileSelectionBaseRange = null;
    mobileTouchSelectionActive = false;
    hideMobileSelectionHandles();
  };

  const getTerminalCellAtPoint = (clientX: number, clientY: number) => {
    if (!terminal?.element) return null;
    const screen = terminal.element.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) return null;
    const column = Math.max(
      0,
      Math.min(terminal.cols - 1, Math.floor((clientX - rect.left) / (rect.width / terminal.cols))),
    );
    const viewportRow = Math.max(
      0,
      Math.min(terminal.rows - 1, Math.floor((clientY - rect.top) / (rect.height / terminal.rows))),
    );
    return { column, bufferRow: terminal.buffer.active.viewportY + viewportRow };
  };

  const selectTerminalWordAtPoint = (clientX: number, clientY: number): boolean => {
    if (!terminal) return false;
    const position = getTerminalCellAtPoint(clientX, clientY);
    if (!position) return false;
    const line = terminal.buffer.active.getLine(position.bufferRow);
    if (!line) return false;
    const hasText = (column: number): boolean => {
      const chars = line.getCell(column)?.getChars() ?? '';
      return chars.length > 0 && !/^\s+$/u.test(chars);
    };
    let selectedColumn = position.column;
    while (selectedColumn > 0 && !hasText(selectedColumn) && line.getCell(selectedColumn)?.getWidth() === 0) {
      selectedColumn -= 1;
    }
    if (!hasText(selectedColumn)) {
      terminal.selectLines(position.bufferRow, position.bufferRow);
      return terminal.hasSelection();
    }
    let startColumn = selectedColumn;
    let endColumn = selectedColumn;
    while (startColumn > 0 && hasText(startColumn - 1)) startColumn -= 1;
    while (endColumn + 1 < terminal.cols && hasText(endColumn + 1)) endColumn += 1;
    terminal.select(startColumn, position.bufferRow, endColumn - startColumn + 1);
    return terminal.hasSelection();
  };

  const captureMobileSelectionBaseRange = (): void => {
    const range = terminal?.getSelectionPosition();
    mobileSelectionBaseRange = range
      ? {
          startColumn: range.start.x,
          startRow: range.start.y,
          endColumn: range.end.x,
          endRow: range.end.y,
        }
      : null;
  };

  const syncMobileSelectionHandles = (): void => {
    if (!device.isMobile.value) return;
    if (!terminal || !wrapper.value || !mobileTouchSelectionActive || !terminal.hasSelection()) {
      hideMobileSelectionHandles();
      return;
    }
    const range = terminal.getSelectionPosition();
    const screen = terminal.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!range || !screen) {
      hideMobileSelectionHandles();
      return;
    }
    const screenRect = screen.getBoundingClientRect();
    const wrapperRect = wrapper.value.getBoundingClientRect();
    if (screenRect.width <= 0 || screenRect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) {
      hideMobileSelectionHandles();
      return;
    }
    const cellWidth = screenRect.width / terminal.cols;
    const cellHeight = screenRect.height / terminal.rows;
    const viewportY = terminal.buffer.active.viewportY;
    const startViewportRow = range.start.y - viewportY;
    const endViewportRow = range.end.y - viewportY;
    const radius = 15;
    const point = (column: number, row: number) => ({
      x: Math.max(
        radius,
        Math.min(wrapperRect.width - radius, screenRect.left - wrapperRect.left + column * cellWidth),
      ),
      y: Math.max(
        radius,
        Math.min(wrapperRect.height - radius, screenRect.top - wrapperRect.top + (row + 1) * cellHeight),
      ),
    });
    mobileSelectionHandles.value = {
      visible: true,
      startVisible: startViewportRow >= 0 && startViewportRow < terminal.rows,
      endVisible: endViewportRow >= 0 && endViewportRow < terminal.rows,
      start: point(range.start.x, startViewportRow),
      end: point(range.end.x, endViewportRow),
    };
  };

  const scheduleMobileSelectionSync = (): void => {
    if (!device.isMobile.value || !mobileTouchSelectionActive || mobileSelectionSyncFrame !== null) return;
    mobileSelectionSyncFrame = window.requestAnimationFrame(() => {
      mobileSelectionSyncFrame = null;
      syncMobileSelectionHandles();
    });
  };

  const selectMobileRange = (startBoundary: number, endBoundary: number): void => {
    if (!terminal) return;
    const columns = terminal.cols;
    const startRow = Math.floor(startBoundary / columns);
    const startColumn = startBoundary % columns;
    terminal.select(startColumn, startRow, Math.max(1, endBoundary - startBoundary));
    captureMobileSelectionBaseRange();
    mobileClipboardMenu.value.hasSelection = terminal.hasSelection();
    syncMobileSelectionHandles();
  };

  const updateMobileSelectionToPoint = (clientX: number, clientY: number): void => {
    if (!terminal || !mobileSelectionBaseRange) return;
    const position = getTerminalCellAtPoint(clientX, clientY);
    if (!position) return;
    let targetColumn = position.column;
    const line = terminal.buffer.active.getLine(position.bufferRow);
    while (targetColumn > 0 && line?.getCell(targetColumn)?.getWidth() === 0) targetColumn -= 1;
    const columns = terminal.cols;
    const baseStart = mobileSelectionBaseRange.startRow * columns + mobileSelectionBaseRange.startColumn;
    const baseEnd = mobileSelectionBaseRange.endRow * columns + mobileSelectionBaseRange.endColumn;
    const target = position.bufferRow * columns + targetColumn;
    const selectionStart = target < baseStart ? target : baseStart;
    const selectionEnd = target < baseStart ? baseEnd : Math.max(baseEnd, target + 1);
    terminal.select(
      selectionStart % columns,
      Math.floor(selectionStart / columns),
      Math.max(1, selectionEnd - selectionStart),
    );
    mobileClipboardMenu.value.hasSelection = terminal.hasSelection();
    syncMobileSelectionHandles();
  };

  const openMobileClipboardMenu = (clientX: number, clientY: number): void => {
    if (!wrapper.value || !terminal) return;
    const rect = wrapper.value.getBoundingClientRect();
    const width = 190;
    mobileClipboardMenu.value = {
      visible: true,
      x: Math.max(8, Math.min(rect.width - width - 8, clientX - rect.left - width / 2)),
      y: Math.max(8, Math.min(rect.height - 52, clientY - rect.top - 58)),
      hasSelection: terminal.hasSelection(),
    };
  };

  const triggerMobileLongPress = (clientX: number, clientY: number): void => {
    if (!terminal || !device.isMobile.value) return;
    resetMobileTouchScroll();
    mobileLongPressTriggered = true;
    mobileTouchSelectionActive = true;
    suppressMobileContextMenuUntil = Date.now() + 1200;
    suppressMobileSoftKeyboard();
    selectTerminalWordAtPoint(clientX, clientY);
    captureMobileSelectionBaseRange();
    syncMobileSelectionHandles();
    mobileSelectionLastPoint = { x: clientX, y: clientY };
    mobileClipboardMenu.value.visible = false;
    navigator.vibrate?.(12);
  };

  const handleSelectionHandlePointerDown = (handle: 'start' | 'end', event: PointerEvent): void => {
    if (!terminal?.hasSelection()) return;
    const range = terminal.getSelectionPosition();
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    suppressMobileContextMenuUntil = Date.now() + 1200;
    mobileClipboardMenu.value.visible = false;
    suppressMobileSoftKeyboard();
    const columns = terminal.cols;
    mobileSelectionHandleDrag = {
      pointerId: event.pointerId,
      anchorBoundary:
        handle === 'start' ? range.end.y * columns + range.end.x : range.start.y * columns + range.start.x,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const handleSelectionHandlePointerMove = (event: PointerEvent): void => {
    if (!terminal || !mobileSelectionHandleDrag || mobileSelectionHandleDrag.pointerId !== event.pointerId) return;
    const position = getTerminalCellAtPoint(event.clientX, event.clientY);
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    let targetColumn = position.column;
    const line = terminal.buffer.active.getLine(position.bufferRow);
    while (targetColumn > 0 && line?.getCell(targetColumn)?.getWidth() === 0) targetColumn -= 1;
    const target = position.bufferRow * terminal.cols + targetColumn;
    const anchor = mobileSelectionHandleDrag.anchorBoundary;
    mobileSelectionHandleDrag.lastClientX = event.clientX;
    mobileSelectionHandleDrag.lastClientY = event.clientY;
    if (target < anchor) selectMobileRange(target, anchor);
    else selectMobileRange(anchor, target + 1);
  };

  const finishSelectionHandleDrag = (event: PointerEvent): void => {
    const drag = mobileSelectionHandleDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    const point =
      event.type === 'pointerup'
        ? { x: event.clientX, y: event.clientY }
        : { x: drag.lastClientX, y: drag.lastClientY };
    mobileSelectionHandleDrag = null;
    suppressMobileContextMenuUntil = Date.now() + 800;
    syncMobileSelectionHandles();
    openMobileClipboardMenu(point.x, point.y);
  };

  const copyMobileSelection = async (): Promise<void> => {
    await copySelection();
    mobileTouchSelectionActive = false;
    hideMobileSelectionHandles();
    mobileClipboardMenu.value.visible = false;
    restoreMobileSoftKeyboard(false);
  };

  const pasteMobileClipboard = async (): Promise<void> => {
    await paste();
    terminal?.clearSelection();
    mobileTouchSelectionActive = false;
    hideMobileSelectionHandles();
    mobileClipboardMenu.value.visible = false;
    restoreMobileSoftKeyboard(true);
  };

  const selectAllMobile = (): void => {
    terminal?.selectAll();
    mobileTouchSelectionActive = true;
    captureMobileSelectionBaseRange();
    mobileClipboardMenu.value.hasSelection = terminal?.hasSelection() ?? false;
    syncMobileSelectionHandles();
  };

  const handleDocumentPointerDown = (event: PointerEvent): void => {
    if (!mobileClipboardMenu.value.visible) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.mobile-terminal-clipboard-menu, .mobile-terminal-selection-handle')
    )
      return;
    closeMobileClipboardMenu(true);
    restoreMobileSoftKeyboard(false);
  };

  const handleContextMenu = async (event: MouseEvent): Promise<void> => {
    if (device.isMobile.value) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < suppressMobileContextMenuUntil || mobileClipboardMenu.value.visible) return;
      mobileTouchSelectionActive = true;
      suppressMobileSoftKeyboard();
      selectTerminalWordAtPoint(event.clientX, event.clientY);
      captureMobileSelectionBaseRange();
      syncMobileSelectionHandles();
      openMobileClipboardMenu(event.clientX, event.clientY);
      return;
    }
    if (!props.rightClickCopyPaste) return;
    event.preventDefault();
    if (terminal?.hasSelection()) {
      try {
        await copySelection();
        terminal.clearSelection();
        terminal.focus();
      } catch {
        // Clipboard availability is browser-controlled.
      }
      return;
    }
    try {
      await paste();
      terminal?.focus();
    } catch {
      // Clipboard permissions are browser-controlled.
    }
  };

  const resolveWheelScale = createWheelScaleResolver({
    min: 8,
    max: 40,
    step: 1,
    thresholdPx: 72,
    maxStepsPerEvent: 3,
    stopImmediatePropagation: true,
  });
  let pinchStartDistance = 0;
  let pinchStartFontSize = renderedFontSize.value;
  const touchDistance = (touches: TouchList) => {
    if (touches.length < 2) return 0;
    const first = touches[0]!;
    const second = touches[1]!;
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  };
  const applyFontSize = (size: number) => {
    const next = Math.min(40, Math.max(8, Math.round(size)));
    if (next === renderedFontSize.value) return;
    renderedFontSize.value = next;
    if (terminal) {
      terminal.options.fontSize = next;
      fitAndResize();
    }
    emit('fontSizeChange', next);
  };
  const handleWheelScale = (event: WheelEvent) => {
    const change = resolveWheelScale(event, renderedFontSize.value);
    if (change) {
      applyFontSize(change.next);
      return;
    }
    if (event.deltaY < 0 && (terminal?.buffer.active.viewportY ?? Number.POSITIVE_INFINITY) <= historyLoadThreshold()) {
      void loadPreviousOutput();
    }
  };
  const handleTouchStart = (event: TouchEvent) => {
    clearMobileLongPressTimer();
    if (event.touches.length === 1 && device.isMobile.value) {
      const touch = event.touches[0]!;
      mobileTouchScrollActive = false;
      mobileTouchScrollLastY = touch.clientY;
      mobileTouchScrollRemainder = 0;
      suppressMobileSoftKeyboard();
      closeMobileClipboardMenu(true);
      mobileLongPressTriggered = false;
      mobileTouchMoved = false;
      mobileGestureHadMultipleTouches = false;
      mobileSelectionBaseRange = null;
      mobileSelectionLastPoint = { x: touch.clientX, y: touch.clientY };
      mobileLongPressStart = { x: touch.clientX, y: touch.clientY };
      mobileLongPressTimer = window.setTimeout(() => {
        mobileLongPressTimer = null;
        if (mobileLongPressStart) triggerMobileLongPress(mobileLongPressStart.x, mobileLongPressStart.y);
      }, MOBILE_LONG_PRESS_DELAY);
      return;
    }
    mobileLongPressStart = null;
    resetMobileTouchScroll();
    if (event.touches.length !== 2) return;
    if (device.isMobile.value) {
      mobileGestureHadMultipleTouches = true;
      suppressMobileSoftKeyboard();
    }
    event.preventDefault();
    pinchStartDistance = touchDistance(event.touches);
    pinchStartFontSize = renderedFontSize.value;
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length === 1 && device.isMobile.value) {
      const touch = event.touches[0]!;
      if (mobileLongPressStart) {
        const moved = Math.hypot(touch.clientX - mobileLongPressStart.x, touch.clientY - mobileLongPressStart.y);
        if (moved > MOBILE_LONG_PRESS_MOVE_TOLERANCE) mobileTouchMoved = true;
        if (mobileLongPressTriggered) {
          event.preventDefault();
          updateMobileSelectionToPoint(touch.clientX, touch.clientY);
          mobileSelectionLastPoint = { x: touch.clientX, y: touch.clientY };
          return;
        }
        if (!mobileTouchMoved) return;
        clearMobileLongPressTimer();
        mobileLongPressStart = null;
        mobileTouchScrollActive = true;
      }
      if (mobileTouchScrollActive && mobileTouchScrollLastY !== null) {
        event.preventDefault();
        // Match native touch scrolling: the viewport moves opposite the finger delta so
        // terminal content tracks the finger on iOS and Android. xterm 6 no longer wires
        // touch gestures into its custom scrollable element, so keep this behavior explicit here.
        const deltaPixels = mobileTouchScrollLastY - touch.clientY;
        mobileTouchScrollLastY = touch.clientY;
        scrollTerminalFromMobileDrag(deltaPixels);
      }
      return;
    }
    if (event.touches.length !== 2 || pinchStartDistance <= 0) return;
    mobileGestureHadMultipleTouches = true;
    const distance = touchDistance(event.touches);
    if (!distance) return;
    event.preventDefault();
    applyFontSize(pinchStartFontSize * (distance / pinchStartDistance));
  };
  const handleTouchEnd = (event: TouchEvent) => {
    clearMobileLongPressTimer();
    mobileLongPressStart = null;
    if (mobileLongPressTriggered) {
      event.preventDefault();
      if (event.type === 'touchcancel') {
        closeMobileClipboardMenu(true);
        restoreMobileSoftKeyboard(false);
      } else {
        const touch = event.changedTouches[0];
        const point = touch ? { x: touch.clientX, y: touch.clientY } : mobileSelectionLastPoint;
        if (point) openMobileClipboardMenu(point.x, point.y);
        syncMobileSelectionHandles();
      }
      mobileLongPressTriggered = false;
    } else if (device.isMobile.value && event.touches.length === 0) {
      const shouldFocus = event.type !== 'touchcancel' && !mobileTouchMoved && !mobileGestureHadMultipleTouches;
      restoreMobileSoftKeyboard(shouldFocus);
    }
    mobileSelectionLastPoint = null;
    if (event.touches.length < 2) pinchStartDistance = 0;
    if (event.touches.length === 0) {
      mobileTouchMoved = false;
      mobileGestureHadMultipleTouches = false;
      resetMobileTouchScroll();
    }
  };

  const syncSearchDecorations = (): void => {
    if (!searchOpen.value || !searchAddon) return;
    if (!searchTerm.value) searchAddon.clearDecorations();
    else searchAddon.findNext(searchTerm.value, { incremental: true });
  };
  watch(searchTerm, syncSearchDecorations);
  watch(searchOpen, (open) => {
    if (!open) searchAddon?.clearDecorations();
    else syncSearchDecorations();
  });

  onMounted(() => {
    terminal = new Terminal({
      convertEol: true,
      scrollOnUserInput: true,
      cursorBlink: false,
      cursorStyle: 'block',
      cursorInactiveStyle: 'block',
      allowTransparency: true,
      fontFamily: props.fontFamily,
      fontSize: renderedFontSize.value,
      scrollback: props.scrollback,
      theme: resolvedTheme.value,
    });
    fit = new FitAddon();
    searchAddon = new SearchAddon();
    serializeAddon = new SerializeAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(searchAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.open(root.value!);
    historyLastViewportY = terminal.buffer.active.viewportY;
    const backgroundOsc = terminal.parser.registerOscHandler(11, (data) =>
      hasVisualBackground.value && data.trim() !== '?' ? true : false,
    );
    const backgroundResetOsc = terminal.parser.registerOscHandler(111, () => hasVisualBackground.value);
    cleanup.push(
      () => backgroundOsc.dispose(),
      () => backgroundResetOsc.dispose(),
    );
    if (terminalState.snapshot.value) terminal.write(terminalState.snapshot.value, syncSearchDecorations);
    else syncSearchDecorations();
    root.value!.addEventListener('wheel', handleWheelScale, { capture: true, passive: false });
    root.value!.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
    root.value!.addEventListener('touchmove', handleTouchMove, { passive: false });
    root.value!.addEventListener('touchend', handleTouchEnd, { passive: false });
    root.value!.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        const key = event.key.toLowerCase();
        if (key === 'c') {
          event.preventDefault();
          void copySelection();
          return false;
        }
        if (key === 'v') {
          event.preventDefault();
          void paste().catch(() => undefined);
          return false;
        }
      }
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        openSearch();
        return false;
      }
      if (event.type === 'keydown' && event.key === 'Escape' && searchOpen.value) {
        closeSearch();
        return false;
      }
      return true;
    });
    fitAndResize();
    cleanup.push(
      terminal.onData((data) => {
        emit('interaction');
        if (historyBrowsing || historyRebuilding) {
          void restoreLatestOutput().then(() => props.channel.sendInput(data));
          return;
        }
        void props.channel.sendInput(data);
      }).dispose,
      props.channel.onOutput(({ data }) => {
        activatePagedHistoryMode();
        if (historyBrowsing || historyRebuilding) {
          const shouldRestore = appendDeferredTerminalOutput(data);
          if (shouldRestore && historyBrowsing && !historyRebuilding) void restoreLatestOutput();
          return;
        }
        terminal?.write(data);
      }),
      props.channel.onClose((reason) => emit('closed', reason)),
      props.channel.onError((message) => emit('error', message)),
    );
    cleanup.push(
      terminal.onSelectionChange(() => {
        if (device.isMobile.value && mobileTouchSelectionActive) syncMobileSelectionHandles();
      }).dispose,
      terminal.onScroll((viewportY) => {
        const movedUp = viewportY < historyLastViewportY;
        const movedDown = viewportY > historyLastViewportY;
        historyLastViewportY = viewportY;
        if (!historyRebuilding) {
          activatePagedHistoryMode();
          if (historyBrowsing && movedDown && viewportY >= terminal!.buffer.active.baseY - historyLoadThreshold()) {
            void restoreLatestOutput();
          } else if (movedUp && viewportY <= historyLoadThreshold()) {
            void loadPreviousOutput();
          }
        }
        scheduleMobileSelectionSync();
      }).dispose,
    );
    root.value?.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(root.value!);
    emit('ready');
  });

  watch(
    () => [props.fontFamily, props.fontSize, resolvedTheme.value, props.scrollback] as const,
    () => {
      if (!terminal) return;
      terminal.options.fontFamily = props.fontFamily;
      if (props.fontSize !== renderedFontSize.value) renderedFontSize.value = props.fontSize;
      terminal.options.fontSize = renderedFontSize.value;
      terminal.options.theme = resolvedTheme.value;
      terminal.options.scrollback = historyBrowsing ? HISTORY_WINDOW_SCROLLBACK_LINES : liveScrollbackLimit();
      fitAndResize();
    },
    { deep: true },
  );

  onBeforeUnmount(() => {
    if (terminal && serializeAddon) terminalState.replaceSnapshot(liveReplaySnapshot());
    if (historyBrowsing) void props.channel.resetPreviousOutput?.().catch(() => false);
    if (root.value) {
      root.value.removeEventListener('wheel', handleWheelScale, true);
      root.value.removeEventListener('touchstart', handleTouchStart, true);
      root.value.removeEventListener('touchmove', handleTouchMove);
      root.value.removeEventListener('touchend', handleTouchEnd);
      root.value.removeEventListener('touchcancel', handleTouchEnd);
      root.value.removeEventListener('contextmenu', handleContextMenu);
    }
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    clearMobileLongPressTimer();
    if (mobileSelectionSyncFrame !== null) {
      window.cancelAnimationFrame(mobileSelectionSyncFrame);
      mobileSelectionSyncFrame = null;
    }
    hideMobileSelectionHandles();
    restoreMobileSoftKeyboard(false);
    resizeObserver?.disconnect();
    for (const stop of cleanup) stop();
    terminal?.dispose();
  });

  defineExpose({
    focus: () => terminal?.focus(),
    fit: fitAndResize,
    clear: clearTerminal,
    serialize: liveReplaySnapshot,
    openSearch,
    findNext,
    findPrevious,
    copySelection,
    paste,
    selectAll,
    scrollToBottom: () => void restoreLatestOutput(),
  });
</script>

<template>
  <div
    ref="wrapper"
    data-testid="terminal"
    class="relative h-full min-h-0 w-full overflow-hidden"
    :class="{ 'has-text-stroke': visual?.textStroke?.enabled, 'has-text-shadow': visual?.textShadow?.enabled }"
    :style="terminalStyle"
    :data-font-size="renderedFontSize"
  >
    <div
      v-if="visual?.backgroundEnabled && visual.backgroundImageUrl"
      class="terminal-background-image"
      :style="backgroundStyle"
    ></div>
    <div
      v-if="visual?.backgroundEnabled && visual.backgroundImageUrl"
      class="terminal-background-overlay"
      :style="{ backgroundColor: `rgba(0,0,0,${visual.backgroundOverlayOpacity ?? 0})` }"
    ></div>
    <iframe
      v-if="sandboxedCustomHtml"
      class="terminal-custom-html"
      sandbox="allow-scripts"
      :srcdoc="sandboxedCustomHtml"
      tabindex="-1"
      aria-hidden="true"
    ></iframe>
    <div
      ref="root"
      data-testid="terminal-inner"
      class="terminal-inner-container relative z-10 h-full min-h-0 w-full"
      :class="{ 'terminal-transparent': hasVisualBackground, 'terminal-mobile-touch': device.isMobile.value }"
      role="application"
      :aria-label="t('terminal.ariaLabel')"
    ></div>
    <template v-if="device.isMobile.value && mobileSelectionHandles.visible">
      <button
        v-show="mobileSelectionHandles.startVisible"
        type="button"
        class="mobile-terminal-selection-handle"
        :style="{ left: `${mobileSelectionHandles.start.x}px`, top: `${mobileSelectionHandles.start.y}px` }"
        :aria-label="t('terminal.mobile.adjustSelectionStart')"
        @pointerdown="handleSelectionHandlePointerDown('start', $event)"
        @pointermove="handleSelectionHandlePointerMove"
        @pointerup="finishSelectionHandleDrag"
        @pointercancel="finishSelectionHandleDrag"
        @contextmenu.prevent
      ></button>
      <button
        v-show="mobileSelectionHandles.endVisible"
        type="button"
        class="mobile-terminal-selection-handle"
        :style="{ left: `${mobileSelectionHandles.end.x}px`, top: `${mobileSelectionHandles.end.y}px` }"
        :aria-label="t('terminal.mobile.adjustSelectionEnd')"
        @pointerdown="handleSelectionHandlePointerDown('end', $event)"
        @pointermove="handleSelectionHandlePointerMove"
        @pointerup="finishSelectionHandleDrag"
        @pointercancel="finishSelectionHandleDrag"
        @contextmenu.prevent
      ></button>
    </template>
    <div
      v-if="device.isMobile.value && mobileClipboardMenu.visible"
      class="mobile-terminal-clipboard-menu"
      :style="{ left: `${mobileClipboardMenu.x}px`, top: `${mobileClipboardMenu.y}px` }"
      @pointerdown.stop
      @click.stop
    >
      <button type="button" :disabled="!mobileClipboardMenu.hasSelection" @click="copyMobileSelection">
        {{ t('terminal.mobile.copy') }}
      </button>
      <button type="button" @click="pasteMobileClipboard">{{ t('terminal.mobile.paste') }}</button>
      <button type="button" @click="selectAllMobile">{{ t('terminal.mobile.selectAll') }}</button>
    </div>
  </div>
</template>

<style scoped>
  .terminal-inner-container {
    box-sizing: border-box;
    padding: 4px 5px 3px;
  }

  .terminal-mobile-touch {
    touch-action: none;
  }
  .terminal-background-image,
  .terminal-background-overlay,
  .terminal-custom-html {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .terminal-background-image {
    z-index: 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
  }
  .terminal-background-overlay {
    z-index: 1;
  }
  .terminal-custom-html {
    z-index: 2;
    border: 0;
  }
  .terminal-inner-container :deep(.xterm-viewport) {
    overflow-y: auto;
  }

  .terminal-transparent :deep(.xterm),
  .terminal-transparent :deep(.xterm-viewport),
  .terminal-transparent :deep(.xterm-screen) {
    background-color: transparent !important;
  }
  .has-text-stroke :deep(.xterm-rows span),
  .has-text-stroke :deep(.xterm-rows div) {
    -webkit-text-stroke-width: var(--terminal-stroke-width);
    -webkit-text-stroke-color: var(--terminal-stroke-color);
    paint-order: stroke fill;
  }
  .has-text-shadow :deep(.xterm-rows span),
  .has-text-shadow :deep(.xterm-rows div) {
    text-shadow: var(--terminal-shadow);
  }

  .mobile-terminal-selection-handle {
    position: absolute;
    z-index: 31;
    width: 34px;
    height: 38px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    transform: translate(-50%, -7px);
    touch-action: none;
  }

  .mobile-terminal-selection-handle::before {
    position: absolute;
    top: 5px;
    left: 50%;
    width: 2px;
    height: 9px;
    border-radius: 999px;
    background: var(--link-active-color);
    content: '';
    transform: translateX(-50%);
  }

  .mobile-terminal-selection-handle::after {
    position: absolute;
    top: 12px;
    left: 50%;
    width: 15px;
    height: 15px;
    border: 2px solid color-mix(in srgb, var(--app-bg-color) 78%, transparent);
    border-radius: 50%;
    background: var(--link-active-color);
    box-shadow: 0 2px 7px rgb(0 0 0 / 35%);
    content: '';
    transform: translateX(-50%);
  }

  .mobile-terminal-clipboard-menu {
    position: absolute;
    z-index: 30;
    display: flex;
    align-items: center;
    min-width: 180px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 0.65rem;
    background: var(--app-bg-color);
    box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
    touch-action: manipulation;
  }

  .mobile-terminal-clipboard-menu button {
    flex: 1 1 0;
    min-width: 0;
    padding: 0.65rem 0.75rem;
    border: 0;
    border-right: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-color);
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .mobile-terminal-clipboard-menu button:last-child {
    border-right: 0;
  }

  .mobile-terminal-clipboard-menu button:active {
    background: var(--link-active-bg-color);
    color: var(--link-active-color);
  }

  .mobile-terminal-clipboard-menu button:disabled {
    opacity: 0.4;
  }
</style>
