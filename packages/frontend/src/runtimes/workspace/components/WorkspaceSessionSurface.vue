<script setup lang="ts">
  import { useI18n } from 'vue-i18n';
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
  import {
    BaseButton,
    BaseCheckbox,
    BaseFormField,
    BaseInput,
    BaseModal,
    BaseSelect,
    OverlayPanel,
  } from '@/foundation/ui';
  import { useResizeHandle } from '@/foundation/interaction';
  import { useFeedback } from '@/shared/feedback/public';
  import { FilePreview, previewKindFor } from '@/features/file-preview/public';
  import { FileEditor, type FileEditorSessionController } from '@/features/file-editor/public';
  import { applyTerminalModifiers, type TerminalChannel, type TerminalVisualOptions } from '@/features/terminal/public';
  import {
    ProgressCenter,
    SendFilesModal,
    UploadConflictModal,
    type ArchiveTransferErrorCode,
    type SendFileSourceItem,
  } from '@/features/transfers/public';
  import {
    FileManager,
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
  const documentPopupVisible = ref(false);
  const fileManagerPopupVisible = ref(false);
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
  const initialEditorPopupSize = defaultEditorPopupSize();
  const editorPopupWidth = ref(initialEditorPopupSize.width);
  const editorPopupHeight = ref(initialEditorPopupSize.height);
  const popupEditorRef = ref<InstanceType<typeof FileEditor> | null>(null);
  const popupPreviewRef = ref<InstanceType<typeof FilePreview> | null>(null);
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
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 240), Math.max(240, window.innerWidth * 0.6)) : 350;
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
    minWidth: 240,
    minHeight: 0,
    maxWidth: () => Math.max(240, window.innerWidth * 0.6),
    onEnd: ({ width }) => {
      if (activeLeftSidebar.value) emit('sidebarWidth', activeLeftSidebar.value, `${Math.round(width)}px`);
    },
  });
  const rightResize = useResizeHandle({
    width: rightSidebarWidth,
    height: rightResizeHeight,
    minWidth: 240,
    minHeight: 0,
    maxWidth: () => Math.max(240, window.innerWidth * 0.6),
    widthDirection: -1,
    onEnd: ({ width }) => {
      if (activeRightSidebar.value) emit('sidebarWidth', activeRightSidebar.value, `${Math.round(width)}px`);
    },
  });
  const clampEditorPopupSize = () => {
    if (props.mobile) return;
    editorPopupWidth.value = Math.min(
      Math.max(editorPopupResponsiveMinWidth(), editorPopupWidth.value),
      editorPopupAvailableWidth(),
    );
    editorPopupHeight.value = Math.min(
      Math.max(editorPopupResponsiveMinHeight(), editorPopupHeight.value),
      editorPopupAvailableHeight(),
    );
  };
  const restoreEditorPopupSize = () => {
    if (props.mobile) return;
    try {
      const raw = localStorage.getItem(EDITOR_POPUP_SIZE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
        if (typeof parsed.width === 'number' && Number.isFinite(parsed.width) && parsed.width > 0) {
          editorPopupWidth.value = parsed.width;
        }
        if (typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 0) {
          editorPopupHeight.value = parsed.height;
        }
      } else {
        const fallback = defaultEditorPopupSize();
        editorPopupWidth.value = fallback.width;
        editorPopupHeight.value = fallback.height;
      }
    } catch {
      const fallback = defaultEditorPopupSize();
      editorPopupWidth.value = fallback.width;
      editorPopupHeight.value = fallback.height;
    }
    clampEditorPopupSize();
  };
  const persistEditorPopupSize = () => {
    if (props.mobile) return;
    try {
      localStorage.setItem(
        EDITOR_POPUP_SIZE_KEY,
        JSON.stringify({ width: Math.round(editorPopupWidth.value), height: Math.round(editorPopupHeight.value) }),
      );
    } catch {
      // Browser-local presentation state may remain in memory when storage is unavailable.
    }
  };
  const editorPopupResize = useResizeHandle({
    width: editorPopupWidth,
    height: editorPopupHeight,
    minWidth: editorPopupResponsiveMinWidth,
    minHeight: editorPopupResponsiveMinHeight,
    maxWidth: editorPopupAvailableWidth,
    maxHeight: editorPopupAvailableHeight,
    canStart: () => !props.mobile,
    onEnd: persistEditorPopupSize,
  });
  const editorPopupStyle = computed(() =>
    props.mobile
      ? { width: '100vw', height: '100dvh', maxWidth: '100vw', maxHeight: '100dvh', borderRadius: '0' }
      : { width: `${editorPopupWidth.value}px`, height: `${editorPopupHeight.value}px` },
  );
  const previewPopupStyle = computed(() =>
    props.mobile
      ? { width: '100vw', height: '100dvh', maxWidth: '100vw', maxHeight: '100dvh', borderRadius: '0' }
      : { width: 'min(1400px, calc(100vw - 3rem))', height: '94dvh', maxWidth: '1400px', maxHeight: '94dvh' },
  );
  onMounted(() => window.addEventListener('resize', clampEditorPopupSize));
  onBeforeUnmount(() => window.removeEventListener('resize', clampEditorPopupSize));
  watch(
    () => [documentPopupVisible.value, props.mobile] as const,
    ([visible, mobile]) => {
      if (visible && !mobile) restoreEditorPopupSize();
    },
  );

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

  const revealEmbeddedEditor = (): void => {
    if (props.showPopupFileManager) fileManagerPopupVisible.value = false;
  };

  const openFile = async (path: string) => {
    const previewKind = previewKindFor(path);
    if (props.mobile) {
      mobilePane.value = 'editor';
      await nextTick();
      await nextTick();
    }
    if (previewKind !== 'unsupported') {
      documentMode.value = 'preview';
      documentPopupVisible.value = true;
      await nextTick();
      await popupPreviewRef.value?.open?.(path);
    } else {
      documentMode.value = 'editor';
      if (props.showPopupFileEditor) {
        documentPopupVisible.value = true;
        await nextTick();
        await popupEditorRef.value?.open?.(path);
      } else {
        revealEmbeddedEditor();
        await nextTick();
        await editorApi.value?.open?.(path);
      }
    }
  };

  const openFileAsText = async (path: string) => {
    if (props.mobile) {
      mobilePane.value = 'editor';
      await nextTick();
      await nextTick();
    }
    documentMode.value = 'editor';
    if (props.showPopupFileEditor) {
      documentPopupVisible.value = true;
      await nextTick();
      await popupEditorRef.value?.open?.(path);
    } else {
      revealEmbeddedEditor();
      await nextTick();
      await editorApi.value?.open?.(path);
    }
  };

  const editPreview = async (path: string) => {
    const activePreview = previewSession.active.value;
    if (activePreview) previewSession.close(activePreview.id);
    documentMode.value = 'editor';
    if (props.showPopupFileEditor) {
      documentPopupVisible.value = true;
      await nextTick();
      await popupEditorRef.value?.open?.(path);
      popupEditorRef.value?.focus?.();
    } else {
      documentPopupVisible.value = false;
      revealEmbeddedEditor();
      await nextTick();
      await editorApi.value?.open?.(path);
      await nextTick();
      editorApi.value?.focus?.();
    }
  };
  const hideDocumentPopup = () => {
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
      await transfers.copyMove({
        kind: 'move',
        sources: entries.map((entry) => ({ scopeId: props.session.id, path: entry.path })),
        destination: { scopeId: props.session.id, path: destination },
      });
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
      if (
        task.status !== 'error' ||
        !task.errorCode ||
        !['PASSWORD_REQUIRED', 'INVALID_PASSWORD', 'PASSWORD_TOO_LONG', 'INVALID_PASSWORD_FORMAT'].includes(
          task.errorCode,
        ) ||
        submissionGeneration !== archivePromptGeneration ||
        archiveDialog.value
      ) {
        return;
      }
      openArchivePasswordPrompt(requestContext, task.errorCode, task.error ?? '');
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
    class="relative flex h-full min-h-0 overflow-hidden bg-background"
    :class="mobile ? 'flex-col' : 'flex-row'"
    @pointerdown.capture="handleSurfacePointerDown"
  >
    <nav
      v-if="!mobile && sidebars.left.length"
      data-workspace-sidebar
      class="flex w-10 shrink-0 flex-col border-r border-border bg-header/60 py-1"
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
      class="relative shrink-0 border-r border-border"
      :style="{ width: `${leftSidebarWidth}px` }"
    >
      <div class="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize" @pointerdown="leftResize.startResize"></div>
      <WorkspaceLayoutRenderer
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
      class="relative shrink-0 border-l border-border"
      :style="{ width: `${rightSidebarWidth}px` }"
    >
      <div class="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize" @pointerdown="rightResize.startResize"></div>
      <WorkspaceLayoutRenderer
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
      class="flex w-10 shrink-0 flex-col border-l border-border bg-header/60 py-1"
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
      v-if="transfers.tasks.value.length && progressVisible"
      :tasks="transfers.tasks.value"
      @cancel="transfers.cancel"
      @cancel-all="transfers.cancelAll"
      @hide="progressVisible = false"
      @remove="
        (id) => {
          const index = transfers.tasks.value.findIndex((task) => task.id === id);
          if (index >= 0) transfers.tasks.value.splice(index, 1);
        }
      "
    />
    <BaseButton
      v-else-if="transfers.tasks.value.length"
      class="absolute bottom-3 right-12 z-30 shadow-lg"
      size="sm"
      @click="progressVisible = true"
      >{{ t('progressCenter.title') }} ({{ transfers.tasks.value.length }})</BaseButton
    >
    <SendFilesModal
      :visible="Boolean(sendFilesItems.length)"
      :source-connection-id="session.connection.id"
      :items="sendFilesItems"
      @close="sendFilesItems = []"
      @sent="emit('serverTransferStarted')"
    />
    <UploadConflictModal
      :visible="Boolean(transfers.conflict.value)"
      :path="transfers.conflict.value?.path"
      @resolve="transfers.resolveConflict"
    />

    <BaseModal
      data-testid="file-manager-modal"
      :visible="fileManagerPopupVisible"
      :title="t('fileManager.modalTitle')"
      panel-class="h-[min(900px,94vh)] w-[min(1200px,96vw)]"
      content-class="!overflow-visible"
      @close="fileManagerPopupVisible = false"
    >
      <template #header-actions>
        <BaseButton
          data-testid="file-manager-modal-close"
          size="sm"
          variant="ghost"
          @click="fileManagerPopupVisible = false"
          >×</BaseButton
        >
      </template>
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
        @open-file="(entry) => openFile(entry.path)"
        @open-as-text="(entry) => openFileAsText(entry.path)"
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
    </BaseModal>

    <OverlayPanel
      data-testid="document-popup"
      :data-document-mode="documentMode"
      :visible="documentPopupVisible"
      :keep-mounted="true"
      teleport
      :z-index="50"
      :close-on-backdrop="true"
      :close-on-escape="true"
      :focus-on-open="true"
      :restore-focus="true"
      panel-class="flex min-h-0 flex-col overflow-hidden !max-h-none !max-w-none"
      :panel-style="documentMode === 'preview' ? previewPopupStyle : editorPopupStyle"
      :overlay-class="mobile ? '!p-0' : ''"
      role="dialog"
      :aria-modal="true"
      :aria-label="documentMode === 'preview' ? t('fileManager.preview.openFiles') : t('settings.popupEditor.title')"
      @close="hideDocumentPopup"
    >
      <div class="relative flex h-full min-h-0 flex-col">
        <div v-if="showPopupFileEditor" class="flex items-center gap-1 border-b border-border bg-header/50 px-2 py-1">
          <BaseButton
            size="sm"
            :variant="documentMode === 'editor' ? 'primary' : 'ghost'"
            @click="documentMode = 'editor'"
            >{{ t('workspace.documents.editor') }}</BaseButton
          >
          <BaseButton
            size="sm"
            :variant="documentMode === 'preview' ? 'primary' : 'ghost'"
            @click="documentMode = 'preview'"
            >{{ t('workspace.documents.preview') }}</BaseButton
          >
          <BaseButton
            v-if="documentMode === 'editor'"
            class="ml-auto min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
            size="sm"
            variant="ghost"
            :title="t('common.close')"
            @click="closeDocumentPopup"
            >×</BaseButton
          >
        </div>
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
          @font-size="emit('editorFontSize', $event)"
          @mobile-font-size="emit('mobileEditorFontSize', $event)"
        />
        <button
          v-if="!mobile && documentMode === 'editor'"
          type="button"
          class="absolute bottom-0 right-0 z-20 h-5 w-5 cursor-nwse-resize"
          :title="t('fileEditor.resizePopup')"
          @pointerdown.stop="editorPopupResize.startResize"
        ></button>
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
        />
      </div>
    </OverlayPanel>

    <BaseModal
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
          <BaseButton type="button" @click="closeArchiveDialog">{{ t('common.cancel') }}</BaseButton>
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
