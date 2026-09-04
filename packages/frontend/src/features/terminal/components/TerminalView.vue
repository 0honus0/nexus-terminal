<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import { useI18n } from 'vue-i18n';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { SearchAddon } from '@xterm/addon-search';
  import { SerializeAddon } from '@xterm/addon-serialize';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { BaseButton, BaseInput } from '@/foundation/ui';
  import { focusRegistry } from '@/shared/focus/public';
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
  const searchPanel = ref<HTMLElement | null>(null);
  const searchOpen = terminalState.searchOpen;
  const searchTerm = terminalState.searchTerm;
  const renderedFontSize = ref(props.fontSize);
  let terminal: Terminal | undefined;
  let fit: FitAddon | undefined;
  let searchAddon: SearchAddon | undefined;
  let serializeAddon: SerializeAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const cleanup: Array<() => void> = [];
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
  let unregisterFocus: (() => void) | undefined;

  let lastColumns = 0;
  let lastRows = 0;
  const fitAndResize = () => {
    if (!terminal || !fit) return;
    fit.fit();
    if (terminal.cols === lastColumns && terminal.rows === lastRows) return;
    lastColumns = terminal.cols;
    lastRows = terminal.rows;
    void props.channel.resize({ columns: terminal.cols, rows: terminal.rows });
  };
  const focusSearch = () => void nextTick(() => searchPanel.value?.querySelector<HTMLInputElement>('input')?.focus());
  const openSearch = () => {
    searchOpen.value = true;
    focusSearch();
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
  const copySelection = async () => {
    if (terminal?.hasSelection()) await writeClipboardText(terminal.getSelection());
  };
  const paste = async () => {
    const text = await navigator.clipboard.readText();
    if (text) terminal?.paste(text.replace(/\r\n?/g, '\n'));
  };
  const selectAll = () => terminal?.selectAll();

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
  let mobileSelectionLastPoint: { x: number; y: number } | null = null;
  let mobileTouchSelectionActive = false;
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
    const width = 210;
    mobileClipboardMenu.value = {
      visible: true,
      x: Math.max(8, Math.min(rect.width - width - 8, clientX - rect.left - width / 2)),
      y: Math.max(8, Math.min(rect.height - 52, clientY - rect.top - 58)),
      hasSelection: terminal.hasSelection(),
    };
  };

  const triggerMobileLongPress = (clientX: number, clientY: number): void => {
    if (!terminal || !device.isMobile.value) return;
    mobileLongPressTriggered = true;
    mobileTouchSelectionActive = true;
    suppressMobileContextMenuUntil = Date.now() + 1200;
    terminal.blur();
    terminal.textarea?.blur();
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
    terminal.blur();
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
  };

  const pasteMobileClipboard = async (): Promise<void> => {
    await paste();
    terminal?.clearSelection();
    mobileTouchSelectionActive = false;
    hideMobileSelectionHandles();
    mobileClipboardMenu.value.visible = false;
    terminal?.focus();
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
  };

  const handleContextMenu = async (event: MouseEvent): Promise<void> => {
    if (device.isMobile.value) {
      event.preventDefault();
      event.stopPropagation();
      if (Date.now() < suppressMobileContextMenuUntil || mobileClipboardMenu.value.visible) return;
      mobileTouchSelectionActive = true;
      terminal?.blur();
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
    if (change) applyFontSize(change.next);
  };
  const handleTouchStart = (event: TouchEvent) => {
    clearMobileLongPressTimer();
    if (event.touches.length === 1 && device.isMobile.value) {
      const touch = event.touches[0]!;
      closeMobileClipboardMenu(true);
      mobileLongPressTriggered = false;
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
    if (event.touches.length !== 2) return;
    pinchStartDistance = touchDistance(event.touches);
    pinchStartFontSize = renderedFontSize.value;
  };
  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length === 1 && mobileLongPressStart) {
      const touch = event.touches[0]!;
      const moved = Math.hypot(touch.clientX - mobileLongPressStart.x, touch.clientY - mobileLongPressStart.y);
      if (mobileLongPressTriggered) {
        event.preventDefault();
        updateMobileSelectionToPoint(touch.clientX, touch.clientY);
        mobileSelectionLastPoint = { x: touch.clientX, y: touch.clientY };
      } else if (moved > MOBILE_LONG_PRESS_MOVE_TOLERANCE) {
        clearMobileLongPressTimer();
        mobileLongPressStart = null;
      }
      return;
    }
    if (event.touches.length !== 2 || pinchStartDistance <= 0) return;
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
      } else {
        const touch = event.changedTouches[0];
        const point = touch ? { x: touch.clientX, y: touch.clientY } : mobileSelectionLastPoint;
        if (point) openMobileClipboardMenu(point.x, point.y);
        syncMobileSelectionHandles();
      }
      mobileLongPressTriggered = false;
    }
    mobileSelectionLastPoint = null;
    if (event.touches.length < 2) pinchStartDistance = 0;
  };

  watch(searchTerm, (value) => {
    if (!searchOpen.value || !searchAddon) return;
    if (!value) searchAddon.clearDecorations();
    else searchAddon.findNext(value, { incremental: true });
  });

  onMounted(() => {
    unregisterFocus = focusRegistry.register(
      'terminalSearch',
      () => {
        openSearch();
        return true;
      },
      () => Boolean(wrapper.value?.getClientRects().length),
    );
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
    const backgroundOsc = terminal.parser.registerOscHandler(11, (data) =>
      hasVisualBackground.value && data.trim() !== '?' ? true : false,
    );
    const backgroundResetOsc = terminal.parser.registerOscHandler(111, () => hasVisualBackground.value);
    cleanup.push(
      () => backgroundOsc.dispose(),
      () => backgroundResetOsc.dispose(),
    );
    if (terminalState.snapshot.value) terminal.write(terminalState.snapshot.value);
    root.value!.addEventListener('wheel', handleWheelScale, { capture: true, passive: false });
    root.value!.addEventListener('touchstart', handleTouchStart, { passive: true });
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
        void props.channel.sendInput(data);
      }).dispose,
      props.channel.onOutput(({ data }) => {
        terminal?.write(data);
      }),
      props.channel.onClose((reason) => emit('closed', reason)),
      props.channel.onError((message) => emit('error', message)),
    );
    cleanup.push(
      terminal.onSelectionChange(() => {
        if (mobileTouchSelectionActive) syncMobileSelectionHandles();
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
      terminal.options.scrollback = props.scrollback;
      fitAndResize();
    },
    { deep: true },
  );

  onBeforeUnmount(() => {
    if (terminal && serializeAddon) terminalState.replaceSnapshot(serializeTerminalSnapshot(terminal, serializeAddon));
    unregisterFocus?.();
    if (root.value) {
      root.value.removeEventListener('wheel', handleWheelScale, true);
      root.value.removeEventListener('touchstart', handleTouchStart);
      root.value.removeEventListener('touchmove', handleTouchMove);
      root.value.removeEventListener('touchend', handleTouchEnd);
      root.value.removeEventListener('touchcancel', handleTouchEnd);
      root.value.removeEventListener('contextmenu', handleContextMenu);
    }
    document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    clearMobileLongPressTimer();
    hideMobileSelectionHandles();
    resizeObserver?.disconnect();
    for (const stop of cleanup) stop();
    terminal?.dispose();
  });

  defineExpose({
    focus: () => terminal?.focus(),
    fit: fitAndResize,
    clear: () => terminal?.clear(),
    serialize: () => (terminal && serializeAddon ? serializeTerminalSnapshot(terminal, serializeAddon) : ''),
    openSearch,
    findNext,
    findPrevious,
    copySelection,
    paste,
    selectAll,
    scrollToBottom: () => terminal?.scrollToBottom(),
  });
</script>

<template>
  <div
    ref="wrapper"
    data-testid="terminal"
    class="relative h-full min-h-0 w-full overflow-hidden bg-black"
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
      class="relative z-10 h-full min-h-0 w-full"
      :class="{ 'terminal-transparent': hasVisualBackground }"
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
    <div
      v-if="searchOpen"
      ref="searchPanel"
      class="absolute right-2 top-2 z-20 flex w-[min(28rem,calc(100%-1rem))] items-center gap-1 rounded border border-border bg-background/95 p-1 shadow-lg"
    >
      <BaseInput
        v-model="searchTerm"
        size="sm"
        :placeholder="t('terminal.search.placeholder')"
        @keyup.enter="findNext"
        @keyup.esc="closeSearch"
      />
      <BaseButton size="sm" :title="t('terminal.search.previous')" @click="findPrevious">↑</BaseButton>
      <BaseButton size="sm" :title="t('terminal.search.next')" @click="findNext">↓</BaseButton>
      <BaseButton size="sm" variant="ghost" :title="t('terminal.search.close')" @click="closeSearch">×</BaseButton>
    </div>
    <BaseButton
      v-else
      class="absolute right-2 top-2 z-20 opacity-60 hover:opacity-100"
      size="sm"
      variant="ghost"
      :title="t('terminal.search.open')"
      @click="openSearch"
      >⌕</BaseButton
    >
  </div>
</template>

<style scoped>
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
    min-width: 210px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 0.65rem;
    background: var(--app-bg-color);
    box-shadow: 0 8px 24px rgb(0 0 0 / 28%);
    touch-action: manipulation;
  }

  .mobile-terminal-clipboard-menu button {
    min-height: 44px;
    flex: 1 1 0;
    border: 0;
    border-right: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-color);
    padding: 0.65rem 0.75rem;
  }

  .mobile-terminal-clipboard-menu button:last-child {
    border-right: 0;
  }

  .mobile-terminal-clipboard-menu button:disabled {
    opacity: 0.45;
  }
</style>
