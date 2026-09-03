<script setup lang="ts">
  import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick, watchEffect } from 'vue';
  import { Terminal, type ITheme, type ITerminalAddon, type IDisposable } from '@xterm/xterm';
  import { useDeviceDetection } from '../composables/useDeviceDetection';
  import { useAppearanceStore } from '../stores/appearance.store';
  import { useSettingsStore } from '../stores/settings.store';
  import { useSessionStore } from '../stores/session.store';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebLinksAddon } from '@xterm/addon-web-links';
  import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
  import { serializeTerminalSnapshot } from '../utils/terminalSnapshot';
  import '@xterm/xterm/css/xterm.css';
  import {
    useWorkspaceEventEmitter,
    useWorkspaceEventSubscriber,
    useWorkspaceEventOff,
  } from '../composables/workspaceEvents'; // +++ Import subscriber and off
  import { createWheelScaleResolver } from '@/foundation/interaction/wheelScale';
  import { createLatestValueSaver } from '@/foundation/async/latestValueSaver';

  // 定义 props 和 emits
  const props = defineProps<{
    sessionId: string; // 会话 ID
    isActive: boolean; // 标记此终端是否为活动标签页
    stream?: ReadableStream<string>; // 用于接收来自 WebSocket 的数据流 (可选)
    options?: object; // xterm 的配置选项
  }>();

  const emitWorkspaceEvent = useWorkspaceEventEmitter(); // +++ 获取事件发射器 +++
  const subscribeToWorkspaceEvent = useWorkspaceEventSubscriber(); // +++ 获取事件订阅器 +++
  const unsubscribeFromWorkspaceEvent = useWorkspaceEventOff(); // +++ 获取事件取消订阅器 +++

  const terminalRef = ref<HTMLElement | null>(null); // xterm 挂载点的引用 (内部容器)
  const terminalOuterWrapperRef = ref<HTMLElement | null>(null); // 最外层容器的引用，用于背景图
  let terminal: Terminal | null = null;
  let fitAddon: FitAddon | null = null;
  let searchAddon: SearchAddon | null = null; // *** 添加 searchAddon 变量 ***
  let resizeObserver: ResizeObserver | null = null;
  let observedElement: HTMLElement | null = null; // +++ Store the observed element +++
  let debounceTimer: number | null = null; // 用于防抖的计时器 ID
  let selectionListenerDisposable: IDisposable | null = null; // +++ 提升声明并添加类型 +++
  let scrollListenerDisposable: IDisposable | null = null;
  let backgroundColorOscDisposable: IDisposable | null = null;
  let backgroundColorResetOscDisposable: IDisposable | null = null;
  let terminalWheelHandler: ((event: WheelEvent) => void) | null = null;
  const terminalFontSizeSyncLocked = ref(false);
  const resolveTerminalWheelScale = createWheelScaleResolver({
    min: 8,
    max: 40,
    step: 1,
    precision: 0,
    thresholdPx: 72,
    // xterm installs its own wheel listener; capture + immediate stop ensures Ctrl+wheel
    // is exclusively a zoom gesture and never scrolls the terminal viewport as well.
    stopImmediatePropagation: true,
  });
  let lastResizeObserverWidth = 0;
  let lastResizeObserverHeight = 0;
  let lastEmittedCols = 0;
  let lastEmittedRows = 0;
  const RESIZE_THRESHOLD = 0.5; // px

  const { isMobile } = useDeviceDetection(); // 设备检测
  const { t } = useI18n();

  let initialPinchDistance = 0;
  let currentFontSizeOnPinchStart = 0;
  let mobileLongPressTimer: number | null = null;
  let mobileLongPressStart: { x: number; y: number } | null = null;
  let mobileLongPressTriggered = false;
  let mobileTouchSelectionActive = false;
  let mobileSelectionBaseRange: { startColumn: number; startRow: number; endColumn: number; endRow: number } | null =
    null;
  let mobileSelectionLastPoint: { x: number; y: number } | null = null;
  let mobileSelectionHandleDrag: {
    pointerId: number;
    anchorBoundary: number;
    lastClientX: number;
    lastClientY: number;
  } | null = null;
  let suppressMobileContextMenuUntil = 0;
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

  // --- Appearance Store ---
  const appearanceStore = useAppearanceStore();
  const {
    effectiveTerminalTheme,
    isTerminalBackgroundEnabled,
    terminalBackgroundImage,
    terminalCustomHTML,
    currentTerminalFontFamily,
    currentTerminalFontSize,
    // --- 文字描边和阴影状态 ---
    terminalTextStrokeEnabled,
    terminalTextStrokeWidth,
    terminalTextStrokeColor,
    terminalTextShadowEnabled,
    terminalTextShadowOffsetX,
    terminalTextShadowOffsetY,
    terminalTextShadowBlur,
    terminalTextShadowColor,
    initialAppearanceDataLoaded,
  } = storeToRefs(appearanceStore);

  const hasTerminalVisualBackground = computed(
    () => isTerminalBackgroundEnabled.value && Boolean(terminalBackgroundImage.value || terminalCustomHTML.value),
  );

  const resolveTerminalTheme = (theme: ITheme): ITheme =>
    hasTerminalVisualBackground.value
      ? { ...theme, background: 'rgba(0, 0, 0, 0)', cursor: '#ffffff', cursorAccent: '#000000' }
      : { ...theme, cursor: '#ffffff', cursorAccent: '#000000' };

  const isTerminalDomReady = ref(false);
  const renderedTerminalFontSize = ref<number | null>(null);

  // --- Settings Store ---
  const settingsStore = useSettingsStore(); // +++ 实例化设置 store +++
  const sessionStore = useSessionStore(); // +++ 实例化会话 store +++
  const { autoCopyOnSelectBoolean, terminalScrollbackLimitNumber, terminalEnableRightClickPasteBoolean } =
    storeToRefs(settingsStore);

  // 防抖函数
  const debounce = (func: Function, delay: number) => {
    let timeoutId: number | null = null; // Use a local variable for the timeout ID
    return (...args: any[]) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        func(...args);
        timeoutId = null;
      }, delay);
    };
  };

  const emitResizeIfChanged = (term: Terminal): boolean => {
    if (term.cols <= 0 || term.rows <= 0) return false;
    if (term.cols === lastEmittedCols && term.rows === lastEmittedRows) return false;
    lastEmittedCols = term.cols;
    lastEmittedRows = term.rows;
    emitWorkspaceEvent('terminal:resize', {
      sessionId: props.sessionId,
      dims: { cols: term.cols, rows: term.rows },
    });
    return true;
  };

  // 防抖处理由 ResizeObserver 触发的 resize 事件
  const debouncedEmitResize = debounce((term: Terminal) => {
    if (term && props.isActive) {
      // 仅当标签仍处于活动状态时才发送防抖后的 resize
      emitResizeIfChanged(term);
    }
  }, 150); // 150ms 防抖延迟

  // 立即执行 Fit 并发送 Resize 的函数
  const fitAndEmitResizeNow = (term: Terminal) => {
    // terminalRef 现在指向内部容器，检查它即可
    if (!term || !terminalRef.value) return;
    try {
      // 确保容器可见且有尺寸
      if (terminalRef.value.offsetHeight > 0 && terminalRef.value.offsetWidth > 0) {
        fitAddon?.fit();
        emitResizeIfChanged(term);
        // 发出稳定尺寸事件
        if (terminalRef.value) {
          const stableWidth = terminalRef.value.offsetWidth;
          const stableHeight = terminalRef.value.offsetHeight;
          emitWorkspaceEvent('terminal:stabilizedResize', {
            sessionId: props.sessionId,
            width: stableWidth,
            height: stableHeight,
          });
        }
      } else {
        console.log(
          `[Terminal ${props.sessionId}] Immediate fit skipped (container not visible or has no dimensions).`,
        );
      }
    } catch (e) {
      console.warn('Immediate fit/resize failed:', e);
    }
  };

  // Ctrl+wheel / pinch 会先即时更新 xterm，再由 foundation saver 串行持久化最新字号。
  const terminalFontSizeSaver = createLatestValueSaver<number>({
    delayMs: 500,
    save: async (size) => {
      if (isMobile.value) {
        await appearanceStore.setTerminalFontSizeMobile(size);
        console.log(`[Terminal ${props.sessionId}] MOBILE font size saved: ${size}`);
      } else {
        await appearanceStore.setTerminalFontSize(size);
        console.log(`[Terminal ${props.sessionId}] DESKTOP font size saved: ${size}`);
      }
    },
    onPendingChange: (pending) => {
      terminalFontSizeSyncLocked.value = pending;
      if (pending || !terminal) return;

      const persistedSize = currentTerminalFontSize.value;
      const renderedSize = terminal.options.fontSize ?? renderedTerminalFontSize.value;
      if (persistedSize !== renderedSize) {
        terminal.options.fontSize = persistedSize;
        renderedTerminalFontSize.value = persistedSize;
        fitAndEmitResizeNow(terminal);
      }
    },
    onError: (error) => console.error(`[Terminal ${props.sessionId}] Font size save failed:`, error),
  });

  //  Helper function to convert setting value to xterm scrollback value
  const getScrollbackValue = (limit: number): number => {
    const DEFAULT_SCROLLBACK_LINES = 5000;
    const MAX_SCROLLBACK_LINES = 100000;
    if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_SCROLLBACK_LINES;
    return Math.min(Math.floor(limit), MAX_SCROLLBACK_LINES);
  };

  const captureTerminalSnapshot = (term: Terminal): string | undefined => {
    return serializeTerminalSnapshot(term);
  };

  // --- 右键复制 / 粘贴功能 ---
  const handleContextMenuPaste = async (event: MouseEvent) => {
    event.preventDefault(); // 阻止默认右键菜单
    if (!terminal) return;

    // 手机端使用专门的长按菜单，避免 contextmenu 事件直接触发粘贴。
    if (isMobile.value) return;

    try {
      // 有选区时本次右键只复制；清除选区后，下一次右键才执行粘贴。
      if (terminal.hasSelection()) {
        const selectedText = terminal.getSelection();
        if (selectedText) await navigator.clipboard.writeText(selectedText);
        terminal.clearSelection();
        terminal.focus();
        return;
      }

      const text = await navigator.clipboard.readText();
      if (text) {
        const processedText = text.replace(/\r\n?/g, '\n');
        // 交给 xterm 处理 bracketed-paste，避免控制序列作为普通字符显示。
        terminal.paste(processedText);
        terminal.focus();
      }
    } catch (err) {
      console.error('[Terminal] Failed to copy/paste via Right Click:', err);
    }
  };

  const addContextMenuListener = () => {
    if (terminalRef.value) {
      terminalRef.value.addEventListener('contextmenu', handleContextMenuPaste);
    }
  };

  const removeContextMenuListener = () => {
    if (terminalRef.value) {
      terminalRef.value.removeEventListener('contextmenu', handleContextMenuPaste);
    }
  };

  const clearMobileLongPressTimer = () => {
    if (mobileLongPressTimer !== null) {
      window.clearTimeout(mobileLongPressTimer);
      mobileLongPressTimer = null;
    }
  };

  const hideMobileSelectionHandles = () => {
    mobileSelectionHandles.value.visible = false;
    mobileSelectionHandles.value.startVisible = false;
    mobileSelectionHandles.value.endVisible = false;
    mobileSelectionHandleDrag = null;
  };

  const closeMobileClipboardMenu = (clearSelection = false) => {
    mobileClipboardMenu.value.visible = false;
    if (clearSelection) {
      terminal?.clearSelection();
      mobileSelectionBaseRange = null;
      mobileTouchSelectionActive = false;
      hideMobileSelectionHandles();
    }
  };

  const blurMobileTerminalInput = () => {
    terminal?.blur();
    terminal?.textarea?.blur();
  };

  const getTerminalCellAtPoint = (clientX: number, clientY: number) => {
    if (!terminal?.element) return null;
    const screenElement = terminal.element.querySelector<HTMLElement>('.xterm-screen');
    if (!screenElement) return null;

    const rect = screenElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const column = Math.max(
      0,
      Math.min(terminal.cols - 1, Math.floor((clientX - rect.left) / (rect.width / terminal.cols))),
    );
    const viewportRow = Math.max(
      0,
      Math.min(terminal.rows - 1, Math.floor((clientY - rect.top) / (rect.height / terminal.rows))),
    );
    return {
      column,
      bufferRow: terminal.buffer.active.viewportY + viewportRow,
    };
  };

  const selectTerminalWordAtPoint = (clientX: number, clientY: number): boolean => {
    if (!terminal) return false;
    const position = getTerminalCellAtPoint(clientX, clientY);
    if (!position) return false;

    const line = terminal.buffer.active.getLine(position.bufferRow);
    if (!line) return false;

    const hasTextAtColumn = (column: number): boolean => {
      const chars = line.getCell(column)?.getChars() ?? '';
      return chars.length > 0 && !/^\s+$/u.test(chars);
    };

    let selectedColumn = position.column;
    // 宽字符的后半格没有 chars，向左寻找真实字符单元格。
    while (selectedColumn > 0 && !hasTextAtColumn(selectedColumn) && line.getCell(selectedColumn)?.getWidth() === 0) {
      selectedColumn -= 1;
    }

    if (!hasTextAtColumn(selectedColumn)) {
      terminal.selectLines(position.bufferRow, position.bufferRow);
      return terminal.hasSelection();
    }

    let startColumn = selectedColumn;
    let endColumn = selectedColumn;
    while (startColumn > 0 && hasTextAtColumn(startColumn - 1)) startColumn -= 1;
    while (endColumn + 1 < terminal.cols && hasTextAtColumn(endColumn + 1)) endColumn += 1;

    terminal.select(startColumn, position.bufferRow, endColumn - startColumn + 1);
    return terminal.hasSelection();
  };

  const captureMobileSelectionBaseRange = () => {
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

  const syncMobileSelectionHandles = () => {
    if (!terminal || !terminalOuterWrapperRef.value || !mobileTouchSelectionActive || !terminal.hasSelection()) {
      hideMobileSelectionHandles();
      return;
    }

    const range = terminal.getSelectionPosition();
    const screenElement = terminal.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!range || !screenElement) {
      hideMobileSelectionHandles();
      return;
    }

    const screenRect = screenElement.getBoundingClientRect();
    const wrapperRect = terminalOuterWrapperRef.value.getBoundingClientRect();
    if (screenRect.width <= 0 || screenRect.height <= 0 || terminal.cols <= 0 || terminal.rows <= 0) {
      hideMobileSelectionHandles();
      return;
    }

    const cellWidth = screenRect.width / terminal.cols;
    const cellHeight = screenRect.height / terminal.rows;
    const viewportY = terminal.buffer.active.viewportY;
    const startViewportRow = range.start.y - viewportY;
    const endViewportRow = range.end.y - viewportY;
    const handleRadius = 15;
    const toWrapperPoint = (column: number, viewportRow: number) => ({
      x: Math.max(
        handleRadius,
        Math.min(wrapperRect.width - handleRadius, screenRect.left - wrapperRect.left + column * cellWidth),
      ),
      y: Math.max(
        handleRadius,
        Math.min(wrapperRect.height - handleRadius, screenRect.top - wrapperRect.top + (viewportRow + 1) * cellHeight),
      ),
    });

    mobileSelectionHandles.value = {
      visible: true,
      startVisible: startViewportRow >= 0 && startViewportRow < terminal.rows,
      endVisible: endViewportRow >= 0 && endViewportRow < terminal.rows,
      start: toWrapperPoint(range.start.x, startViewportRow),
      end: toWrapperPoint(range.end.x, endViewportRow),
    };
  };

  const selectMobileRangeByFlatBoundaries = (startBoundary: number, endBoundary: number) => {
    if (!terminal) return;
    const columns = terminal.cols;
    const startRow = Math.floor(startBoundary / columns);
    const startColumn = startBoundary % columns;
    terminal.select(startColumn, startRow, Math.max(1, endBoundary - startBoundary));
    captureMobileSelectionBaseRange();
    mobileClipboardMenu.value.hasSelection = terminal.hasSelection();
    syncMobileSelectionHandles();
  };

  const updateMobileSelectionToPoint = (clientX: number, clientY: number) => {
    if (!terminal || !mobileSelectionBaseRange) return;
    const position = getTerminalCellAtPoint(clientX, clientY);
    if (!position) return;

    let targetColumn = position.column;
    const targetLine = terminal.buffer.active.getLine(position.bufferRow);
    // 拖到宽字符后半格时，将选区落到完整字符的起始单元格。
    while (targetColumn > 0 && targetLine?.getCell(targetColumn)?.getWidth() === 0) targetColumn -= 1;

    const columns = terminal.cols;
    const baseStart = mobileSelectionBaseRange.startRow * columns + mobileSelectionBaseRange.startColumn;
    const baseEnd = mobileSelectionBaseRange.endRow * columns + mobileSelectionBaseRange.endColumn;
    const target = position.bufferRow * columns + targetColumn;

    const selectionStart = target < baseStart ? target : baseStart;
    const selectionEnd = target < baseStart ? baseEnd : Math.max(baseEnd, target + 1);
    const startRow = Math.floor(selectionStart / columns);
    const startColumn = selectionStart % columns;
    terminal.select(startColumn, startRow, Math.max(1, selectionEnd - selectionStart));
    mobileClipboardMenu.value.hasSelection = terminal.hasSelection();
    syncMobileSelectionHandles();
  };

  const handleMobileSelectionHandlePointerDown = (handle: 'start' | 'end', event: PointerEvent) => {
    if (!terminal || !terminal.hasSelection()) return;
    const range = terminal.getSelectionPosition();
    if (!range) return;

    event.preventDefault();
    event.stopPropagation();
    blurMobileTerminalInput();
    suppressMobileContextMenuUntil = Date.now() + 1200;
    mobileClipboardMenu.value.visible = false;

    const columns = terminal.cols;
    mobileSelectionHandleDrag = {
      pointerId: event.pointerId,
      anchorBoundary:
        handle === 'start' ? range.end.y * columns + range.end.x : range.start.y * columns + range.start.x,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
    };
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  };

  const handleMobileSelectionHandlePointerMove = (event: PointerEvent) => {
    if (!terminal || !mobileSelectionHandleDrag || mobileSelectionHandleDrag.pointerId !== event.pointerId) return;
    const position = getTerminalCellAtPoint(event.clientX, event.clientY);
    if (!position) return;

    event.preventDefault();
    event.stopPropagation();
    let targetColumn = position.column;
    const targetLine = terminal.buffer.active.getLine(position.bufferRow);
    while (targetColumn > 0 && targetLine?.getCell(targetColumn)?.getWidth() === 0) targetColumn -= 1;
    const targetCell = position.bufferRow * terminal.cols + targetColumn;
    const anchor = mobileSelectionHandleDrag.anchorBoundary;
    mobileSelectionHandleDrag.lastClientX = event.clientX;
    mobileSelectionHandleDrag.lastClientY = event.clientY;
    if (targetCell < anchor) {
      selectMobileRangeByFlatBoundaries(targetCell, anchor);
    } else {
      selectMobileRangeByFlatBoundaries(anchor, targetCell + 1);
    }
  };

  const finishMobileSelectionHandleDrag = (event: PointerEvent) => {
    if (!mobileSelectionHandleDrag || mobileSelectionHandleDrag.pointerId !== event.pointerId) return;
    const menuPoint =
      event.type === 'pointerup'
        ? { x: event.clientX, y: event.clientY }
        : { x: mobileSelectionHandleDrag.lastClientX, y: mobileSelectionHandleDrag.lastClientY };
    event.preventDefault();
    event.stopPropagation();
    const handleElement = event.currentTarget as HTMLElement | null;
    if (handleElement?.hasPointerCapture?.(event.pointerId)) {
      handleElement.releasePointerCapture(event.pointerId);
    }
    mobileSelectionHandleDrag = null;
    suppressMobileContextMenuUntil = Date.now() + 800;
    blurMobileTerminalInput();
    syncMobileSelectionHandles();
    openMobileClipboardMenu(menuPoint.x, menuPoint.y);
  };

  function openMobileClipboardMenu(clientX: number, clientY: number) {
    if (!terminalOuterWrapperRef.value || !terminal) return;
    const wrapperRect = terminalOuterWrapperRef.value.getBoundingClientRect();
    const estimatedMenuWidth = 190;
    const relativeX = Math.max(
      8,
      Math.min(wrapperRect.width - estimatedMenuWidth - 8, clientX - wrapperRect.left - estimatedMenuWidth / 2),
    );
    const relativeY = Math.max(8, Math.min(wrapperRect.height - 48, clientY - wrapperRect.top - 56));
    mobileClipboardMenu.value = {
      visible: true,
      x: relativeX,
      y: relativeY,
      hasSelection: terminal.hasSelection(),
    };
  }

  const triggerMobileLongPress = (clientX: number, clientY: number) => {
    if (!terminal || !props.isActive) return;
    mobileLongPressTriggered = true;
    mobileTouchSelectionActive = true;
    suppressMobileContextMenuUntil = Date.now() + 1200;
    blurMobileTerminalInput();
    selectTerminalWordAtPoint(clientX, clientY);
    captureMobileSelectionBaseRange();
    syncMobileSelectionHandles();
    mobileSelectionLastPoint = { x: clientX, y: clientY };
    // 手指松开后再显示菜单，按住拖动期间专注调整选区。
    mobileClipboardMenu.value.visible = false;
    navigator.vibrate?.(12);
  };

  const handleMobileContextMenu = (event: MouseEvent) => {
    if (!isMobile.value) return;
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < suppressMobileContextMenuUntil || mobileClipboardMenu.value.visible) return;
    mobileTouchSelectionActive = true;
    blurMobileTerminalInput();
    selectTerminalWordAtPoint(event.clientX, event.clientY);
    captureMobileSelectionBaseRange();
    syncMobileSelectionHandles();
    openMobileClipboardMenu(event.clientX, event.clientY);
  };

  const handleMobileSyntheticMouse = (event: MouseEvent) => {
    if (!isMobile.value) return;
    if (Date.now() >= suppressMobileContextMenuUntil && !mobileSelectionHandleDrag) return;
    event.preventDefault();
    event.stopPropagation();
    blurMobileTerminalInput();
  };

  const copyMobileTerminalSelection = async () => {
    const selectedText = terminal?.getSelection();
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      mobileTouchSelectionActive = false;
      hideMobileSelectionHandles();
      closeMobileClipboardMenu();
    } catch (error) {
      console.error('[Terminal] 手机端复制终端内容失败:', error);
    }
  };

  const pasteMobileTerminalClipboard = async () => {
    if (!terminal) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) terminal.paste(text.replace(/\r\n?/g, '\n'));
      terminal.clearSelection();
      mobileTouchSelectionActive = false;
      hideMobileSelectionHandles();
      closeMobileClipboardMenu();
      terminal.focus();
    } catch (error) {
      console.error('[Terminal] 手机端读取剪贴板失败:', error);
    }
  };

  const selectAllMobileTerminalContent = () => {
    if (!terminal) return;
    terminal.selectAll();
    mobileClipboardMenu.value.hasSelection = terminal.hasSelection();
    captureMobileSelectionBaseRange();
    syncMobileSelectionHandles();
  };

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!mobileClipboardMenu.value.visible) return;
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('.mobile-terminal-clipboard-menu, .mobile-terminal-selection-handle')
    )
      return;
    closeMobileClipboardMenu(true);
  };

  // --- 移动端模式下通过双指放大缩小终端字号 ---
  const getDistanceBetweenTouches = (touches: TouchList): number => {
    const touch1 = touches[0];
    const touch2 = touches[1];
    return Math.sqrt(Math.pow(touch2.clientX - touch1.clientX, 2) + Math.pow(touch2.clientY - touch1.clientY, 2));
  };

  const handleTouchStart = (event: TouchEvent) => {
    clearMobileLongPressTimer();
    if (event.touches.length === 1 && isMobile.value) {
      const touch = event.touches[0];
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
    if (event.touches.length === 2 && terminal) {
      event.preventDefault();
      initialPinchDistance = getDistanceBetweenTouches(event.touches);
      currentFontSizeOnPinchStart = terminal.options.fontSize || currentTerminalFontSize.value;
    }
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length === 1 && mobileLongPressStart) {
      const touch = event.touches[0];
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

    if (event.touches.length === 2 && terminal && initialPinchDistance > 0) {
      event.preventDefault();
      const currentDistance = getDistanceBetweenTouches(event.touches);
      if (currentDistance > 0) {
        const scale = currentDistance / initialPinchDistance;
        let newSize = Math.round(currentFontSizeOnPinchStart * scale);
        newSize = Math.max(8, Math.min(newSize, 72));

        const currentTerminalOptFontSize = terminal.options.fontSize ?? currentTerminalFontSize.value;
        if (newSize !== currentTerminalOptFontSize) {
          terminal.options.fontSize = newSize;
          renderedTerminalFontSize.value = newSize;
          fitAndEmitResizeNow(terminal);
          terminalFontSizeSaver.schedule(newSize);
        }
      }
    }
  };

  const handleTouchEnd = (event: TouchEvent) => {
    clearMobileLongPressTimer();
    mobileLongPressStart = null;
    if (mobileLongPressTriggered) {
      event.preventDefault();
      if (event.type === 'touchcancel') {
        closeMobileClipboardMenu(true);
      } else {
        const changedTouch = event.changedTouches[0];
        const menuPoint = changedTouch
          ? { x: changedTouch.clientX, y: changedTouch.clientY }
          : mobileSelectionLastPoint;
        if (menuPoint) openMobileClipboardMenu(menuPoint.x, menuPoint.y);
        syncMobileSelectionHandles();
      }
      mobileLongPressTriggered = false;
    }
    mobileSelectionLastPoint = null;
    if (event.touches.length < 2) {
      initialPinchDistance = 0; // Reset pinch distance
    }
  };

  // 初始化终端
  onMounted(() => {
    // xterm 挂载到 terminalRef (内部容器)
    if (terminalRef.value) {
      terminal = new Terminal({
        fontSize: currentTerminalFontSize.value,
        fontFamily: currentTerminalFontFamily.value, // 使用 store 中的字体设置
        rows: 24, // 初始行数
        cols: 80, // 初始列数
        disableStdin: false,
        convertEol: true,
        scrollback: getScrollbackValue(terminalScrollbackLimitNumber.value), //  Use setting from store
        scrollOnUserInput: true, // 输入时滚动到底部
        ...props.options, // 合并外部传入的选项
        // Keep the interactive caret stable and high-contrast across themes.
        cursorBlink: false,
        cursorStyle: 'block',
        cursorInactiveStyle: 'block',
        // 背景透明属于应用级约束，不能被会话 options 覆盖。
        allowTransparency: true,
        theme: resolveTerminalTheme(effectiveTerminalTheme.value),
      });
      renderedTerminalFontSize.value = terminal.options.fontSize ?? currentTerminalFontSize.value;

      // 某些远端 shell 会在连接后发送 OSC 11/111，把默认背景改成黑色。
      // 启用终端背景时拦截这两个序列，保留图片/HTML 主题的透明底层；查询
      // OSC 11;? 仍交给 xterm 正常响应。
      backgroundColorOscDisposable = terminal.parser.registerOscHandler(11, (data) => {
        if (!hasTerminalVisualBackground.value || data.trim() === '?') return false;
        return true;
      });
      backgroundColorResetOscDisposable = terminal.parser.registerOscHandler(
        111,
        () => hasTerminalVisualBackground.value,
      );

      // 注意: 终端数据的解码已在useSshTerminal.ts中进行处理

      // 加载插件
      fitAddon = new FitAddon();
      searchAddon = new SearchAddon(); // *** 创建 SearchAddon 实例 ***
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      terminal.loadAddon(searchAddon); // *** 加载 SearchAddon ***

      // 将终端附加到 DOM
      terminal.open(terminalRef.value);
      // terminal.open() 同步执行完毕后，可以认为 Xterm 已尝试附加到 DOM
      isTerminalDomReady.value = true; // +++ 直接在此处设置 DOM 准备就绪状态 +++
      console.log(`[Terminal ${props.sessionId}] Xterm open() called, considering DOM ready for initial style checks.`);

      // 适应容器大小
      fitAddon.fit();
      emitResizeIfChanged(terminal); // 触发初始 resize 事件

      // 监听用户输入
      terminal.onData((data) => {
        emitWorkspaceEvent('terminal:input', { sessionId: props.sessionId, data });
      });

      // 监听终端大小变化 (通过 ResizeObserver) - 主要处理浏览器窗口大小变化等
      // ResizeObserver 观察内部容器 terminalRef
      if (terminalRef.value) {
        observedElement = terminalRef.value;
        resizeObserver = new ResizeObserver((entries) => {
          if (!props.isActive || !terminal || !terminalRef.value) return;

          const entry = entries[0];
          const { height: rectHeight, width: rectWidth } = entry.contentRect;

          // --- 阈值判断逻辑 ---
          const widthChangedSignificantly = Math.abs(rectWidth - lastResizeObserverWidth) >= RESIZE_THRESHOLD;
          const heightChangedSignificantly = Math.abs(rectHeight - lastResizeObserverHeight) >= RESIZE_THRESHOLD;

          if (!widthChangedSignificantly && !heightChangedSignificantly) {
            return;
          }

          const roundedWidth = Math.round(rectWidth);
          const roundedHeight = Math.round(rectHeight);

          // 更新 lastResizeObserverWidth/Height 为取整后的值
          lastResizeObserverWidth = roundedWidth;
          lastResizeObserverHeight = roundedHeight;
          // --- 阈值判断逻辑结束 ---

          if (rectHeight > 0 && rectWidth > 0) {
            try {
              fitAddon?.fit();
              debouncedEmitResize(terminal); // This will log the cols/rows after debouncing
              emitWorkspaceEvent('terminal:stabilizedResize', {
                sessionId: props.sessionId,
                width: roundedWidth,
                height: roundedHeight,
              });
              syncMobileSelectionHandles();
            } catch (e) {
              console.warn(
                `[TerminalResizeObserver sessionId=${props.sessionId}] Fit addon or debouncedEmitResize failed:`,
                e,
              );
            }
          }
        });
        // Observe only if initially active (or becomes active later)
        if (props.isActive) {
          resizeObserver.observe(observedElement);
          console.log(`[Terminal ${props.sessionId}] Initial observe.`);
        }
      }

      // 监听 isActive prop 的变化
      watch(
        () => props.isActive,
        (newValue, oldValue) => {
          console.log(`[Terminal ${props.sessionId}] isActive changed from ${oldValue} to ${newValue}`);
          if (resizeObserver && observedElement) {
            if (newValue) {
              // --- Become Active ---
              console.log(`[Terminal ${props.sessionId}] Becoming active. Observing element and fitting.`);
              // Start observing
              try {
                resizeObserver.observe(observedElement);
              } catch (e) {
                console.warn(`[Terminal ${props.sessionId}] Error observing element:`, e);
              }
              // Perform fit after a delay to ensure visibility and layout stability
              nextTick(() => {
                setTimeout(() => {
                  // 检查内部容器 terminalRef
                  if (props.isActive && terminal && terminalRef.value && terminalRef.value.offsetHeight > 0) {
                    fitAndEmitResizeNow(terminal);
                    // Also ensure focus when becoming active
                    terminal.focus();
                  } else {
                    console.log(
                      `[Terminal ${props.sessionId}] Skipped delayed fit (inactive, destroyed, or not visible).`,
                    );
                  }
                }, 50); // 50ms delay
              });
            } else {
              // --- Become Inactive ---
              console.log(`[Terminal ${props.sessionId}] Becoming inactive. Unobserving element.`);
              closeMobileClipboardMenu(true);
              // Stop observing
              try {
                resizeObserver.unobserve(observedElement);
              } catch (e) {
                console.warn(`[Terminal ${props.sessionId}] Error unobserving element:`, e);
              }
            }
          } else {
            console.warn(
              `[Terminal ${props.sessionId}] Cannot handle isActive change: resizeObserver or observedElement missing.`,
            );
          }
        },
      );

      // 处理传入的数据流 (如果提供了 stream prop)
      watch(
        () => props.stream,
        async (newStream) => {
          if (newStream) {
            const reader = newStream.getReader();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (terminal && value) {
                  terminal.write(value); // 将流数据写入终端
                  // 移除此处不必要的 fit() 调用
                }
              }
            } catch (error) {
              console.error('读取终端流时出错:', error);
            } finally {
              reader.releaseLock();
            }
          }
        },
        { immediate: true },
      ); // 立即执行一次 watch

      // 触发 ready 事件，传递 sessionId, terminal 和 searchAddon 实例
      if (terminal) {
        emitWorkspaceEvent('terminal:ready', {
          sessionId: props.sessionId,
          terminal: terminal,
          searchAddon: searchAddon,
        });
      }

      // --- 监听并处理选中即复制 ---
      let currentSelection = ''; // 存储当前选区内容，避免重复复制空内容
      const handleSelectionChange = () => {
        // 手机长按拖选必须由用户点击“复制”确认，不受“选中即复制”设置影响。
        if (mobileTouchSelectionActive) return;
        if (terminal && autoCopyOnSelectBoolean.value) {
          const newSelection = terminal.getSelection();
          // 仅在选区内容发生变化且不为空时执行复制
          if (newSelection && newSelection !== currentSelection) {
            currentSelection = newSelection;
            navigator.clipboard
              .writeText(newSelection)
              .then(() => {})
              .catch((err) => {
                console.error('[Terminal] 自动复制到剪贴板失败:', err);
                // 可以在这里向用户显示一个短暂的错误提示
              });
          } else if (!newSelection) {
            // 如果新选区为空，重置 currentSelection
            currentSelection = '';
          }
        } else {
          // 如果设置关闭，也重置 currentSelection
          currentSelection = '';
        }
      };

      // 添加防抖以避免过于频繁地触发 handleSelectionChange
      const debouncedSelectionChange = debounce(handleSelectionChange, 50); // 50ms 防抖

      // 监听 xterm 的 selectionChange 事件
      selectionListenerDisposable = terminal.onSelectionChange(debouncedSelectionChange); // Assign to outer variable

      // 监听设置变化，如果关闭了自动复制，确保清除可能存在的旧选区状态
      watch(autoCopyOnSelectBoolean, (newValue) => {
        if (!newValue) {
          currentSelection = '';
        }
      });

      // --- 监听外观变化 ---
      watch(
        [effectiveTerminalTheme, hasTerminalVisualBackground],
        ([newTheme]) => {
          if (terminal) {
            console.log(`[Terminal ${props.sessionId}] 应用新终端主题 (effective)。`);
            terminal.options.theme = resolveTerminalTheme(newTheme);
            // 修改选项后需要刷新终端才能生效
            try {
              // 刷新整个视口
              terminal.refresh(0, terminal.rows - 1);
              console.log(`[Terminal ${props.sessionId}] 终端已刷新以应用新主题。`);
            } catch (e) {
              console.warn(`[Terminal ${props.sessionId}] 刷新终端以应用主题时出错:`, e);
            }
          }
        },
        { deep: true },
      );

      watch(currentTerminalFontFamily, (newFontFamily) => {
        if (terminal) {
          console.log(`[Terminal ${props.sessionId}] 应用新终端字体: ${newFontFamily}`);
          terminal.options.fontFamily = newFontFamily;
          // 字体变化可能影响尺寸，重新 fit
          fitAndEmitResizeNow(terminal);
        }
      });

      // 监听字体大小变化。Ctrl+wheel / pinch 本地缩放正在持久化时跳过反向同步，
      // 否则旧的 store 值会在请求完成前把 xterm 字号写回，表现为缩放回弹。
      watch(currentTerminalFontSize, (newSize) => {
        if (terminalFontSizeSyncLocked.value) return;
        if (terminal) {
          console.log(`[Terminal ${props.sessionId}] 应用新终端字体大小: ${newSize}`);
          terminal.options.fontSize = newSize;
          renderedTerminalFontSize.value = newSize;
          // 字体大小变化需要重新 fit
          fitAndEmitResizeNow(terminal);
        }
      });

      // 聚焦终端 (添加 null check)
      if (terminal) {
        terminal.focus();
      }

      // --- 添加 Ctrl+Shift+C/V 复制粘贴 ---
      if (terminal && terminal.textarea) {
        // 确保 terminal 和 textarea 存在
        terminal.textarea.addEventListener('keydown', async (event: KeyboardEvent) => {
          // Ctrl+Shift+C for Copy
          if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
            event.preventDefault(); // 阻止默认行为 (例如浏览器开发者工具)
            event.stopPropagation(); // 阻止事件冒泡
            const selection = terminal?.getSelection();
            if (selection) {
              try {
                await navigator.clipboard.writeText(selection);
                console.log('[Terminal] Copied via Ctrl+Shift+C:', selection);
              } catch (err) {
                console.error('[Terminal] Failed to copy via Ctrl+Shift+C:', err);
                // 可以考虑添加 UI 提示
              }
            }
          }
          // Ctrl+Shift+V for Paste
          else if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
            event.preventDefault();
            event.stopPropagation();
            try {
              const text = await navigator.clipboard.readText();
              if (text) {
                const processedText = text.replace(/\r\n?/g, '\n');
                emitWorkspaceEvent('terminal:input', { sessionId: props.sessionId, data: processedText });
              }
            } catch (err) {
              console.error('[Terminal] Failed to paste via Ctrl+Shift+V:', err);
              // 检查权限问题，例如 navigator.clipboard.readText 需要用户授权或安全上下文
              // 可以考虑添加 UI 提示
            }
          }
        });
      }

      // 根据初始设置添加监听器
      if (terminalEnableRightClickPasteBoolean.value) {
        addContextMenuListener();
      }

      // 监听设置变化
      watch(terminalEnableRightClickPasteBoolean, (newValue) => {
        if (newValue) {
          addContextMenuListener();
        } else {
          removeContextMenuListener();
        }
      });

      // Ctrl+wheel 使用与其他可缩放面板相同的离散步进累计器，
      // 过滤高分辨率触控板/鼠标产生的细碎 delta，避免字号来回抖动。
      if (terminalRef.value) {
        terminalWheelHandler = (event: WheelEvent) => {
          if (!terminal) return;
          const currentSize = terminal.options.fontSize ?? currentTerminalFontSize.value;
          const change = resolveTerminalWheelScale(event, currentSize);
          if (!change) return;

          terminal.options.fontSize = change.next;
          renderedTerminalFontSize.value = change.next;
          fitAndEmitResizeNow(terminal);
          terminalFontSizeSaver.schedule(change.next);
        };
        terminalRef.value.addEventListener('wheel', terminalWheelHandler, { passive: false, capture: true });
      }

      // Add touch listeners for pinch zoom on mobile
      if (isMobile.value && terminalRef.value && terminal) {
        console.log(`[Terminal ${props.sessionId}] Adding touch listeners for mobile pinch zoom.`);
        terminalRef.value.addEventListener('touchstart', handleTouchStart, { passive: false });
        terminalRef.value.addEventListener('touchmove', handleTouchMove, { passive: false });
        terminalRef.value.addEventListener('touchend', handleTouchEnd, { passive: false });
        terminalRef.value.addEventListener('touchcancel', handleTouchEnd, { passive: false }); // Also handle cancel
        terminalRef.value.addEventListener('contextmenu', handleMobileContextMenu);
        terminalRef.value.addEventListener('mousedown', handleMobileSyntheticMouse, true);
        terminalRef.value.addEventListener('click', handleMobileSyntheticMouse, true);
        scrollListenerDisposable = terminal.onScroll(() => {
          window.requestAnimationFrame(syncMobileSelectionHandles);
        });
        document.addEventListener('pointerdown', handleDocumentPointerDown);
      }
    }
  });

  // 组件卸载前清理资源
  onBeforeUnmount(() => {
    // Ensure observer is cleaned up
    if (resizeObserver && observedElement) {
      try {
        resizeObserver.unobserve(observedElement);
        console.log(`[Terminal ${props.sessionId}] Unobserved on unmount.`);
      } catch (e) {
        console.warn(`[Terminal ${props.sessionId}] Error unobserving on unmount:`, e);
      }
      resizeObserver.disconnect(); // Fully disconnect observer
      console.log(`[Terminal ${props.sessionId}] ResizeObserver disconnected.`);
    }
    resizeObserver = null;
    observedElement = null;

    backgroundColorOscDisposable?.dispose();
    backgroundColorOscDisposable = null;
    backgroundColorResetOscDisposable?.dispose();
    backgroundColorResetOscDisposable = null;

    if (terminal) {
      emitWorkspaceEvent('terminal:detached', {
        sessionId: props.sessionId,
        terminal,
        snapshot: captureTerminalSnapshot(terminal),
      });
      console.log(`[Terminal ${props.sessionId}] Disposing terminal instance.`);
      terminal.dispose();
      terminal = null;
    }

    // 在卸载前清理选择监听器
    if (selectionListenerDisposable) {
      selectionListenerDisposable.dispose();
    }
    if (scrollListenerDisposable) {
      scrollListenerDisposable.dispose();
      scrollListenerDisposable = null;
    }

    // 确保在卸载时移除右键监听器
    removeContextMenuListener();

    if (terminalRef.value && terminalWheelHandler) {
      terminalRef.value.removeEventListener('wheel', terminalWheelHandler, true);
      terminalWheelHandler = null;
    }
    // Preserve the last wheel/pinch value if the terminal unmounts during the debounce window.
    terminalFontSizeSaver.dispose({ flush: true });

    // Remove touch listeners on unmount
    if (isMobile.value && terminalRef.value) {
      console.log(`[Terminal ${props.sessionId}] Removing touch listeners.`);
      terminalRef.value.removeEventListener('touchstart', handleTouchStart);
      terminalRef.value.removeEventListener('touchmove', handleTouchMove);
      terminalRef.value.removeEventListener('touchend', handleTouchEnd);
      terminalRef.value.removeEventListener('touchcancel', handleTouchEnd);
      terminalRef.value.removeEventListener('contextmenu', handleMobileContextMenu);
      terminalRef.value.removeEventListener('mousedown', handleMobileSyntheticMouse, true);
      terminalRef.value.removeEventListener('click', handleMobileSyntheticMouse, true);
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    }
    clearMobileLongPressTimer();
    hideMobileSelectionHandles();
  });
  // 暴露 write 方法给父组件 (可选)
  const write = (data: string | Uint8Array) => {
    terminal?.write(data);
  };

  // *** 暴露搜索方法 ***
  const findNext = (term: string, options?: ISearchOptions): boolean => {
    if (searchAddon) {
      return searchAddon.findNext(term, options);
    }
    return false;
  };

  const findPrevious = (term: string, options?: ISearchOptions): boolean => {
    if (searchAddon) {
      return searchAddon.findPrevious(term, options);
    }
    return false;
  };

  const clearSearch = () => {
    searchAddon?.clearDecorations();
  };

  // +++  clear 方法 +++
  const clear = () => {
    terminal?.clear();
  };

  defineExpose({ write, findNext, findPrevious, clearSearch, clear }); // 暴露 clear 方法

  // --- 文字描边和阴影 ---
  const applyTerminalTextStyles = () => {
    if (terminalRef.value && terminal?.element) {
      const hostElement = terminalRef.value; // .terminal-inner-container

      // 清理类名
      hostElement.classList.remove('has-text-stroke', 'has-text-shadow');

      // 文字描边
      if (terminalTextStrokeEnabled.value) {
        hostElement.classList.add('has-text-stroke');
        hostElement.style.setProperty('--terminal-stroke-width', `${terminalTextStrokeWidth.value}px`);
        hostElement.style.setProperty('--terminal-stroke-color', terminalTextStrokeColor.value);
      } else {
        hostElement.style.removeProperty('--terminal-stroke-width');
        hostElement.style.removeProperty('--terminal-stroke-color');
      }

      // 文字阴影
      if (terminalTextShadowEnabled.value) {
        hostElement.classList.add('has-text-shadow');
        const shadowValue = `${terminalTextShadowOffsetX.value}px ${terminalTextShadowOffsetY.value}px ${terminalTextShadowBlur.value}px ${terminalTextShadowColor.value}`;
        hostElement.style.setProperty('--terminal-shadow', shadowValue);
      } else {
        hostElement.style.removeProperty('--terminal-shadow');
      }
      // console.log('[Terminal] Applied text styles. Stroke enabled:', terminalTextStrokeEnabled.value, 'Shadow enabled:', terminalTextShadowEnabled.value);
    }
  };

  // 监听文字描边和阴影设置的变化
  watch(
    [
      terminalTextStrokeEnabled,
      terminalTextStrokeWidth,
      terminalTextStrokeColor,
      terminalTextShadowEnabled,
      terminalTextShadowOffsetX,
      terminalTextShadowOffsetY,
      terminalTextShadowBlur,
      terminalTextShadowColor,
    ],
    () => {
      // console.log('[Terminal] Text style settings changed, applying new styles.');
      // 这个 watch 现在主要负责响应运行时的更改
      // 初始加载由下面的 watchEffect 处理
      if (isTerminalDomReady.value && initialAppearanceDataLoaded.value) {
        nextTick(() => {
          applyTerminalTextStyles();
        });
      }
    },
    { deep: true },
  );

  // watchEffect 用于处理初始样式应用 +++
  watchEffect(() => {
    if (isTerminalDomReady.value && initialAppearanceDataLoaded.value && terminalRef.value && terminal?.element) {
      console.log(
        `[Terminal ${props.sessionId}] Initial style application: DOM ready and appearance data loaded. Applying text styles.`,
      );
      nextTick(() => {
        applyTerminalTextStyles();
      });
    }
  });
