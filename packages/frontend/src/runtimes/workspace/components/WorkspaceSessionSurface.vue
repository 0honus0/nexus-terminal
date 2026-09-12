<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import {
    BaseButton,
    BaseCheckbox,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSelect,
    OverlayPanel,
  } from '@/foundation/ui';
  import { useDraggablePosition, usePersistentResizablePanel, useResizeHandle } from '@/foundation/interaction';
  import { useFeedback } from '@/shared/feedback/public';
  import { loadFilePreview, previewKindFor } from '@/features/file-preview/public';
  import { loadFileEditor, type FileEditorSessionController } from '@/features/file-editor/public';
  import { applyTerminalModifiers, type TerminalChannel, type TerminalVisualOptions } from '@/features/terminal/public';
  import {
    loadProgressCenter,
    loadSendFilesModal,
    loadUploadConflictModal,
    type ArchiveTransferErrorCode,
    type SendFileSourceItem,
  } from '@/features/transfers/public';
  import {
    loadFileManager,
    type ArchiveCompressionFormat,
    type ArchiveCompressionIntent,
    type LocalUploadFile,
    type RemoteFileEntry,
  } from '@/features/filesystem/public';
  import type { Connection } from '@/features/connections/public';
  import type { MarkedSuspendedSession, SuspendedSession } from '@/features/ssh-suspend/public';
  import type { WorkspaceRuntimeSession } from '../session';
  import type { WorkspaceLayoutNode, WorkspacePaneName, WorkspaceSidebarConfig } from '../layout/workspaceLayout';
  import WorkspaceLayoutRenderer from './WorkspaceLayoutRenderer.vue';
  import WorkspaceMobileTools from './WorkspaceMobileTools.vue';

  const FilePreview = defineAsyncComponent(loadFilePreview);
  const FileEditor = defineAsyncComponent(loadFileEditor);
  const FileManager = defineAsyncComponent(loadFileManager);
  const ProgressCenter = defineAsyncComponent(loadProgressCenter);
  const SendFilesModal = defineAsyncComponent(loadSendFilesModal);
  const UploadConflictModal = defineAsyncComponent(loadUploadConflictModal);

  interface TerminalApi {
    focus?: () => void;
    fit?: () => void;
    clear?: () => void;
    serialize?: () => string;
    copySelection?: () => Promise<void>;
    paste?: () => Promise<void>;
    selectAll?: () => void;
    openSearch?: () => void;
    findNext?: () => void;
    findPrevious?: () => void;
    scrollToBottom?: () => void;
  }
  interface EditorApi {
    open?: (path: string) => Promise<unknown> | unknown;
    focus?: () => void;
  }
  interface PreviewApi {
    open?: (path: string) => Promise<unknown> | unknown;
  }

  const props = defineProps<{
    active?: boolean;
    session: WorkspaceRuntimeSession;
    layout: WorkspaceLayoutNode;
    sidebars: WorkspaceSidebarConfig;
    terminalFontFamily?: string;
    terminalFontSize?: number;
    terminalTheme?: Record<string, string>;
    terminalVisual?: TerminalVisualOptions;
    terminalScrollback?: number;
    rightClickCopyPaste?: boolean;
    editorFontFamily?: string;
    editorFontSize?: number;
    mobileEditorFontSize?: number;
    commandInputSyncTarget?: import('@/features/preferences/public').Preferences['commandInputSyncTarget'];
    statusIntervalSeconds?: number;
    dockerIntervalSeconds?: number;
    dockerDefaultExpand?: boolean;
    statusScale?: number;
    statusShowIp?: boolean;
    mobile?: boolean;
    clipboardCount?: number;
    sharedEditorSession?: FileEditorSessionController;
    showPopupFileEditor?: boolean;
    showPopupFileManager?: boolean;
    fileManagerConfirmDelete?: boolean;
    quickCommandsCollapsibleSearch?: boolean;
    quickCommandsCompactMode?: boolean;
    showConnectionTags?: boolean;
    showQuickCommandTags?: boolean;
    sidebarPaneWidths?: Record<string, string>;
    sidebarPersistent?: boolean;
    fileManagerRowScale?: number;
    fileManagerColumnWidths?: Record<string, number>;
    spreadsheetRowsPerPage?: number;
    spreadsheetMaxColumns?: number;
    quickCommandRowScale?: number;
    progressVisible?: boolean;
    markedSuspendedSessions?: MarkedSuspendedSession[];
    layoutLocked?: boolean;
  }>();
  const emit = defineEmits<{
    openConnection: [connection: Connection];
    command: [command: string, allSessions: boolean];
    resumeSuspended: [session: SuspendedSession];
    resumeMarkedSuspended: [workspaceId: string];
    unmarkSuspended: [workspaceId: string];
    fileClipboardSet: [operation: 'copy' | 'cut', entries: RemoteFileEntry[]];
    fileClipboardPaste: [destination: string];
    serverTransferStarted: [];
    statusScale: [scale: number];
    sidebarWidth: [pane: WorkspacePaneName, width: string];
    terminalFontSize: [size: number];
    editorFontSize: [size: number];
    mobileEditorFontSize: [size: number];
    interaction: [];
    openSuspended: [];
    openFocusConfigurator: [];
    fileManagerRowScale: [scale: number];
    fileManagerColumnWidths: [widths: Record<string, number>];
    quickCommandRowScale: [scale: number];
    quickCommandCompactMode: [compact: boolean];
    progressVisible: [visible: boolean];
    layoutResize: [containerId: string, sizes: number[]];
  }>();
  const { t } = useI18n();
  const feedback = useFeedback();
  const transfers = props.session.transferController;
  const documentMode = ref<'editor' | 'preview'>('editor');
  const editorSession = computed(() => props.sharedEditorSession ?? props.session.editorController);
  const editorScopeLabel = computed(() => props.session.connection.name || props.session.connection.host);
  const showEditorScopeLabel = computed(() => Boolean(props.sharedEditorSession));
  const previewSession = props.session.previewController;
  const surfaceRoot = ref<HTMLElement | null>(null);
  const documentPopupVisible = ref(false);
  const documentPopupInitialized = ref(false);
  const fileManagerPopupVisible = ref(false);
  watch(documentPopupVisible, (visible) => {
    if (visible) documentPopupInitialized.value = true;
  });
  const FILE_MANAGER_POPUP_SIZE_KEY = 'nexus.file-manager.desktop-popup-size';
  const FILE_MANAGER_POPUP_DEFAULT_WIDTH = 896;
  const FILE_MANAGER_POPUP_MIN_WIDTH = 360;
  const FILE_MANAGER_POPUP_MIN_HEIGHT = 320;
  const fileManagerPopupAvailableWidth = () => Math.max(1, window.innerWidth - 32);
  const fileManagerPopupAvailableHeight = () => Math.max(1, window.innerHeight - 32);
  const fileManagerPopupResponsiveMinWidth = () =>
    Math.min(FILE_MANAGER_POPUP_MIN_WIDTH, fileManagerPopupAvailableWidth());
  const fileManagerPopupResponsiveMinHeight = () =>
    Math.min(FILE_MANAGER_POPUP_MIN_HEIGHT, fileManagerPopupAvailableHeight());
  const defaultFileManagerPopupSize = () => ({
    width: Math.min(FILE_MANAGER_POPUP_DEFAULT_WIDTH, fileManagerPopupAvailableWidth()),
    height: Math.min(
      Math.max(FILE_MANAGER_POPUP_MIN_HEIGHT, window.innerHeight * 0.85),
      fileManagerPopupAvailableHeight(),
    ),
  });
  const EDITOR_POPUP_SIZE_KEY = 'nexus.file-editor.desktop-popup-size';
  const EDITOR_POPUP_MIN_WIDTH = 400;
  const EDITOR_POPUP_MIN_HEIGHT = 300;
  const editorPopupAvailableWidth = () => Math.max(1, window.innerWidth - 24);
  const editorPopupAvailableHeight = () => Math.max(1, window.innerHeight - 24);
  const editorPopupResponsiveMinWidth = () => Math.min(EDITOR_POPUP_MIN_WIDTH, editorPopupAvailableWidth());
  const editorPopupResponsiveMinHeight = () => Math.min(EDITOR_POPUP_MIN_HEIGHT, editorPopupAvailableHeight());
  const defaultEditorPopupSize = () => ({
    width: Math.max(EDITOR_POPUP_MIN_WIDTH, window.innerWidth * 0.75),
    height: Math.max(EDITOR_POPUP_MIN_HEIGHT, window.innerHeight * 0.85),
  });
  const PREVIEW_POPUP_SIZE_KEY = 'nexus.file-preview.desktop-popup-size';
  const PREVIEW_POPUP_DEFAULT_MAX_WIDTH = 1400;
  const PREVIEW_POPUP_MIN_WIDTH = 400;
  const PREVIEW_POPUP_MIN_HEIGHT = 320;
  const previewPopupAvailableWidth = () => Math.max(1, window.innerWidth - 32);
  const previewPopupAvailableHeight = () => Math.max(1, window.innerHeight - 32);
  const previewPopupResponsiveMinWidth = () => Math.min(PREVIEW_POPUP_MIN_WIDTH, previewPopupAvailableWidth());
  const previewPopupResponsiveMinHeight = () => Math.min(PREVIEW_POPUP_MIN_HEIGHT, previewPopupAvailableHeight());
  const defaultPreviewPopupSize = () => ({
    width: Math.min(PREVIEW_POPUP_DEFAULT_MAX_WIDTH, previewPopupAvailableWidth()),
    height: Math.min(Math.max(PREVIEW_POPUP_MIN_HEIGHT, window.innerHeight * 0.94), previewPopupAvailableHeight()),
  });
  const popupEditorRef = ref<EditorApi | null>(null);
  const popupPreviewRef = ref<PreviewApi | null>(null);
  const activeLeftSidebar = ref<WorkspacePaneName | null>(null);
  const activeRightSidebar = ref<WorkspacePaneName | null>(null);
  const mobilePane = ref<WorkspacePaneName>('terminal');
  const mobileCtrlActive = ref(false);
  const mobileAltActive = ref(false);
  const clearMobileModifiers = (): void => {
    mobileCtrlActive.value = false;
    mobileAltActive.value = false;
  };
  const toggleMobileModifier = (modifier: 'ctrl' | 'alt'): void => {
    if (modifier === 'ctrl') mobileCtrlActive.value = !mobileCtrlActive.value;
    else mobileAltActive.value = !mobileAltActive.value;
  };
  const runtimeTerminalChannel = props.session.adapters.terminal;
  const presentationTerminalChannel: TerminalChannel = {
    sendInput(data) {
      let next = data;
      if (props.mobile && (mobileCtrlActive.value || mobileAltActive.value)) {
        const modified = applyTerminalModifiers(data, {
          ctrl: mobileCtrlActive.value,
          alt: mobileAltActive.value,
        });
        if (modified !== null) {
          next = modified;
          clearMobileModifiers();
        }
      }
      return runtimeTerminalChannel.sendInput(next);
    },
    resize: (viewport) => runtimeTerminalChannel.resize(viewport),
    onOutput: (handler) => runtimeTerminalChannel.onOutput(handler),
    onClose: (handler) => runtimeTerminalChannel.onClose(handler),
    onError: (handler) => runtimeTerminalChannel.onError(handler),
    // This wrapper changes input presentation only. Preserve the optional suspended-output
    // capabilities so TerminalView can lazily page older history after a resume.
    setPreviousOutputAvailable: (available) => runtimeTerminalChannel.setPreviousOutputAvailable?.(available),
    hasPreviousOutput: () => runtimeTerminalChannel.hasPreviousOutput?.() ?? false,
    loadPreviousOutput: () => runtimeTerminalChannel.loadPreviousOutput?.() ?? Promise.resolve(null),
    resetPreviousOutput: () => runtimeTerminalChannel.resetPreviousOutput?.() ?? Promise.resolve(false),
  };
  watch(
    () => props.mobile,
    (mobile) => {
      if (!mobile) clearMobileModifiers();
    },
  );
  const progressVisible = computed({
    get: () => props.progressVisible !== false,
    set: (visible: boolean) => emit('progressVisible', visible),
  });
  const PROGRESS_RESTORE_POSITION_KEY = 'nexus.transfer-progress-restore-position';
  const PROGRESS_RESTORE_MARGIN = 8;
  const progressRestoreButton = ref<HTMLElement | null>(null);
  const progressRestorePosition = ref({ x: 0, y: 0 });
  const progressRestorePositionInitialized = ref(false);
  const clampProgressRestorePosition = (candidate: { x: number; y: number }, element: HTMLElement) => ({
    x: Math.max(
      PROGRESS_RESTORE_MARGIN,
      Math.min(
        candidate.x,
        Math.max(PROGRESS_RESTORE_MARGIN, window.innerWidth - element.offsetWidth - PROGRESS_RESTORE_MARGIN),
      ),
    ),
    y: Math.max(
      PROGRESS_RESTORE_MARGIN,
      Math.min(
        candidate.y,
        Math.max(PROGRESS_RESTORE_MARGIN, window.innerHeight - element.offsetHeight - PROGRESS_RESTORE_MARGIN),
      ),
    ),
  });
  const saveProgressRestorePosition = (): void => {
    if (props.mobile || !progressRestorePositionInitialized.value) return;
    try {
      localStorage.setItem(PROGRESS_RESTORE_POSITION_KEY, JSON.stringify(progressRestorePosition.value));
    } catch {
      // Keep the in-memory position when storage is unavailable.
    }
  };
  const initializeProgressRestorePosition = async (): Promise<void> => {
    if (props.mobile) return;
    await nextTick();
    const element = progressRestoreButton.value;
    if (!element) return;
    if (progressRestorePositionInitialized.value) {
      progressRestorePosition.value = clampProgressRestorePosition(progressRestorePosition.value, element);
      return;
    }

    const rect = element.getBoundingClientRect();
    let next = { x: rect.left, y: rect.top };
    try {
      const raw = localStorage.getItem(PROGRESS_RESTORE_POSITION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<{ x: number; y: number }>;
        if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) next = { x: saved.x!, y: saved.y! };
      }
    } catch {
      // Ignore malformed or unavailable storage and keep the original bottom-right position.
    }
    progressRestorePosition.value = clampProgressRestorePosition(next, element);
    progressRestorePositionInitialized.value = true;
  };
  const clampProgressRestoreToViewport = (): void => {
    const element = progressRestoreButton.value;
    if (!element || !progressRestorePositionInitialized.value) return;
    progressRestorePosition.value = clampProgressRestorePosition(progressRestorePosition.value, element);
    saveProgressRestorePosition();
  };
  let progressRestoreMoved = false;
  let suppressProgressRestoreClick = false;
  const progressRestoreDrag = useDraggablePosition({
    position: progressRestorePosition,
    getElement: () => progressRestoreButton.value,
    canStart: (event) => !props.mobile && event.button === 0,
    constrain: (candidate, element) => clampProgressRestorePosition(candidate, element),
    onStart: () => {
      progressRestoreMoved = false;
    },
    onMove: () => {
      progressRestoreMoved = true;
    },
    onEnd: () => {
      saveProgressRestorePosition();
      if (!progressRestoreMoved) return;
      suppressProgressRestoreClick = true;
      window.setTimeout(() => {
        suppressProgressRestoreClick = false;
      }, 0);
    },
  });
  const progressRestoreButtonStyle = computed(() =>
    progressRestorePositionInitialized.value
      ? {
          position: 'fixed' as const,
          left: `${progressRestorePosition.value.x}px`,
          top: `${progressRestorePosition.value.y}px`,
        }
      : {
          position: 'absolute' as const,
          right: '3rem',
          bottom: '0.75rem',
        },
  );
  const showProgressRestoreButton = computed(
    () => transfers.tasks.value.length > 0 && !progressVisible.value && !fileManagerPopupVisible.value,
  );
  const restoreHiddenProgress = (): void => {
    if (suppressProgressRestoreClick) {
      suppressProgressRestoreClick = false;
      return;
    }
    progressVisible.value = true;
  };
  watch(showProgressRestoreButton, (visible) => {
    if (visible) void initializeProgressRestorePosition();
  });
  onMounted(() => window.addEventListener('resize', clampProgressRestoreToViewport));
  onBeforeUnmount(() => window.removeEventListener('resize', clampProgressRestoreToViewport));
  const removeTransferTask = (id: string): void => transfers.remove(id);
  const terminalApi = ref<TerminalApi | null>(null);
  const editorApi = ref<EditorApi | null>(null);
  const previewApi = ref<PreviewApi | null>(null);
  const uploadInput = ref<HTMLInputElement | null>(null);
  const uploadPath = ref('/');
  const archiveDialog = ref<{ kind: 'compress' | 'decompress'; entries: RemoteFileEntry[] } | null>(null);
  const archiveDestination = ref('/');
  const archiveFormat = ref<'zip' | 'tar.gz' | 'tar.bz2'>('zip');
  const archivePassword = ref('');
  const archiveConfirmPassword = ref('');
  const archiveShowPassword = ref(false);
  const archivePasswordRequired = ref(false);
  const archiveRemoteError = ref('');
  const sendFilesItems = ref<SendFileSourceItem[]>([]);
  let archivePromptGeneration = 0;

  const parseSidebarWidth = (name: WorkspacePaneName | null): number => {
    const raw = name ? props.sidebarPaneWidths?.[name] : undefined;
    const parsed = raw ? Number.parseFloat(raw) : 350;
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 200), 800) : 350;
  };
  const leftSidebarWidth = ref(350);
  const rightSidebarWidth = ref(350);
  const leftResizeHeight = ref(0);
  const rightResizeHeight = ref(0);
  const syncSidebarWidths = () => {
    leftSidebarWidth.value = parseSidebarWidth(activeLeftSidebar.value);
    rightSidebarWidth.value = parseSidebarWidth(activeRightSidebar.value);
  };
  watch([activeLeftSidebar, activeRightSidebar, () => props.sidebarPaneWidths], syncSidebarWidths, { deep: true });
  const leftResize = useResizeHandle({
    width: leftSidebarWidth,
    height: leftResizeHeight,
    minWidth: 200,
    minHeight: 0,
    maxWidth: () => Math.min(800, window.innerWidth * 0.8),
    onEnd: ({ width }) => {
      if (activeLeftSidebar.value) emit('sidebarWidth', activeLeftSidebar.value, `${Math.round(width)}px`);
    },
  });
  const rightResize = useResizeHandle({
    width: rightSidebarWidth,
    height: rightResizeHeight,
    minWidth: 200,
    minHeight: 0,
    maxWidth: () => Math.min(800, window.innerWidth * 0.8),
    widthDirection: -1,
    onEnd: ({ width }) => {
      if (activeRightSidebar.value) emit('sidebarWidth', activeRightSidebar.value, `${Math.round(width)}px`);
    },
  });
  const fileManagerPopupSizing = usePersistentResizablePanel({
    storageKey: FILE_MANAGER_POPUP_SIZE_KEY,
    defaultSize: defaultFileManagerPopupSize,
    minWidth: fileManagerPopupResponsiveMinWidth,
    minHeight: fileManagerPopupResponsiveMinHeight,
    maxWidth: fileManagerPopupAvailableWidth,
    maxHeight: fileManagerPopupAvailableHeight,
    active: computed(() => fileManagerPopupVisible.value),
    enabled: () => !props.mobile,
    // OverlayPanel centers the popup. Double the pointer delta so the visible
    // bottom-right corner follows the resize handle rather than moving at half speed.
    widthMultiplier: 2,
    heightMultiplier: 2,
  });
  const editorPopupSizing = usePersistentResizablePanel({
    storageKey: EDITOR_POPUP_SIZE_KEY,
    defaultSize: defaultEditorPopupSize,
    minWidth: editorPopupResponsiveMinWidth,
    minHeight: editorPopupResponsiveMinHeight,
    maxWidth: editorPopupAvailableWidth,
    maxHeight: editorPopupAvailableHeight,
    active: computed(() => documentPopupVisible.value && documentMode.value === 'editor'),
    enabled: () => !props.mobile,
    widthMultiplier: 2,
    heightMultiplier: 2,
  });
  const previewPopupSizing = usePersistentResizablePanel({
    storageKey: PREVIEW_POPUP_SIZE_KEY,
    defaultSize: defaultPreviewPopupSize,
    minWidth: previewPopupResponsiveMinWidth,
    minHeight: previewPopupResponsiveMinHeight,
    maxWidth: previewPopupAvailableWidth,
    maxHeight: previewPopupAvailableHeight,
    active: computed(() => documentPopupVisible.value && documentMode.value === 'preview'),
    enabled: () => !props.mobile,
    widthMultiplier: 2,
    heightMultiplier: 2,
  });
  const fileManagerPopupStyle = computed(() =>
    props.mobile
      ? undefined
      : {
          width: `${fileManagerPopupSizing.width.value}px`,
          height: `${fileManagerPopupSizing.height.value}px`,
          maxWidth: `${fileManagerPopupAvailableWidth()}px`,
          maxHeight: `${fileManagerPopupAvailableHeight()}px`,
        },
  );
  const fileManagerPopupPanelClass = computed(() =>
    props.mobile
      ? 'max-w-4xl h-[85vh] flex flex-col overflow-hidden'
      : 'flex min-h-0 flex-col overflow-hidden !max-h-none !max-w-none',
  );
  const editorPopupStyle = computed(() =>
    props.mobile
      ? {
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          margin: '0',
        }
      : {
          width: `${editorPopupSizing.width.value}px`,
          height: `${editorPopupSizing.height.value}px`,
          maxWidth: `${editorPopupAvailableWidth()}px`,
          maxHeight: `${editorPopupAvailableHeight()}px`,
        },
  );
  const previewPopupStyle = computed(() =>
    props.mobile
      ? { width: '100%', height: '94dvh', maxWidth: '1400px', maxHeight: '94dvh' }
      : {
          width: `${previewPopupSizing.width.value}px`,
          height: `${previewPopupSizing.height.value}px`,
          maxWidth: `${previewPopupAvailableWidth()}px`,
          maxHeight: `${previewPopupAvailableHeight()}px`,
        },
  );
  const startDocumentPopupResize = (event: PointerEvent): void => {
    const sizing = documentMode.value === 'preview' ? previewPopupSizing : editorPopupSizing;
    sizing.resize.startResize(event);
  };
  const documentPopupResizeLabel = computed(() =>
    documentMode.value === 'preview' ? t('fileManager.preview.resizePopup') : t('fileEditor.resizePopup'),
  );
  const documentPopupOverlayClass = computed(() =>
    documentMode.value === 'preview' ? 'workspace-preview-overlay' : props.mobile ? '!p-4' : '',
  );
  const documentPopupPanelClass = computed(() =>
    documentMode.value === 'editor'
      ? `flex min-h-0 flex-col overflow-hidden !max-h-none !max-w-none !border-0 !bg-[#2d2d2d] !text-[#f0f0f0]${
          props.mobile ? ' !rounded-xl !shadow-2xl' : ''
        }`
      : 'flex min-h-0 flex-col overflow-hidden !max-h-none !max-w-none',
  );
  let surfaceVisibilityObserver: MutationObserver | undefined;
  const hideDocumentPopupWhenSurfaceHidden = () => {
    if (surfaceRoot.value?.style.display === 'none') documentPopupVisible.value = false;
  };
  onMounted(() => {
    hideDocumentPopupWhenSurfaceHidden();
    if (surfaceRoot.value) {
      surfaceVisibilityObserver = new MutationObserver(hideDocumentPopupWhenSurfaceHidden);
      surfaceVisibilityObserver.observe(surfaceRoot.value, { attributes: true, attributeFilter: ['style'] });
    }
  });
  onBeforeUnmount(() => {
    surfaceVisibilityObserver?.disconnect();
    surfaceVisibilityObserver = undefined;
  });

  const handleSurfacePointerDown = (event: PointerEvent) => {
    if (props.sidebarPersistent) return;
    const target = event.target as Element | null;
    if (target?.closest('[data-workspace-sidebar]')) return;
    activeLeftSidebar.value = null;
    activeRightSidebar.value = null;
  };

  const paneLabel = (name: WorkspacePaneName) => t(`layout.pane.${name}`);
  const paneIcon = (pane: WorkspacePaneName): string => {
    if (pane === 'connections') return 'fas fa-network-wired';
    if (pane === 'fileManager') return 'fas fa-folder-open';
    if (pane === 'commandHistory') return 'fas fa-history';
    if (pane === 'quickCommands') return 'fas fa-bolt';
    if (pane === 'dockerManager') return 'fab fa-docker';
    if (pane === 'editor') return 'fas fa-file-alt';
    if (pane === 'statusMonitor') return 'fas fa-tachometer-alt';
    if (pane === 'suspendedSshSessions') return 'fas fa-pause-circle';
    return 'fas fa-terminal';
  };
  const sidebarNode = (name: WorkspacePaneName, side: 'left' | 'right'): WorkspaceLayoutNode => ({
    id: `workspace-sidebar-${side}-${name}`,
    type: 'pane',
    component: name,
    size: 100,
  });
  const toggleSidebar = (side: 'left' | 'right', name: WorkspacePaneName) => {
    if (side === 'left') {
      activeLeftSidebar.value = activeLeftSidebar.value === name ? null : name;
      if (activeLeftSidebar.value) activeRightSidebar.value = null;
    } else {
      activeRightSidebar.value = activeRightSidebar.value === name ? null : name;
      if (activeRightSidebar.value) activeLeftSidebar.value = null;
    }
  };
  const closeSidebars = () => {
    activeLeftSidebar.value = null;
    activeRightSidebar.value = null;
  };

  const revealEmbeddedEditor = (): void => {
    if (props.showPopupFileManager) fileManagerPopupVisible.value = false;
  };
  const openEditorDocument = (path: string) =>
    editorSession.value.open(path, {
      scopeId: props.session.id,
      scopeLabel: editorScopeLabel.value,
      port: props.session.adapters.documents,
    });
  const openPreviewDocument = (path: string) =>
    previewSession.open(path, { scopeId: props.session.id, source: props.session.adapters.preview });

  const openFile = async (path: string) => {
    const previewKind = previewKindFor(path);
    if (previewKind !== 'unsupported') {
      documentMode.value = 'preview';
      documentPopupVisible.value = true;
      await nextTick();
      await openPreviewDocument(path);
    } else {
      documentMode.value = 'editor';
      if (props.showPopupFileEditor) {
        documentPopupVisible.value = true;
        await nextTick();
        await openEditorDocument(path);
      } else {
        if (props.mobile) {
          mobilePane.value = 'editor';
          await nextTick();
          await nextTick();
        }
        revealEmbeddedEditor();
        await openEditorDocument(path);
      }
    }
  };

  const openFileAsText = async (path: string) => {
    documentMode.value = 'editor';
    if (props.showPopupFileEditor) {
      documentPopupVisible.value = true;
      await nextTick();
      await openEditorDocument(path);
    } else {
      if (props.mobile) {
        mobilePane.value = 'editor';
        await nextTick();
        await nextTick();
      }
      revealEmbeddedEditor();
      await openEditorDocument(path);
    }
  };

  const editPreview = async (path: string) => {
    const activePreview = previewSession.active.value;
    if (activePreview) previewSession.close(activePreview.id);
    documentMode.value = 'editor';
    if (props.showPopupFileEditor) {
      documentPopupVisible.value = true;
      await openEditorDocument(path);
      await nextTick();
      popupEditorRef.value?.focus?.();
    } else {
      documentPopupVisible.value = false;
      if (props.mobile) {
        mobilePane.value = 'editor';
        await nextTick();
        await nextTick();
      }
      revealEmbeddedEditor();
      await openEditorDocument(path);
      await nextTick();
      editorApi.value?.focus?.();
    }
  };
  const hideDocumentPopup = () => {
    if (documentMode.value === 'preview') {
      const pendingPreview = previewSession.active.value;
      if (pendingPreview?.loading) previewSession.close(pendingPreview.id);
    }
    documentPopupVisible.value = false;
  };
  const closeDocumentPopup = () => {
    if (!props.showPopupFileEditor) {
      documentPopupVisible.value = false;
      return;
    }
    if (documentMode.value === 'editor') editorSession.value.closeAll();
    else previewSession.clear();
    documentPopupVisible.value = false;
  };
  const hidePreview = () => {
    if (props.showPopupFileEditor) previewSession.clear();
    documentPopupVisible.value = false;
  };

  const chooseUpload = (path: string) => {
    uploadPath.value = path;
    uploadInput.value?.click();
  };
  const uploadFilesAt = async (
    path: string,
    files: readonly (File | LocalUploadFile)[],
    directories: readonly string[] = [],
  ) => {
    try {
      const taskIds = await transfers.startUploadBatch(files, { scopeId: props.session.id, path }, directories);
      void Promise.all(taskIds.map((id) => transfers.waitForTask(id))).then(async (tasks) => {
        if (tasks.some((task) => task.status === 'completed' || task.status === 'partial')) {
          await props.session.filesystemState.browser.refresh();
        }
      });
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const uploadFiles = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    await uploadFilesAt(uploadPath.value, files);
  };

  const beginSendFiles = (entries: RemoteFileEntry[]) => {
    if (!entries.length) return;
    sendFilesItems.value = entries.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.metadata.isDirectory ? 'directory' : 'file',
    }));
  };

  const moveWithinSession = async (entries: RemoteFileEntry[], destination: string) => {
    if (!entries.length || !destination.startsWith('/')) return;
    try {
      const taskId = await transfers.copyMove({
        kind: 'move',
        sources: entries.map((entry) => ({ scopeId: props.session.id, path: entry.path })),
        destination: { scopeId: props.session.id, path: destination },
      });
      const task = await transfers.waitForTask(taskId);
      if (task.status === 'completed' || task.status === 'partial') {
        await props.session.filesystemState.browser.refresh();
        return;
      }
      if (task.status === 'error') throw new Error(task.error || t('fileManager.errors.generic'));
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const parentPath = (path: string) => {
    const normalized = path.replace(/\/+$/, '');
    const index = normalized.lastIndexOf('/');
    return index <= 0 ? '/' : normalized.slice(0, index);
  };
  type ArchiveRequestContext = {
    kind: 'compress' | 'decompress';
    entries: RemoteFileEntry[];
    destination: string;
    format: ArchiveCompressionFormat;
  };
  const resetArchivePassword = () => {
    archivePassword.value = '';
    archiveConfirmPassword.value = '';
    archiveShowPassword.value = false;
    archivePasswordRequired.value = false;
    archiveRemoteError.value = '';
  };
  watch(archivePassword, () => {
    archiveRemoteError.value = '';
  });
  const archivePasswordAvailable = computed(() => {
    const dialog = archiveDialog.value;
    if (!dialog) return false;
    if (dialog.kind === 'compress') return archiveFormat.value === 'zip';
    return /\.zip$/i.test(dialog.entries[0]?.name ?? '');
  });
  const archivePasswordError = computed(() => {
    if (archiveRemoteError.value) return archiveRemoteError.value;
    if (!archivePasswordAvailable.value || !archivePassword.value) return '';
    if (Array.from(archivePassword.value).length > 128) {
      return t('fileManager.archivePassword.tooLong', { max: 128 });
    }
    if (/[\0\r\n]/.test(archivePassword.value)) return t('fileManager.archivePassword.invalidCharacters');
    if (
      archiveDialog.value?.kind === 'compress' &&
      archiveConfirmPassword.value &&
      archivePassword.value !== archiveConfirmPassword.value
    ) {
      return t('fileManager.archivePassword.mismatch');
    }
    return '';
  });
  const archivePasswordInvalid = computed(
    () =>
      Boolean(archivePasswordError.value) ||
      (archivePasswordRequired.value && !archivePassword.value) ||
      (archivePasswordAvailable.value &&
        archiveDialog.value?.kind === 'compress' &&
        Boolean(archivePassword.value) &&
        archivePassword.value !== archiveConfirmPassword.value),
  );
  const closeArchiveDialog = (invalidatePending = true) => {
    if (invalidatePending) archivePromptGeneration += 1;
    archiveDialog.value = null;
    resetArchivePassword();
  };
  const compressionDestination = (entries: RemoteFileEntry[], format: ArchiveCompressionFormat): string => {
    const parent = parentPath(entries[0]!.path);
    let base = 'archive';
    if (entries.length === 1) {
      const sourceName = entries[0]!.name;
      base = sourceName.startsWith('.') ? sourceName : sourceName.replace(/\.[^./]+$/, '') || sourceName;
    } else {
      const parentName = parent.split('/').filter(Boolean).pop();
      if (parentName && parentName !== 'root') base = parentName;
    }
    return `${parent.replace(/\/$/, '')}/${base}.${format}`.replace(/^\/\//, '/');
  };
  const archivePasswordFailureMessage = (code: ArchiveTransferErrorCode, fallback: string): string => {
    if (code === 'INVALID_PASSWORD') return t('fileManager.archivePassword.wrongPassword');
    if (code === 'PASSWORD_TOO_LONG') return t('fileManager.archivePassword.tooLong', { max: 128 });
    if (code === 'INVALID_PASSWORD_FORMAT') return t('fileManager.archivePassword.invalidCharacters');
    return code === 'PASSWORD_REQUIRED' ? '' : fallback;
  };
  type ArchivePasswordErrorCode = Extract<
    ArchiveTransferErrorCode,
    'PASSWORD_REQUIRED' | 'INVALID_PASSWORD' | 'PASSWORD_TOO_LONG' | 'INVALID_PASSWORD_FORMAT'
  >;
  const isArchivePasswordErrorCode = (code: ArchiveTransferErrorCode | undefined): code is ArchivePasswordErrorCode =>
    code === 'PASSWORD_REQUIRED' ||
    code === 'INVALID_PASSWORD' ||
    code === 'PASSWORD_TOO_LONG' ||
    code === 'INVALID_PASSWORD_FORMAT';
  const openArchivePasswordPrompt = (
    requestContext: ArchiveRequestContext,
    code: ArchiveTransferErrorCode = 'PASSWORD_REQUIRED',
    fallback = '',
  ) => {
    archiveDialog.value = { kind: requestContext.kind, entries: [...requestContext.entries] };
    archiveDestination.value = requestContext.destination;
    archiveFormat.value = requestContext.format;
    resetArchivePassword();
    archivePasswordRequired.value = true;
    archiveRemoteError.value = archivePasswordFailureMessage(code, fallback);
  };
  const observeArchiveTask = (
    taskId: string,
    requestContext: ArchiveRequestContext,
    submissionGeneration: number,
  ): void => {
    void transfers.waitForTask(taskId).then(async (task) => {
      if (task.status === 'completed' || task.status === 'partial') {
        await props.session.filesystemState.browser.refresh();
        return;
      }
      if (task.status !== 'error') return;
      if (
        isArchivePasswordErrorCode(task.errorCode) &&
        submissionGeneration === archivePromptGeneration &&
        !archiveDialog.value
      ) {
        openArchivePasswordPrompt(requestContext, task.errorCode, task.error ?? '');
        return;
      }
      if (task.status === 'error') {
        const detail = task.error || t('fileManager.errors.generic');
        const messageKey =
          requestContext.kind === 'compress'
            ? 'fileManager.errors.compressErrorDetailed'
            : 'fileManager.errors.decompressErrorDetailed';
        feedback.notifyError(t(messageKey, { error: detail }));
      }
    });
  };
  const startArchiveTask = async (
    requestContext: ArchiveRequestContext,
    password: string | undefined,
    submissionGeneration: number,
  ): Promise<void> => {
    const taskId = await transfers.archive({
      kind: requestContext.kind,
      sources: requestContext.entries.map((entry) => ({ scopeId: props.session.id, path: entry.path })),
      destination: { scopeId: props.session.id, path: requestContext.destination },
      ...(requestContext.kind === 'compress' ? { format: requestContext.format } : {}),
      ...(password ? { password } : {}),
    });
    observeArchiveTask(taskId, requestContext, submissionGeneration);
  };
  const launchArchiveTask = (requestContext: ArchiveRequestContext, submissionGeneration: number) => {
    void startArchiveTask(requestContext, undefined, submissionGeneration).catch((cause) => {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  const beginCompress = (entries: RemoteFileEntry[]) => {
    if (!entries.length) return;
    archivePromptGeneration += 1;
    archiveDialog.value = { kind: 'compress', entries: [...entries] };
    archiveFormat.value = 'zip';
    archiveDestination.value = compressionDestination(entries, 'zip');
    resetArchivePassword();
  };
  const beginCompressPreset = (intent: ArchiveCompressionIntent) => {
    if (!intent.entries.length) return;
    archivePromptGeneration += 1;
    const generation = archivePromptGeneration;
    const requestContext: ArchiveRequestContext = {
      kind: 'compress',
      entries: [...intent.entries],
      destination: compressionDestination(intent.entries, intent.format),
      format: intent.format,
    };
    if (intent.passwordProtected) {
      openArchivePasswordPrompt(requestContext);
      return;
    }
    closeArchiveDialog(false);
    launchArchiveTask(requestContext, generation);
  };
  const beginDecompress = (entry: RemoteFileEntry) => {
    archivePromptGeneration += 1;
    const generation = archivePromptGeneration;
    closeArchiveDialog(false);
    launchArchiveTask(
      {
        kind: 'decompress',
        entries: [entry],
        destination: parentPath(entry.path),
        format: 'zip',
      },
      generation,
    );
  };
  const submitArchive = async () => {
    const current = archiveDialog.value;
    if (!current) return;
    try {
      const destination = archiveDestination.value.trim();
      if (current.kind === 'compress' && !destination.startsWith('/')) return;
      if (archivePasswordInvalid.value) return;
      const submissionGeneration = archivePromptGeneration;
      const requestContext: ArchiveRequestContext = {
        kind: current.kind,
        entries: [...current.entries],
        destination: current.kind === 'compress' ? destination : parentPath(current.entries[0]!.path),
        format: archiveFormat.value,
      };
      const password = archivePasswordAvailable.value && archivePassword.value ? archivePassword.value : undefined;
      closeArchiveDialog(false);
      await startArchiveTask(requestContext, password, submissionGeneration);
    } catch (cause) {
      feedback.notifyError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  defineExpose({
    terminalSnapshot: () => terminalApi.value?.serialize?.() ?? '',
    focusTerminal: () => terminalApi.value?.focus?.(),
    fitTerminal: () => terminalApi.value?.fit?.(),
    scrollTerminalToBottom: () => terminalApi.value?.scrollToBottom?.(),
  });
</script>

<template>
  <div
    ref="surfaceRoot"
    class="relative flex h-full min-h-0 overflow-hidden bg-background"
    :class="mobile ? 'flex-col' : 'flex-row'"
    @pointerdown.capture="handleSurfacePointerDown"
  >
    <nav
      v-if="!mobile && sidebars.left.length"
      data-workspace-sidebar
      class="relative z-10 flex w-10 shrink-0 flex-col border-r border-border bg-header/60 py-1"
    >
      <button
        v-for="pane in sidebars.left"
        :key="pane"
        :data-testid="`sidebar-pane-${pane}`"
        type="button"
        class="mb-1 grid h-10 w-10 place-items-center text-lg text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground"
        :class="activeLeftSidebar === pane ? 'bg-primary text-white hover:bg-primary-dark hover:text-white' : ''"
        :title="paneLabel(pane)"
        :aria-label="paneLabel(pane)"
        @click="toggleSidebar('left', pane)"
      >
        <i :class="paneIcon(pane)" aria-hidden="true"></i>
      </button>
    </nav>

    <aside
      v-if="!mobile && activeLeftSidebar"
      data-workspace-sidebar
      data-testid="left-sidebar-panel"
      class="fixed top-0 bottom-0 left-0 z-[110] flex max-w-[80vw] flex-col overflow-hidden border-r border-border bg-background transition-transform duration-300 ease-in-out"
      :style="{ width: `${leftSidebarWidth}px` }"
    >
      <div
        data-testid="left-sidebar-resize-handle"
        class="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize"
        @pointerdown="leftResize.startResize"
      ></div>
      <button
        type="button"
        class="absolute right-2 top-1 z-10 p-1 text-2xl leading-none text-text-secondary hover:text-foreground"
        :title="t('common.close')"
        :aria-label="t('common.close')"
        @click="closeSidebars"
      >
        <span aria-hidden="true">&times;</span>
      </button>
      <WorkspaceLayoutRenderer
        :active="active !== false"
        class="box-border h-full min-h-0 !border-0 pt-10"
        :node="sidebarNode(activeLeftSidebar, 'left')"
        :session="session"
        :document-mode="documentMode"
        :terminal-font-family="terminalFontFamily"
        :terminal-font-size="terminalFontSize"
        :terminal-theme="terminalTheme"
        :terminal-visual="terminalVisual"
        :terminal-scrollback="terminalScrollback"
        :right-click-copy-paste="rightClickCopyPaste"
        :editor-font-family="editorFontFamily"
        :editor-font-size="editorFontSize"
        :mobile-editor-font-size="mobileEditorFontSize"
        :editor-scope-label="editorScopeLabel"
        :show-editor-scope-label="showEditorScopeLabel"
        :command-input-sync-target="commandInputSyncTarget"
        :status-interval-seconds="statusIntervalSeconds"
        :docker-interval-seconds="dockerIntervalSeconds"
        :docker-default-expand="dockerDefaultExpand"
        :status-scale="statusScale"
        :status-show-ip="statusShowIp"
        :status-host="session.connection.host"
        :editor-session="editorSession"
        :preview-session="previewSession"
        :popup-documents="showPopupFileEditor"
        :popup-file-manager="showPopupFileManager"
        :file-manager-confirm-delete="fileManagerConfirmDelete"
        :quick-commands-collapsible-search="quickCommandsCollapsibleSearch"
        :quick-commands-compact-mode="quickCommandsCompactMode"
        :show-connection-tags="showConnectionTags"
        :show-quick-command-tags="showQuickCommandTags"
        :file-manager-row-scale="fileManagerRowScale"
        :file-manager-column-widths="fileManagerColumnWidths"
        :spreadsheet-rows-per-page="spreadsheetRowsPerPage"
        :spreadsheet-max-columns="spreadsheetMaxColumns"
        :quick-command-row-scale="quickCommandRowScale"
        :clipboard-count="clipboardCount"
        :marked-suspended-sessions="markedSuspendedSessions"
        :layout-locked="layoutLocked"
        :terminal-channel="presentationTerminalChannel"
        @layout-resize="(containerId, sizes) => emit('layoutResize', containerId, sizes)"
        @open-connection="emit('openConnection', $event)"
        @open-file="openFile"
        @open-text-file="openFileAsText"
        @upload="chooseUpload"
        @upload-files="uploadFilesAt"
        @clipboard-set="(operation, entries) => emit('fileClipboardSet', operation, entries)"
        @paste="(destination) => emit('fileClipboardPaste', destination)"
        @move-to="moveWithinSession"
        @compress="beginCompress"
        @compress-preset="beginCompressPreset"
        @decompress="beginDecompress"
        @send-files="beginSendFiles"
        @command="(command, all) => emit('command', command, all)"
        @clear-terminal="terminalApi?.clear?.()"
        @find-terminal-next="terminalApi?.findNext?.()"
        @find-terminal-previous="terminalApi?.findPrevious?.()"
        @open-focus-configurator="emit('openFocusConfigurator')"
        @terminal-api="terminalApi = $event"
        @editor-api="editorApi = $event"
        @preview-api="previewApi = $event"
        @document-mode="documentMode = $event"
        @resume-suspended="emit('resumeSuspended', $event)"
        @resume-marked-suspended="emit('resumeMarkedSuspended', $event)"
        @unmark-suspended="emit('unmarkSuspended', $event)"
        @open-file-manager="fileManagerPopupVisible = true"
        @open-editor="
          documentMode = 'editor';
          documentPopupVisible = true;
        "
        @edit-preview="editPreview"
        @hide-preview="hidePreview"
        @quick-command-row-scale="emit('quickCommandRowScale', $event)"
        @quick-command-compact-mode="emit('quickCommandCompactMode', $event)"
        @status-scale="emit('statusScale', $event)"
        @file-manager-row-scale="emit('fileManagerRowScale', $event)"
        @file-manager-column-widths="emit('fileManagerColumnWidths', $event)"
        @terminal-font-size="emit('terminalFontSize', $event)"
        @editor-font-size="emit('editorFontSize', $event)"
        @mobile-editor-font-size="emit('mobileEditorFontSize', $event)"
        @interaction="emit('interaction')"
      />
    </aside>

    <div class="relative min-h-0 min-w-0 flex-1">
      <WorkspaceLayoutRenderer
        :active="active !== false"
        :node="mobile ? sidebarNode(mobilePane, 'left') : layout"
        :session="session"
        :document-mode="documentMode"
        :terminal-font-family="terminalFontFamily"
        :terminal-font-size="terminalFontSize"
        :terminal-theme="terminalTheme"
        :terminal-visual="terminalVisual"
        :terminal-scrollback="terminalScrollback"
        :right-click-copy-paste="rightClickCopyPaste"
        :editor-font-family="editorFontFamily"
        :editor-font-size="editorFontSize"
        :mobile-editor-font-size="mobileEditorFontSize"
        :editor-scope-label="editorScopeLabel"
        :show-editor-scope-label="showEditorScopeLabel"
        :command-input-sync-target="commandInputSyncTarget"
        :status-interval-seconds="statusIntervalSeconds"
        :docker-interval-seconds="dockerIntervalSeconds"
        :docker-default-expand="dockerDefaultExpand"
        :status-scale="statusScale"
        :status-show-ip="statusShowIp"
        :status-host="session.connection.host"
        :editor-session="editorSession"
        :preview-session="previewSession"
        :popup-documents="showPopupFileEditor"
        :popup-file-manager="showPopupFileManager"
        :file-manager-confirm-delete="fileManagerConfirmDelete"
        :quick-commands-collapsible-search="quickCommandsCollapsibleSearch"
        :quick-commands-compact-mode="quickCommandsCompactMode"
        :show-connection-tags="showConnectionTags"
        :show-quick-command-tags="showQuickCommandTags"
        :file-manager-row-scale="fileManagerRowScale"
        :file-manager-column-widths="fileManagerColumnWidths"
        :spreadsheet-rows-per-page="spreadsheetRowsPerPage"
        :spreadsheet-max-columns="spreadsheetMaxColumns"
        :quick-command-row-scale="quickCommandRowScale"
        :clipboard-count="clipboardCount"
        :marked-suspended-sessions="markedSuspendedSessions"
        :layout-locked="layoutLocked"
        :terminal-channel="presentationTerminalChannel"
        @layout-resize="(containerId, sizes) => emit('layoutResize', containerId, sizes)"
        @open-connection="emit('openConnection', $event)"
        @open-file="openFile"
        @open-text-file="openFileAsText"
        @upload="chooseUpload"
        @upload-files="uploadFilesAt"
        @clipboard-set="(operation, entries) => emit('fileClipboardSet', operation, entries)"
        @paste="(destination) => emit('fileClipboardPaste', destination)"
        @move-to="moveWithinSession"
        @compress="beginCompress"
        @compress-preset="beginCompressPreset"
        @decompress="beginDecompress"
        @send-files="beginSendFiles"
        @command="(command, all) => emit('command', command, all)"
        @clear-terminal="terminalApi?.clear?.()"
        @find-terminal-next="terminalApi?.findNext?.()"
        @find-terminal-previous="terminalApi?.findPrevious?.()"
        @open-focus-configurator="emit('openFocusConfigurator')"
        @terminal-api="terminalApi = $event"
        @editor-api="editorApi = $event"
        @preview-api="previewApi = $event"
        @document-mode="documentMode = $event"
        @resume-suspended="emit('resumeSuspended', $event)"
        @resume-marked-suspended="emit('resumeMarkedSuspended', $event)"
        @unmark-suspended="emit('unmarkSuspended', $event)"
        @open-file-manager="fileManagerPopupVisible = true"
        @open-editor="
          documentMode = 'editor';
          documentPopupVisible = true;
        "
        @edit-preview="editPreview"
        @hide-preview="hidePreview"
        @quick-command-row-scale="emit('quickCommandRowScale', $event)"
        @quick-command-compact-mode="emit('quickCommandCompactMode', $event)"
        @status-scale="emit('statusScale', $event)"
        @file-manager-row-scale="emit('fileManagerRowScale', $event)"
        @file-manager-column-widths="emit('fileManagerColumnWidths', $event)"
        @terminal-font-size="emit('terminalFontSize', $event)"
        @editor-font-size="emit('editorFontSize', $event)"
        @mobile-editor-font-size="emit('mobileEditorFontSize', $event)"
        @interaction="emit('interaction')"
      />
    </div>

    <aside
      v-if="!mobile && activeRightSidebar"
      data-workspace-sidebar
      data-testid="right-sidebar-panel"
      class="fixed top-0 bottom-0 right-0 z-[110] flex max-w-[80vw] flex-col overflow-hidden border-l border-border bg-background transition-transform duration-300 ease-in-out"
      :style="{ width: `${rightSidebarWidth}px` }"
    >
      <div class="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize" @pointerdown="rightResize.startResize"></div>
      <button
        type="button"
        class="absolute right-2 top-1 z-10 p-1 text-2xl leading-none text-text-secondary hover:text-foreground"
        :title="t('common.close')"
        :aria-label="t('common.close')"
        @click="closeSidebars"
      >
        <span aria-hidden="true">&times;</span>
      </button>
      <WorkspaceLayoutRenderer
        :active="active !== false"
        class="box-border h-full min-h-0 !border-0 pt-10"
        :node="sidebarNode(activeRightSidebar, 'right')"
        :session="session"
        :document-mode="documentMode"
        :terminal-font-family="terminalFontFamily"
        :terminal-font-size="terminalFontSize"
        :terminal-theme="terminalTheme"
        :terminal-visual="terminalVisual"
        :terminal-scrollback="terminalScrollback"
        :right-click-copy-paste="rightClickCopyPaste"
        :editor-font-family="editorFontFamily"
        :editor-font-size="editorFontSize"
        :mobile-editor-font-size="mobileEditorFontSize"
        :editor-scope-label="editorScopeLabel"
        :show-editor-scope-label="showEditorScopeLabel"
        :command-input-sync-target="commandInputSyncTarget"
        :status-interval-seconds="statusIntervalSeconds"
        :docker-interval-seconds="dockerIntervalSeconds"
        :docker-default-expand="dockerDefaultExpand"
        :status-scale="statusScale"
        :status-show-ip="statusShowIp"
        :status-host="session.connection.host"
        :editor-session="editorSession"
        :preview-session="previewSession"
        :popup-documents="showPopupFileEditor"
        :popup-file-manager="showPopupFileManager"
        :file-manager-confirm-delete="fileManagerConfirmDelete"
        :quick-commands-collapsible-search="quickCommandsCollapsibleSearch"
        :quick-commands-compact-mode="quickCommandsCompactMode"
        :show-connection-tags="showConnectionTags"
        :show-quick-command-tags="showQuickCommandTags"
        :file-manager-row-scale="fileManagerRowScale"
        :file-manager-column-widths="fileManagerColumnWidths"
        :spreadsheet-rows-per-page="spreadsheetRowsPerPage"
        :spreadsheet-max-columns="spreadsheetMaxColumns"
        :quick-command-row-scale="quickCommandRowScale"
        :clipboard-count="clipboardCount"
        :marked-suspended-sessions="markedSuspendedSessions"
        :layout-locked="layoutLocked"
        :terminal-channel="presentationTerminalChannel"
        @layout-resize="(containerId, sizes) => emit('layoutResize', containerId, sizes)"
        @open-connection="emit('openConnection', $event)"
        @open-file="openFile"
        @open-text-file="openFileAsText"
        @upload="chooseUpload"
        @upload-files="uploadFilesAt"
        @clipboard-set="(operation, entries) => emit('fileClipboardSet', operation, entries)"
        @paste="(destination) => emit('fileClipboardPaste', destination)"
        @move-to="moveWithinSession"
        @compress="beginCompress"
        @compress-preset="beginCompressPreset"
        @decompress="beginDecompress"
        @send-files="beginSendFiles"
        @command="(command, all) => emit('command', command, all)"
        @clear-terminal="terminalApi?.clear?.()"
        @find-terminal-next="terminalApi?.findNext?.()"
        @find-terminal-previous="terminalApi?.findPrevious?.()"
        @open-focus-configurator="emit('openFocusConfigurator')"
        @terminal-api="terminalApi = $event"
        @editor-api="editorApi = $event"
        @preview-api="previewApi = $event"
        @document-mode="documentMode = $event"
        @resume-suspended="emit('resumeSuspended', $event)"
        @resume-marked-suspended="emit('resumeMarkedSuspended', $event)"
        @unmark-suspended="emit('unmarkSuspended', $event)"
        @open-file-manager="fileManagerPopupVisible = true"
        @open-editor="
          documentMode = 'editor';
          documentPopupVisible = true;
        "
        @edit-preview="editPreview"
        @hide-preview="hidePreview"
        @quick-command-row-scale="emit('quickCommandRowScale', $event)"
        @quick-command-compact-mode="emit('quickCommandCompactMode', $event)"
        @status-scale="emit('statusScale', $event)"
        @file-manager-row-scale="emit('fileManagerRowScale', $event)"
        @file-manager-column-widths="emit('fileManagerColumnWidths', $event)"
        @terminal-font-size="emit('terminalFontSize', $event)"
        @editor-font-size="emit('editorFontSize', $event)"
        @mobile-editor-font-size="emit('mobileEditorFontSize', $event)"
        @interaction="emit('interaction')"
      />
    </aside>

    <nav
      v-if="!mobile && sidebars.right.length"
      data-workspace-sidebar
      class="relative z-10 flex w-10 shrink-0 flex-col border-l border-border bg-header/60 py-1"
    >
      <button
        v-for="pane in sidebars.right"
        :key="pane"
        :data-testid="`sidebar-pane-${pane}`"
        type="button"
        class="mb-1 grid h-10 w-10 place-items-center text-lg text-text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground"
        :class="activeRightSidebar === pane ? 'bg-primary text-white hover:bg-primary-dark hover:text-white' : ''"
        :title="paneLabel(pane)"
        :aria-label="paneLabel(pane)"
        @click="toggleSidebar('right', pane)"
      >
        <i :class="paneIcon(pane)" aria-hidden="true"></i>
      </button>
    </nav>

    <WorkspaceMobileTools
      v-if="mobile"
      :pane="mobilePane"
      :terminal-api="terminalApi"
      :terminal-channel="presentationTerminalChannel"
      :ctrl-active="mobileCtrlActive"
      :alt-active="mobileAltActive"
      :status-session="session.statusController"
      :status-interval-seconds="statusIntervalSeconds"
      :status-scale="statusScale"
      :status-show-ip="statusShowIp"
      :status-host="session.connection.host"
      :quick-commands-compact-mode="quickCommandsCompactMode"
      :show-quick-command-tags="showQuickCommandTags"
      :quick-command-row-scale="quickCommandRowScale"
      :command-draft="session.commandDraft.value"
      :command-input-sync-target="commandInputSyncTarget"
      :quick-commands-grouped="showQuickCommandTags"
      :command-ready="session.hasConnected.value"
      :terminal-search-open="session.terminalState.searchOpen.value"
      :terminal-search-term="session.terminalState.searchTerm.value"
      @update:pane="mobilePane = $event"
      @update:terminal-search-open="session.terminalState.searchOpen.value = $event"
      @update:terminal-search-term="session.terminalState.searchTerm.value = $event"
      @update:command-draft="session.commandDraft.value = $event"
      @open-file-manager="fileManagerPopupVisible = true"
      @open-editor="
        documentMode = 'editor';
        documentPopupVisible = true;
      "
      @open-suspended="emit('openSuspended')"
      @command="(command, all) => emit('command', command, all)"
      @interaction="emit('interaction')"
      @toggle-modifier="toggleMobileModifier"
      @clear-modifiers="clearMobileModifiers"
      @status-scale="emit('statusScale', $event)"
      @quick-command-row-scale="emit('quickCommandRowScale', $event)"
      @quick-command-compact-mode="emit('quickCommandCompactMode', $event)"
    />

    <input ref="uploadInput" class="hidden" type="file" multiple @change="uploadFiles" />

    <ProgressCenter
      v-if="transfers.tasks.value.length && progressVisible && !fileManagerPopupVisible"
      :tasks="transfers.tasks.value"
      :source-label="session.connection.name || session.connection.host"
      @cancel="transfers.cancel"
      @cancel-all="transfers.cancelAll"
      @hide="progressVisible = false"
      @remove="removeTransferTask"
    />
    <div
      v-else-if="showProgressRestoreButton"
      ref="progressRestoreButton"
      data-testid="transfer-progress-restore-anchor"
      class="z-30 touch-none select-none shadow-lg"
      :class="progressRestoreDrag.dragging.value ? 'cursor-grabbing' : 'cursor-move'"
      :style="progressRestoreButtonStyle"
      @pointerdown="progressRestoreDrag.startDragging"
      @dragstart.prevent
    >
      <BaseButton
        data-testid="transfer-progress-restore-button"
        class="select-none"
        size="sm"
        :class="progressRestoreDrag.dragging.value ? 'cursor-grabbing' : 'cursor-move'"
        @click="restoreHiddenProgress"
      >
        {{ t('progressCenter.title') }} ({{ transfers.tasks.value.length }})
      </BaseButton>
    </div>
    <SendFilesModal
      v-if="sendFilesItems.length"
      :visible="true"
      :source-connection-id="session.connection.id"
      :items="sendFilesItems"
      @close="sendFilesItems = []"
      @sent="emit('serverTransferStarted')"
    />
    <UploadConflictModal
      v-if="transfers.conflict.value"
      :visible="true"
      :path="transfers.conflict.value?.path"
      @resolve="transfers.resolveConflict"
    />

    <OverlayPanel
      data-testid="file-manager-modal"
      panel-test-id="file-manager-modal-panel"
      :visible="fileManagerPopupVisible"
      teleport
      :panel-class="fileManagerPopupPanelClass"
      :panel-style="fileManagerPopupStyle"
      role="dialog"
      :aria-modal="true"
      :aria-label="t('fileManager.modalTitle')"
      @close="fileManagerPopupVisible = false"
    >
      <div class="flex shrink-0 items-center justify-between border-b border-border bg-header p-3">
        <h2 class="text-lg font-semibold text-foreground">
          {{ t('fileManager.modalTitle') }} ({{ editorScopeLabel }})
        </h2>
        <button
          data-testid="file-manager-modal-close"
          type="button"
          class="text-text-secondary transition-colors hover:text-foreground"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="fileManagerPopupVisible = false"
        >
          <i class="fas fa-times text-xl" aria-hidden="true"></i>
        </button>
      </div>
      <div class="min-h-0 flex-grow overflow-hidden">
        <FileManager
          class="h-full min-h-0"
          :channel="session.adapters.filesystem"
          :download="session.adapters.download"
          :terminal-directory="session.adapters.terminalDirectory"
          :confirm-delete="fileManagerConfirmDelete"
          :row-scale="fileManagerRowScale"
          :column-widths="fileManagerColumnWidths"
          :clipboard-count="clipboardCount"
          :state="session.filesystemState"
          :show-editor-button="showPopupFileEditor"
          @open-file="(entry) => openFile(entry.path)"
          @open-as-text="(entry) => openFileAsText(entry.path)"
          @open-editor="
            documentMode = 'editor';
            documentPopupVisible = true;
          "
          @upload="chooseUpload"
          @upload-files="uploadFilesAt"
          @copy-to-clipboard="emit('fileClipboardSet', 'copy', $event)"
          @cut-to-clipboard="emit('fileClipboardSet', 'cut', $event)"
          @paste="emit('fileClipboardPaste', $event)"
          @move-to="moveWithinSession"
          @compress="beginCompress"
          @compress-preset="beginCompressPreset"
          @decompress="beginDecompress"
          @send-files="beginSendFiles"
          @row-scale="emit('fileManagerRowScale', $event)"
          @column-widths="emit('fileManagerColumnWidths', $event)"
        />
      </div>
      <ProgressCenter
        v-if="transfers.tasks.value.length && progressVisible"
        :tasks="transfers.tasks.value"
        :source-label="session.connection.name || session.connection.host"
        @cancel="transfers.cancel"
        @cancel-all="transfers.cancelAll"
        @hide="progressVisible = false"
        @remove="removeTransferTask"
      />
      <button
        v-if="!mobile"
        data-testid="file-manager-resize-handle"
        type="button"
        class="absolute bottom-0 right-0 z-40 h-5 w-5 touch-none select-none cursor-nwse-resize bg-transparent opacity-70 transition hover:bg-primary/15 hover:opacity-100"
        :title="t('fileManager.resizePopup')"
        :aria-label="t('fileManager.resizePopup')"
        @pointerdown.stop="fileManagerPopupSizing.resize.startResize"
      >
        <span
          class="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-text-secondary/70"
        ></span>
      </button>
    </OverlayPanel>

    <OverlayPanel
      data-testid="document-popup"
      :data-document-mode="documentMode"
      :visible="documentPopupVisible"
      :keep-mounted="true"
      teleport
      :z-index="documentMode === 'preview' ? 1100 : 1000"
      :close-on-backdrop="true"
      :close-on-escape="true"
      :focus-on-open="true"
      :restore-focus="true"
      :panel-class="documentPopupPanelClass"
      :panel-style="documentMode === 'preview' ? previewPopupStyle : editorPopupStyle"
      :overlay-class="documentPopupOverlayClass"
      role="dialog"
      :aria-modal="true"
      :aria-label="documentMode === 'preview' ? t('fileManager.preview.openFiles') : t('settings.popupEditor.title')"
      @close="hideDocumentPopup"
    >
      <div v-if="documentPopupInitialized" class="relative flex h-full min-h-0 flex-col">
        <FileEditor
          ref="popupEditorRef"
          v-show="documentMode === 'editor'"
          class="min-h-0 flex-1"
          :port="session.adapters.documents"
          :scope-id="session.id"
          :scope-label="editorScopeLabel"
          :show-scope-label="showEditorScopeLabel"
          :session="editorSession"
          :font-family="editorFontFamily"
          :font-size="editorFontSize"
          :mobile-font-size="mobileEditorFontSize"
          :show-close-button="showPopupFileEditor"
          @close="closeDocumentPopup"
          @font-size="emit('editorFontSize', $event)"
          @mobile-font-size="emit('mobileEditorFontSize', $event)"
        />
        <button
          v-if="!mobile"
          data-testid="document-popup-resize-handle"
          type="button"
          class="absolute bottom-0 right-0 z-30 h-5 w-5 touch-none select-none cursor-nwse-resize bg-transparent opacity-70 transition hover:bg-white/15 hover:opacity-100"
          :title="documentPopupResizeLabel"
          :aria-label="documentPopupResizeLabel"
          @pointerdown.stop="startDocumentPopupResize"
        >
          <span
            class="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-text-secondary/70"
          ></span>
        </button>
        <FilePreview
          ref="popupPreviewRef"
          v-show="documentMode === 'preview'"
          class="min-h-0 flex-1"
          :source="session.adapters.preview"
          :scope-id="session.id"
          :session="previewSession"
          :spreadsheet-rows-per-page="spreadsheetRowsPerPage"
          :spreadsheet-max-columns="spreadsheetMaxColumns"
          @edit="editPreview"
          @hide="hidePreview"
          @dismiss="hideDocumentPopup"
        />
      </div>
    </OverlayPanel>

    <OverlayPanel
      v-if="archiveDialog && archivePasswordRequired"
      :visible="true"
      :z-index="1100"
      :close-on-escape="true"
      panel-class="max-w-md p-5"
      data-testid="archive-password-modal"
      :data-mode="archiveDialog.kind"
      role="dialog"
      :aria-modal="true"
      :aria-label="
        archiveDialog.kind === 'compress'
          ? t('fileManager.archivePassword.compressTitle')
          : t('fileManager.archivePassword.decompressTitle')
      "
      @close="closeArchiveDialog"
    >
      <form @submit.prevent="submitArchive">
        <div class="mb-4 flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="text-lg font-semibold">
              {{
                archiveDialog.kind === 'compress'
                  ? t('fileManager.archivePassword.compressTitle')
                  : t('fileManager.archivePassword.decompressTitle')
              }}
            </h3>
            <p class="mt-1 text-sm text-text-secondary">
              {{
                archiveDialog.kind === 'compress'
                  ? t('fileManager.archivePassword.compressDescription', { count: archiveDialog.entries.length })
                  : t('fileManager.archivePassword.decompressDescription', {
                      name: archiveDialog.entries[0]?.name || archiveDialog.entries[0]?.path || 'zip',
                    })
              }}
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 text-text-secondary hover:text-foreground"
            :aria-label="t('fileManager.modals.buttons.close')"
            @click="() => closeArchiveDialog()"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div class="space-y-4">
          <label class="block">
            <span class="mb-1 block text-sm font-medium text-text-secondary">{{
              t('fileManager.archivePassword.password')
            }}</span>
            <input
              v-model="archivePassword"
              data-testid="archive-password-input"
              :type="archiveShowPassword ? 'text' : 'password'"
              :autocomplete="archiveDialog.kind === 'compress' ? 'new-password' : 'current-password'"
              class="w-full rounded-md border border-border bg-input px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>

          <label v-if="archiveDialog.kind === 'compress'" class="block">
            <span class="mb-1 block text-sm font-medium text-text-secondary">{{
              t('fileManager.archivePassword.confirmPassword')
            }}</span>
            <input
              v-model="archiveConfirmPassword"
              data-testid="archive-password-confirm"
              :type="archiveShowPassword ? 'text' : 'password'"
              autocomplete="new-password"
              class="w-full rounded-md border border-border bg-input px-3 py-2 text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>

          <label class="flex cursor-pointer select-none items-center gap-2 text-sm text-text-secondary">
            <input v-model="archiveShowPassword" type="checkbox" class="accent-primary" />
            {{ t('fileManager.archivePassword.showPassword') }}
          </label>

          <p v-if="archivePasswordError" data-testid="archive-password-error" class="text-sm text-error" role="alert">
            {{ archivePasswordError }}
          </p>
          <p class="text-xs text-text-secondary">{{ t('fileManager.archivePassword.compatibilityNotice') }}</p>
        </div>

        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            class="rounded-md border border-border px-4 py-2 text-text-secondary hover:bg-border"
            @click="() => closeArchiveDialog()"
          >
            {{ t('fileManager.modals.buttons.cancel') }}
          </button>
          <button
            data-testid="archive-password-submit"
            type="submit"
            :disabled="archivePasswordInvalid"
            class="rounded-md bg-primary px-4 py-2 text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {{
              archiveDialog.kind === 'compress'
                ? t('fileManager.archivePassword.create')
                : t('fileManager.archivePassword.extract')
            }}
          </button>
        </div>
      </form>
    </OverlayPanel>

    <BaseModal
      v-else
      :visible="Boolean(archiveDialog)"
      :title="
        archivePasswordRequired
          ? archiveDialog?.kind === 'compress'
            ? t('fileManager.archivePassword.compressTitle')
            : t('fileManager.archivePassword.decompressTitle')
          : archiveDialog?.kind === 'compress'
            ? t('fileManager.contextMenu.compress')
            : t('fileManager.contextMenu.decompress')
      "
      @close="closeArchiveDialog"
    >
      <form
        data-testid="archive-password-modal"
        :data-mode="archiveDialog?.kind"
        class="space-y-4"
        @submit.prevent="submitArchive"
      >
        <div class="max-h-40 overflow-auto rounded border border-border p-2 text-sm">
          <div v-for="entry in archiveDialog?.entries ?? []" :key="entry.path" class="truncate">{{ entry.path }}</div>
        </div>
        <template v-if="archiveDialog?.kind === 'compress'">
          <BaseFormField :label="t('workspace.archive.format')" for-id="archive-format">
            <BaseSelect id="archive-format" v-model="archiveFormat" :disabled="archivePasswordRequired">
              <option value="zip">zip</option>
              <option value="tar.gz">tar.gz</option>
              <option value="tar.bz2">tar.bz2</option>
            </BaseSelect>
          </BaseFormField>
          <template v-if="archivePasswordAvailable">
            <BaseFormField
              :label="t('fileManager.archivePassword.password')"
              for-id="archive-password"
              :required="archivePasswordRequired"
            >
              <BaseInput
                id="archive-password"
                v-model="archivePassword"
                data-testid="archive-password-input"
                :type="archiveShowPassword ? 'text' : 'password'"
              />
            </BaseFormField>
            <BaseFormField
              v-if="archivePassword"
              :label="t('fileManager.archivePassword.confirmPassword')"
              for-id="archive-password-confirm"
              :required="archivePasswordRequired"
            >
              <BaseInput
                id="archive-password-confirm"
                v-model="archiveConfirmPassword"
                data-testid="archive-password-confirm"
                :type="archiveShowPassword ? 'text' : 'password'"
              />
            </BaseFormField>
          </template>
          <BaseFormField :label="t('workspace.transfer.destination')" for-id="archive-destination">
            <BaseInput id="archive-destination" v-model="archiveDestination" />
          </BaseFormField>
        </template>
        <BaseFormField
          v-else-if="archivePasswordAvailable"
          :label="t('fileManager.archivePassword.password')"
          for-id="archive-password"
          required
        >
          <BaseInput
            id="archive-password"
            v-model="archivePassword"
            data-testid="archive-password-input"
            :type="archiveShowPassword ? 'text' : 'password'"
          />
        </BaseFormField>
        <label v-if="archivePasswordAvailable" class="flex items-center gap-2 text-sm text-text-secondary">
          <BaseCheckbox v-model="archiveShowPassword" />{{ t('fileManager.archivePassword.showPassword') }}
        </label>
        <p v-if="archivePasswordError" data-testid="archive-password-error" class="text-sm text-error" role="alert">
          {{ archivePasswordError }}
        </p>
        <p v-if="archivePasswordAvailable" class="text-xs text-text-secondary">
          {{ t('fileManager.archivePassword.compatibilityNotice') }}
        </p>
        <div class="flex justify-end gap-2">
          <BaseButton type="button" @click="() => closeArchiveDialog()">{{ t('common.cancel') }}</BaseButton>
          <BaseButton
            data-testid="archive-password-submit"
            type="submit"
            variant="primary"
            :disabled="archivePasswordInvalid"
          >
            {{
              archivePasswordRequired
                ? archiveDialog?.kind === 'compress'
                  ? t('fileManager.archivePassword.create')
                  : t('fileManager.archivePassword.extract')
                : t('common.confirm')
            }}
          </BaseButton>
        </div>
      </form>
    </BaseModal>
  </div>
</template>

<style scoped>
  :global(.workspace-preview-overlay) {
    background-color: rgb(0 0 0 / 80%) !important;
    padding-top: max(0.75rem, env(safe-area-inset-top)) !important;
    padding-right: max(0.75rem, env(safe-area-inset-right)) !important;
    padding-bottom: max(0.75rem, env(safe-area-inset-bottom)) !important;
    padding-left: max(0.75rem, env(safe-area-inset-left)) !important;
  }

  @media (min-width: 768px) {
    :global(.workspace-preview-overlay) {
      padding-top: max(1.5rem, env(safe-area-inset-top)) !important;
      padding-right: max(1.5rem, env(safe-area-inset-right)) !important;
      padding-bottom: max(1.5rem, env(safe-area-inset-bottom)) !important;
      padding-left: max(1.5rem, env(safe-area-inset-left)) !important;
    }
  }
</style>