</script>

<template>
  <div
    ref="terminalOuterWrapperRef"
    data-testid="terminal"
    :data-font-size="renderedTerminalFontSize ?? undefined"
    class="terminal-outer-wrapper"
  >
    <!-- xterm 实际挂载点 -->
    <div ref="terminalRef" class="terminal-inner-container"></div>
    <template v-if="isMobile && mobileSelectionHandles.visible">
      <button
        v-show="mobileSelectionHandles.startVisible"
        type="button"
        class="mobile-terminal-selection-handle mobile-terminal-selection-handle--start"
        :style="{ left: `${mobileSelectionHandles.start.x}px`, top: `${mobileSelectionHandles.start.y}px` }"
        :aria-label="t('workspace.terminal.mobileAdjustSelectionStart')"
        @pointerdown="handleMobileSelectionHandlePointerDown('start', $event)"
        @pointermove="handleMobileSelectionHandlePointerMove"
        @pointerup="finishMobileSelectionHandleDrag"
        @pointercancel="finishMobileSelectionHandleDrag"
        @contextmenu.prevent
      ></button>
      <button
        v-show="mobileSelectionHandles.endVisible"
        type="button"
        class="mobile-terminal-selection-handle mobile-terminal-selection-handle--end"
        :style="{ left: `${mobileSelectionHandles.end.x}px`, top: `${mobileSelectionHandles.end.y}px` }"
        :aria-label="t('workspace.terminal.mobileAdjustSelectionEnd')"
        @pointerdown="handleMobileSelectionHandlePointerDown('end', $event)"
        @pointermove="handleMobileSelectionHandlePointerMove"
        @pointerup="finishMobileSelectionHandleDrag"
        @pointercancel="finishMobileSelectionHandleDrag"
        @contextmenu.prevent
      ></button>
    </template>
    <div
      v-if="isMobile && mobileClipboardMenu.visible"
      class="mobile-terminal-clipboard-menu"
      :style="{ left: `${mobileClipboardMenu.x}px`, top: `${mobileClipboardMenu.y}px` }"
      @pointerdown.stop
      @click.stop
    >
      <button type="button" :disabled="!mobileClipboardMenu.hasSelection" @click="copyMobileTerminalSelection">
        {{ t('workspace.terminal.mobileCopy') }}
      </button>
      <button type="button" @click="pasteMobileTerminalClipboard">
        {{ t('workspace.terminal.mobilePaste') }}
      </button>
      <button type="button" @click="selectAllMobileTerminalContent">
        {{ t('workspace.terminal.mobileSelectAll') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
  .terminal-outer-wrapper {
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }

  .terminal-inner-container {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    padding: 4px 5px 3px;
    /* position: relative;  移除了 position relative */
    /* z-index 调整或移除，因为背景层不再在此组件内 */
  }

  .mobile-terminal-selection-handle {
    position: absolute;
    z-index: 31;
    width: 34px;
    height: 38px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    transform: translate(-50%, -7px);
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
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
    box-shadow: 0 2px 7px rgba(0, 0, 0, 0.35);
    content: '';
    transform: translateX(-50%);
  }

  .mobile-terminal-selection-handle:active::after {
    transform: translateX(-50%) scale(1.18);
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
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
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

  /* 文字描边和阴影样式 */
  .terminal-inner-container.has-text-stroke :deep(.xterm-rows span),
.terminal-inner-container.has-text-stroke :deep(.xterm-rows div > span), /* 更具体地针对嵌套 span */
.terminal-inner-container.has-text-stroke :deep(.xterm-rows div) {
    /* 针对直接包含文本的 div */
    -webkit-text-stroke-width: var(--terminal-stroke-width);
    -webkit-text-stroke-color: var(--terminal-stroke-color);
    text-stroke-width: var(--terminal-stroke-width);
    text-stroke-color: var(--terminal-stroke-color);
    /* 确保描边在填充之下，这样填充色仍然可见 */
    paint-order: stroke fill;
    -webkit-paint-order: stroke fill; /* 兼容 WebKit */
  }

  .terminal-inner-container.has-text-shadow :deep(.xterm-rows span),
  .terminal-inner-container.has-text-shadow :deep(.xterm-rows div > span),
  .terminal-inner-container.has-text-shadow :deep(.xterm-rows div) {
    text-shadow: var(--terminal-shadow);
  }

  /*
  移除以下样式，因为它依赖于本组件内部管理的 .has-terminal-background 类，
  该逻辑已移至 LayoutRenderer.vue
*/
</style>
