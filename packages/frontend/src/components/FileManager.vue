<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, watchEffect, provide, type Component, type PropType, readonly, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import { createSftpActionsManager, type WebSocketDependencies } from '../composables/useSftpActions';
import { useFileUploader } from '../composables/useFileUploader';
import { useFileEditorStore, type FileInfo } from '../stores/fileEditor.store';
import { useSessionStore } from '../stores/session.store';
import { useFileClipboardStore } from '../stores/fileClipboard.store';
import { useSettingsStore } from '../stores/settings.store';
import { useFocusSwitcherStore } from '../stores/focusSwitcher.store';
import { useFileManagerContextMenu, type CompressFormat } from '../composables/file-manager/useFileManagerContextMenu';
import { useFileManagerSelection } from '../composables/file-manager/useFileManagerSelection';
import { useFileManagerDragAndDrop } from '../composables/file-manager/useFileManagerDragAndDrop';
import { useFileManagerKeyboardNavigation } from '../composables/file-manager/useFileManagerKeyboardNavigation';
import FileUploadPopup from './FileUploadPopup.vue';
import FileTransferPopup from './FileTransferPopup.vue';
import FileManagerContextMenu from './FileManagerContextMenu.vue';
import FileManagerActionModal from './FileManagerActionModal.vue';
import ArchivePasswordModal from './ArchivePasswordModal.vue';
import UploadConflictModal from './UploadConflictModal.vue';
import type { FileListItem } from '../types/sftp.types';
import type { WebSocketMessage } from '../types/websocket.types';
import PathHistoryDropdown from './PathHistoryDropdown.vue';
import { usePathHistoryStore } from '../stores/pathHistory.store';
import FavoritePathsModal from './FavoritePathsModal.vue';
import ArchiveProgressPopup from './ArchiveProgressPopup.vue';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import { resolveFilePreviewProvider } from '../composables/file-preview/registry';
import { filePreviewTabsContextKey } from '../composables/file-preview/tabsContext';
import { createWheelScaleResolver } from '@/foundation/interaction/wheelScale';
import { createLatestValueSaver } from '@/foundation/async/latestValueSaver';
import { useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../composables/workspaceEvents';


type SftpManagerInstance = ReturnType<typeof createSftpActionsManager>;


// --- Props ---
const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  // 文件管理器实例 ID
  instanceId: {
    type: String,
    required: true,
  },
  // 注入数据库连接 ID
  dbConnectionId: {
    type: String,
    required: true,
  },
  // 注入此组件及其子 composables 所需的 WebSocket 依赖项
  wsDeps: {
    type: Object as PropType<WebSocketDependencies>,
    required: true,
  },
  isMobile: {
    type: Boolean,
    default: false
  }
});

// --- 核心 Composables ---
const { t } = useI18n();
const route = useRoute(); // Keep for download URL generation for now
const sessionStore = useSessionStore(); // 实例化 Session Store
const fileClipboardStore = useFileClipboardStore();
const { clipboardState, sourceSessionId: clipboardSourceSessionId, sourcePaths: clipboardSourcePaths, sourceBaseDir: clipboardSourceBaseDir } = storeToRefs(fileClipboardStore);
const effectiveSessionId = computed(() => sessionStore.resolveSessionId(props.sessionId));

// --- 获取并存储 SFTP 管理器实例 ---
// 使用 shallowRef 存储管理器实例，以便在 sessionId 变化时切换
const currentSftpManager = shallowRef<SftpManagerInstance | null>(null);

interface PreviewTabEntry {
  id: string;
  file: FileListItem;
  filePath: string;
  component: Component;
  componentProps: Record<string, unknown>;
  dispose?: () => void;
}

const previewTabs = shallowRef<PreviewTabEntry[]>([]);
const activePreviewId = ref<string | null>(null);
const previewWorkspaceVisible = ref(false);
const previewAbortController = shallowRef<AbortController | null>(null);
const isPreviewLoading = ref(false);
const previewRefreshControllers = new Map<string, AbortController>();
const refreshingPreviewIds = shallowRef<Set<string>>(new Set());
let previewLoadToken = 0;

const activePreviewEntry = computed(() => (
  previewTabs.value.find((entry) => entry.id === activePreviewId.value) ?? null
));
const previewTabDescriptors = computed(() => previewTabs.value.map((entry) => ({
  id: entry.id,
  filename: entry.file.filename,
  filePath: entry.filePath,
})));

const cancelPendingPreviewLoad = () => {
  previewLoadToken += 1;
  previewAbortController.value?.abort();
  previewAbortController.value = null;
  isPreviewLoading.value = false;
};

const hidePreview = () => {
  cancelPendingPreviewLoad();
  previewWorkspaceVisible.value = false;
};

const setPreviewRefreshing = (tabId: string, refreshing: boolean) => {
  const next = new Set(refreshingPreviewIds.value);
  if (refreshing) next.add(tabId);
  else next.delete(tabId);
  refreshingPreviewIds.value = next;
};

const activatePreviewTab = (tabId: string) => {
  if (!previewTabs.value.some((entry) => entry.id === tabId)) return;
  activePreviewId.value = tabId;
  previewWorkspaceVisible.value = true;
};

const closePreviewTab = (tabId: string) => {
  const index = previewTabs.value.findIndex((entry) => entry.id === tabId);
  if (index < 0) return;

  previewRefreshControllers.get(tabId)?.abort();
  previewRefreshControllers.delete(tabId);
  setPreviewRefreshing(tabId, false);
  const [entry] = previewTabs.value.slice(index, index + 1);
  entry?.dispose?.();
  const nextTabs = previewTabs.value.filter((candidate) => candidate.id !== tabId);
  previewTabs.value = nextTabs;

  if (activePreviewId.value === tabId) {
    const nextActive = nextTabs[index] ?? nextTabs[index - 1] ?? null;
    activePreviewId.value = nextActive?.id ?? null;
  }
  if (nextTabs.length === 0) previewWorkspaceVisible.value = false;
};

const closeAllPreviews = () => {
  cancelPendingPreviewLoad();
  for (const controller of previewRefreshControllers.values()) controller.abort();
  previewRefreshControllers.clear();
  refreshingPreviewIds.value = new Set();
  for (const entry of previewTabs.value) entry.dispose?.();
  previewTabs.value = [];
  activePreviewId.value = null;
  previewWorkspaceVisible.value = false;
};

const refreshPreviewTab = async (tabId: string): Promise<void> => {
  const entry = previewTabs.value.find((candidate) => candidate.id === tabId);
  if (!entry || previewRefreshControllers.has(tabId)) return;

  const previewProvider = resolveFilePreviewProvider(entry.file);
  if (!previewProvider) return;

  const abortController = new AbortController();
  const refreshKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  previewRefreshControllers.set(tabId, abortController);
  setPreviewRefreshing(tabId, true);

  try {
    const data = await previewProvider.load(entry.file, {
      filePath: entry.filePath,
      signal: abortController.signal,
      buildInlineUrl: (path) => buildInlinePreviewUrl(path, refreshKey),
      fetchInline: (path = entry.filePath) => fetchInlinePreview(path, abortController.signal, refreshKey),
    });

    if (abortController.signal.aborted) {
      data.dispose?.();
      return;
    }

    const currentEntry = previewTabs.value.find((candidate) => candidate.id === tabId);
    if (!currentEntry) {
      data.dispose?.();
      return;
    }

    const previousDispose = currentEntry.dispose;
    previewTabs.value = previewTabs.value.map((candidate) => (
      candidate.id === tabId
        ? {
            ...candidate,
            componentProps: data.componentProps,
            dispose: data.dispose,
          }
        : candidate
    ));

    // Allow mounted preview components to observe their new props before old
    // PDF workers / object resources are released.
    await nextTick();
    try {
      previousDispose?.();
    } catch (disposeError) {
      console.warn('[FileManager] Failed disposing previous preview resources after refresh', disposeError);
    }
  } catch (error) {
    if (abortController.signal.aborted) return;
    console.error('[FileManager] Failed refreshing preview data', error);
    uiNotificationsStore.showError(t('fileManager.preview.refreshFailed'));
  } finally {
    if (previewRefreshControllers.get(tabId) === abortController) {
      previewRefreshControllers.delete(tabId);
      setPreviewRefreshing(tabId, false);
    }
  }
};

provide(filePreviewTabsContextKey, {
  tabs: previewTabDescriptors,
  activeTabId: computed(() => activePreviewId.value),
  refreshingTabIds: computed(() => refreshingPreviewIds.value),
  activate: activatePreviewTab,
  close: closePreviewTab,
  refresh: refreshPreviewTab,
  hide: hidePreview,
});

const pendingPathResolutionCleanups = new Set<() => void>();

const cancelPendingPathResolutions = () => {
  for (const cleanup of [...pendingPathResolutionCleanups]) cleanup();
};
const sftpReadyStateByManager = new WeakMap<SftpManagerInstance, boolean>();

const initializeSftpManager = (sessionId: string, instanceId: string) => {
    const manager = sessionStore.getOrCreateSftpManager(sessionId, instanceId);
    if (!manager) {
        // 抛出错误或显示错误消息，阻止组件进一步渲染
        console.error(`[FileManager ${sessionId}-${instanceId}] Failed to get or create SFTP manager instance.`);
        // 可以设置一个错误状态 ref 在模板中显示
        // managerError.value = `Failed to get SFTP manager for instance ${instanceId}`;
        currentSftpManager.value = null; // 确保设置为 null
        // 抛出错误会阻止组件渲染，可能不是最佳用户体验
        // throw new Error(`[FileManager ${sessionId}-${instanceId}] Failed to get or create SFTP manager instance.`);
    } else {
         currentSftpManager.value = manager;
         console.log(`[FileManager ${sessionId}-${instanceId}] SFTP Manager initialized/retrieved.`);
    }
};

// 初始加载管理器
initializeSftpManager(effectiveSessionId.value, props.instanceId);

const emptyArchiveProgress = {
  active: false,
  operation: null as 'compress' | 'decompress' | null,
  requestId: null as string | null,
  cancelling: false,
  fileCount: 0,
  totalFiles: null as number | null,
  percent: null as number | null,
  currentFile: null as string | null,
  archiveName: null as string | null,
};
const archiveProgress = computed(() => currentSftpManager.value?.archiveProgress ?? emptyArchiveProgress);
const transferTasks = computed(() => currentSftpManager.value?.transferTasks ?? {});


// --- 文件上传模块 ---
// 修改：依赖 currentSftpManager 的状态
const {
    uploads,
    progressSourceId: uploadProgressSourceId,
    uploadConflict,
    startFileUploadBatch,
    cancelUpload,
    cancelAllUploads,
    resolveUploadConflict,
} = useFileUploader(
    effectiveSessionId,
    // 传递 manager 的 currentPath 和 fileList ref
    computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
    computed(() => currentSftpManager.value?.fileList.value ?? []),
    computed(() => props.wsDeps),
    props.instanceId,
);

const floatingProgressRestoreToken = ref(0);
const progressSessionLabel = computed(() => {
  const resolvedSessionId = effectiveSessionId.value;
  const session = sessionStore.sessions.get(resolvedSessionId);
  if (!session) return resolvedSessionId.slice(0, 8);

  const baseName = session.connectionName?.trim() || resolvedSessionId.slice(0, 8);
  const matchingSessions = [...sessionStore.sessions.values()]
    .filter(candidate => candidate.connectionName?.trim() === baseName)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (matchingSessions.length <= 1) return baseName;

  const index = matchingSessions.findIndex(candidate => candidate.sessionId === resolvedSessionId);
  return index >= 0 ? `${baseName} #${index + 1}` : baseName;
});
const onWorkspaceEvent = useWorkspaceEventSubscriber();
const offWorkspaceEvent = useWorkspaceEventOff();
const restoreFloatingProgress = () => {
  floatingProgressRestoreToken.value += 1;
};

// 实例化其他 Stores
const fileEditorStore = useFileEditorStore(); // 实例化 File Editor Store
// const sessionStore = useSessionStore(); // 已在上面实例化
const settingsStore = useSettingsStore(); // +++ 实例化 Settings Store +++
const focusSwitcherStore = useFocusSwitcherStore(); // +++ 实例化焦点切换 Store +++
const pathHistoryStore = usePathHistoryStore(); // +++ 实例化 PathHistoryStore +++
const uiNotificationsStore = useUiNotificationsStore(); // +++ 实例化通知 store +++
 
 // 从 Settings Store 获取共享设置
const {
  shareFileEditorTabsBoolean,
  fileManagerRowSizeMultiplierNumber, // +++ 获取行大小 getter +++
  fileManagerColWidthsObject, // +++ 获取列宽 getter +++
  showPopupFileEditorBoolean, // +++ 获取弹窗设置状态 +++
  fileManagerShowDeleteConfirmationBoolean, // +++ 获取删除确认设置状态 +++
} = storeToRefs(settingsStore); // 使用 storeToRefs 保持响应性
 
 

// --- UI 状态 Refs (Remain mostly the same) ---
const fileInputRef = ref<HTMLInputElement | null>(null);
const sortKey = ref<keyof FileListItem | 'type' | 'size' | 'mtime'>('filename');
const sortDirection = ref<'asc' | 'desc'>('asc');
const isEditingPath = ref(false);
const searchQuery = ref(''); // 搜索查询 ref
const isMultiSelectMode = ref(false); // 多选模式状态 (主要用于移动端)
const isSearchActive = ref(false); // 控制搜索框激活状态
const searchInputRef = ref<HTMLInputElement | null>(null); // 搜索输入框 ref
const pathInputRef = ref<HTMLInputElement | null>(null);
const editablePath = ref('');
const fileListContainerRef = ref<HTMLDivElement | null>(null); // 文件列表容器引用
const dropOverlayRef = ref<HTMLDivElement | null>(null); // +++ 拖拽蒙版引用 +++

// +++ Favorite Paths Modal State +++
const showFavoritePathsModal = ref(false);
const favoritePathsButtonRef = ref<HTMLButtonElement | null>(null); // Ref for the trigger button

// +++ Path History Refs +++
const showPathHistoryDropdown = ref(false);
const pathInputWrapperRef = ref<HTMLDivElement | null>(null); // Wrapper for path input and dropdown
const pathHistoryDropdownRef = ref<InstanceType<typeof PathHistoryDropdown> | null>(null);
const { selectedIndex: pathSelectedIndex, filteredHistory: filteredPathHistory } = storeToRefs(pathHistoryStore); // Reactive store state

// +++ 操作模态框状态 +++
const isActionModalVisible = ref(false);
const currentActionType = ref<'delete' | 'rename' | 'chmod' | 'newFile' | 'newFolder' | null>(null);
const actionItem = ref<FileListItem | null>(null); // For single item operations
const actionItems = ref<FileListItem[]>([]); // For multi-item operations (e.g., delete)
const actionInitialValue = ref(''); // For pre-filling input in modal

const archivePasswordModalVisible = ref(false);
const archivePasswordMode = ref<'compress' | 'decompress' | null>(null);
const archivePasswordItems = ref<FileListItem[]>([]);
const archivePasswordItem = ref<FileListItem | null>(null);
const archivePasswordError = ref('');

// 文件剪贴板由 Pinia 全局共享，支持跨会话/跨主机粘贴。

const rowSizeMultiplier = ref(1.0); // 行大小（字体）乘数, 默认值会被 store 覆盖
const FILE_MANAGER_SCALE_MIN = 0.5;
const FILE_MANAGER_SCALE_MAX = 2;
const FILE_MANAGER_SCALE_STEP = 0.08;
const resolveFileManagerWheelScale = createWheelScaleResolver({
  min: FILE_MANAGER_SCALE_MIN,
  max: FILE_MANAGER_SCALE_MAX,
  step: FILE_MANAGER_SCALE_STEP,
  precision: 2,
  thresholdPx: 72,
});
const rowScaleSyncLocked = ref(false);
const isSyncingPathFromTerminal = ref(false);
const isChangingTerminalPath = ref(false);
let silentExecCleanup: (() => void) | null = null;
let terminalPathChangeCleanup: (() => void) | null = null;
// --- 键盘导航状态 (移至 useFileManagerKeyboardNavigation) ---
// const selectedIndex = ref<number>(-1);

// --- Column Resizing State (Remains the same) ---
const tableRef = ref<HTMLTableElement | null>(null);
const colWidths = ref({ // 默认值会被 store 覆盖
    type: 50,
    name: 300,
    size: 100,
    permissions: 120,
    modified: 180,
});
const totalColumnWidth = computed(() => Object.values(colWidths.value).reduce((sum, width) => sum + width, 0));
const isResizing = ref(false);
const resizingColumnIndex = ref(-1);
const startX = ref(0);
const startWidth = ref(0);

// --- 辅助函数 ---
const generateRequestId = (): string => `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;


// UI 格式化函数保持不变
const formatSize = (size: number): string => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatMode = (mode: number): string => {
    const perm = mode & 0o777; let str = '';
    str += (perm & 0o400) ? 'r' : '-'; str += (perm & 0o200) ? 'w' : '-'; str += (perm & 0o100) ? 'x' : '-';
    str += (perm & 0o040) ? 'r' : '-'; str += (perm & 0o020) ? 'w' : '-'; str += (perm & 0o010) ? 'x' : '-';
    str += (perm & 0o004) ? 'r' : '-'; str += (perm & 0o002) ? 'w' : '-'; str += (perm & 0o001) ? 'x' : '-';
    return str;
};

const getFileIconClassBase = (filename: string): string => {
  const lowerFilename = filename.toLowerCase();
  let extension = '';
  const lastDotIndex = lowerFilename.lastIndexOf('.');

  if (lastDotIndex > 0 && lastDotIndex < lowerFilename.length - 1) { // e.g. file.txt
    extension = lowerFilename.substring(lastDotIndex + 1);
  } else if (lastDotIndex === 0 && lowerFilename.length > 1) { // e.g. .bashrc, .gitignore
    extension = lowerFilename.substring(1); // use 'bashrc' or 'gitignore' as extension
  }
  // Handle specific full filenames first for higher precedence
  if (lowerFilename === 'makefile') return 'fas fa-cogs';
  if (lowerFilename === 'dockerfile') return 'fab fa-docker';
  if (lowerFilename.endsWith('docker-compose.yml') || lowerFilename.endsWith('docker-compose.yaml')) return 'fab fa-docker';
  if (lowerFilename === 'package.json') return 'fab fa-npm';
  if (lowerFilename === 'package-lock.json') return 'fab fa-npm';
  if (lowerFilename === 'yarn.lock') return 'fab fa-yarn';
  if (lowerFilename === 'composer.json') return 'fab fa-php';
  if (lowerFilename === 'composer.lock') return 'fab fa-php';
  if (lowerFilename === 'gemfile') return 'fas fa-gem';
  if (lowerFilename === 'gemfile.lock') return 'fas fa-gem';
  if (lowerFilename.startsWith('.env')) return 'fas fa-shield-alt';
  if (lowerFilename === '.git') return 'fab fa-git-alt';
  if (lowerFilename === '.gitignore') return 'fab fa-git-alt';
  if (lowerFilename === '.gitattributes') return 'fab fa-git-alt';
  if (lowerFilename === '.gitmodules') return 'fab fa-git-alt';
  if (lowerFilename === 'readme' || lowerFilename.startsWith('readme.')) return 'fas fa-book-reader';
  if (lowerFilename === 'license' || lowerFilename.startsWith('license.')) return 'fas fa-balance-scale';
  if (lowerFilename === 'contributing' || lowerFilename.startsWith('contributing.')) return 'fas fa-users-cog';
  if (lowerFilename === 'code_of_conduct' || lowerFilename.startsWith('code_of_conduct.')) return 'fas fa-gavel';
  if (lowerFilename === 'changelog' || lowerFilename.startsWith('changelog.')) return 'fas fa-list-alt';
  if (lowerFilename === 'favicon.ico') return 'fas fa-icons';


  const iconMap: { [key: string]: string } = {
    // Images
    'jpg': 'fas fa-file-image', 'jpeg': 'fas fa-file-image', 'png': 'fas fa-file-image',
    'gif': 'fas fa-file-image', 'bmp': 'fas fa-file-image', 'svg': 'fas fa-file-image',
    'webp': 'fas fa-file-image', 'ico': 'fas fa-file-image', 'tiff': 'fas fa-file-image',
    // Videos
    'mp4': 'fas fa-file-video', 'mkv': 'fas fa-file-video', 'avi': 'fas fa-file-video',
    'mov': 'fas fa-file-video', 'wmv': 'fas fa-file-video', 'flv': 'fas fa-file-video', 'webm': 'fas fa-file-video',
    // Audio
    'mp3': 'fas fa-file-audio', 'wav': 'fas fa-file-audio', 'ogg': 'fas fa-file-audio',
    'flac': 'fas fa-file-audio', 'aac': 'fas fa-file-audio', 'm4a': 'fas fa-file-audio',
    // Documents
    'doc': 'fas fa-file-word', 'docx': 'fas fa-file-word',
    'xls': 'fas fa-file-excel', 'xlsx': 'fas fa-file-excel',
    'ppt': 'fas fa-file-powerpoint', 'pptx': 'fas fa-file-powerpoint',
    'pdf': 'fas fa-file-pdf', 'odt': 'fas fa-file-alt', 'ods': 'fas fa-file-alt', 'odp': 'fas fa-file-alt',
    'rtf': 'fas fa-file-alt',
    'csv': 'fas fa-file-csv', 'tsv': 'fas fa-file-csv',
    // Archives
    'zip': 'fas fa-file-archive', 'rar': 'fas fa-file-archive', 'tar': 'fas fa-file-archive',
    'gz': 'fas fa-file-archive', '7z': 'fas fa-file-archive', 'bz2': 'fas fa-file-archive', 'xz': 'fas fa-file-archive',
    'iso': 'fas fa-compact-disc',
    // Code & Config
    'js': 'fab fa-js-square', 'mjs': 'fab fa-js-square', 'cjs': 'fab fa-js-square',
    'jsx': 'fab fa-react',
    'ts': 'fas fa-file-code',
    'tsx': 'fab fa-react',
    'vue': 'fab fa-vuejs',
    'svelte': 'fas fa-file-code',
    'py': 'fab fa-python', 'pyc': 'fab fa-python', 'pyd': 'fab fa-python', 'pyw': 'fab fa-python', 'ipynb': 'fab fa-python',
    'java': 'fab fa-java', 'jar': 'fab fa-java', 'class': 'fab fa-java',
    'kt': 'fas fa-file-code', 'kts': 'fas fa-file-code',
    'cs': 'fas fa-file-code',
    'fs': 'fas fa-file-code',
    'go': 'fas fa-file-code',
    'rs': 'fas fa-file-code',
    'c': 'fas fa-file-code', 'h': 'fas fa-file-code',
    'cpp': 'fas fa-file-code', 'hpp': 'fas fa-file-code', 'cxx': 'fas fa-file-code', 'hxx': 'fas fa-file-code',
    'rb': 'fas fa-gem', 'erb': 'fas fa-gem',
    'php': 'fab fa-php',
    'swift': 'fab fa-swift',
    'scala': 'fas fa-file-code',
    'perl': 'fas fa-file-code', 'pl': 'fas fa-file-code',
    'lua': 'fas fa-file-code',
    'dart': 'fas fa-file-code',
    'r': 'fas fa-file-code',
    'html': 'fab fa-html5', 'htm': 'fab fa-html5', 'xhtml': 'fab fa-html5',
    'css': 'fab fa-css3-alt',
    'scss': 'fab fa-sass', 'sass': 'fab fa-sass',
    'less': 'fab fa-less',
    'styl': 'fas fa-file-code',
    'json': 'fas fa-file-code', 'webmanifest': 'fas fa-file-code', 'jsonc': 'fas fa-file-code',
    'xml': 'fas fa-file-code', 'xsl': 'fas fa-file-code', 'xsd': 'fas fa-file-code',
    'yml': 'fas fa-cog', 'yaml': 'fas fa-cog',
    'ini': 'fas fa-cog', 'conf': 'fas fa-cog', 'cfg': 'fas fa-cog', 'config': 'fas fa-cog',
    'toml': 'fas fa-cog',
    'md': 'fab fa-markdown', 'markdown': 'fab fa-markdown',
    'sql': 'fas fa-database', 'ddl': 'fas fa-database',
    'db': 'fas fa-database', 'sqlite': 'fas fa-database', 'mdb': 'fas fa-database',
    'lock': 'fas fa-lock',
    'gitignore': 'fab fa-git-alt', /* 'gitattributes': 'fab fa-git-alt', */ /* 'gitmodules': 'fab fa-git-alt', */ 'gitkeep': 'fab fa-git-alt', // Removed duplicate gitattributes and gitmodules
    /* 'dockerfile': 'fab fa-docker', */ 'dockerignore': 'fab fa-docker', // Removed duplicate dockerfile
    'npmrc': 'fab fa-npm', 'yarnrc': 'fab fa-yarn', 'pnpmfile.js': 'fas fa-cogs',
    'babelrc': 'fas fa-cogs', 'eslintrc': 'fas fa-cogs', 'prettierrc': 'fas fa-cogs', 'stylelintrc': 'fas fa-cogs',
    'browserslistrc': 'fas fa-cogs', 'editorconfig': 'fas fa-cog',
    'tsconfig.json': 'fas fa-cogs', 'jsconfig.json': 'fas fa-cogs',
    'webpack.config.js': 'fas fa-cogs', 'vite.config.js': 'fas fa-cogs', 'vite.config.ts': 'fas fa-cogs',
    'rollup.config.js': 'fas fa-cogs', 'postcss.config.js': 'fas fa-cogs',
    'jest.config.js': 'fas fa-cogs', 'cypress.json': 'fas fa-cogs', 'playwright.config.ts': 'fas fa-cogs',
    // Text & Others
    'txt': 'fas fa-file-alt', 'text': 'fas fa-file-alt',
    'log': 'fas fa-file-alt', 'out': 'fas fa-file-alt', 'err': 'fas fa-file-alt',
    'key': 'fas fa-key', 'pem': 'fas fa-key', 'pub': 'fas fa-key', 'asc': 'fas fa-key',
    'crt': 'fas fa-certificate', 'cer': 'fas fa-certificate', 'csr': 'fas fa-certificate', 'pfx': 'fas fa-certificate', 'p12': 'fas fa-certificate',
    // Executables & scripts
    'exe': 'fas fa-cogs', 'msi': 'fas fa-cogs', 'app': 'fas fa-cogs', 'com': 'fas fa-cogs',
    'sh': 'fas fa-terminal', 'bash': 'fas fa-terminal', 'zsh': 'fas fa-terminal', 'fish': 'fas fa-terminal', 'csh': 'fas fa-terminal', 'ksh': 'fas fa-terminal',
    'bat': 'fas fa-terminal', 'cmd': 'fas fa-terminal', 'ps1': 'fas fa-terminal', 'psm1': 'fas fa-terminal',
    'vb': 'fas fa-file-code', 'vbs': 'fas fa-file-code',
    'deb': 'fas fa-archive', 'rpm': 'fas fa-archive', 'pkg': 'fas fa-archive',
    'dmg': 'fas fa-compact-disc',  'img': 'fas fa-compact-disc', 
    // Fonts
    'ttf': 'fas fa-font', 'otf': 'fas fa-font', 'woff': 'fas fa-font', 'woff2': 'fas fa-font', 'eot': 'fas fa-font',
    // Special hidden files (extension is the part after dot)
    'bashrc': 'fas fa-cog', 'zshrc': 'fas fa-cog', 'profile': 'fas fa-cog', 'bash_profile': 'fas fa-cog',
    'vimrc': 'fas fa-cog', 'screenrc': 'fas fa-cog', 'tmux.conf': 'fas fa-cog',
    'gitconfig': 'fab fa-git-alt', 'npmignore': 'fab fa-npm',
    'htaccess': 'fas fa-cog', 'htpasswd': 'fas fa-lock',
    // Default
    'default': 'far fa-file'
  };
  return iconMap[extension] || iconMap['default'];
};

// --- 排序与过滤逻辑 ---
// 修改：依赖 currentSftpManager.value.fileList
const sortedFileList = computed(() => {
    if (!currentSftpManager.value?.fileList.value) return []; // 检查 manager 和 fileList 是否存在
    const list = [...currentSftpManager.value.fileList.value]; // 从 manager 获取列表
    const key = sortKey.value;
    const direction = sortDirection.value === 'asc' ? 1 : -1;

    list.sort((a, b) => {
        if (key !== 'type') {
            if (a.attrs.isDirectory && !b.attrs.isDirectory) return -1;
            if (!a.attrs.isDirectory && b.attrs.isDirectory) return 1;
        }
        let valA: string | number | boolean;
        let valB: string | number | boolean;
        switch (key) {
            case 'type':
                valA = a.attrs.isDirectory ? 0 : (a.attrs.isSymbolicLink ? 1 : 2);
                valB = b.attrs.isDirectory ? 0 : (b.attrs.isSymbolicLink ? 1 : 2);
                break;
            case 'filename': valA = a.filename.toLowerCase(); valB = b.filename.toLowerCase(); break;
            case 'size': valA = a.attrs.isFile ? a.attrs.size : -1; valB = b.attrs.isFile ? b.attrs.size : -1; break;
            case 'mtime': valA = a.attrs.mtime; valB = b.attrs.mtime; break;
            default: valA = a.filename.toLowerCase(); valB = b.filename.toLowerCase();
        }
        if (valA < valB) return -1 * direction;
        if (valA > valB) return 1 * direction;
        if (key !== 'filename') return a.filename.localeCompare(b.filename);
        return 0;
    });
    return list;
});

const filteredFileList = computed(() => {
    if (!searchQuery.value) {
        return sortedFileList.value; // 如果没有搜索查询，返回原始排序列表
    }
    const lowerCaseQuery = searchQuery.value.toLowerCase();
    return sortedFileList.value.filter(item =>
        item.filename.toLowerCase().includes(lowerCaseQuery)
    );
});

const FILE_VIRTUALIZATION_THRESHOLD = 250;
const FILE_LIST_OVERSCAN = 12;
const fileListScrollTop = ref(0);
const fileListViewportHeight = ref(600);
let fileListResizeObserver: ResizeObserver | null = null;

const estimatedFileRowHeight = computed(() => Math.max(24, 34 * rowSizeMultiplier.value));
const shouldVirtualizeFileList = computed(() => filteredFileList.value.length > FILE_VIRTUALIZATION_THRESHOLD);
const virtualStartIndex = computed(() => {
    if (!shouldVirtualizeFileList.value) return 0;
    return Math.max(0, Math.floor(fileListScrollTop.value / estimatedFileRowHeight.value) - FILE_LIST_OVERSCAN);
});
const virtualEndIndex = computed(() => {
    if (!shouldVirtualizeFileList.value) return filteredFileList.value.length;
    const visibleRows = Math.ceil(fileListViewportHeight.value / estimatedFileRowHeight.value);
    return Math.min(filteredFileList.value.length, virtualStartIndex.value + visibleRows + FILE_LIST_OVERSCAN * 2);
});
const virtualFileList = computed(() => filteredFileList.value.slice(virtualStartIndex.value, virtualEndIndex.value));
const virtualTopPadding = computed(() => shouldVirtualizeFileList.value ? virtualStartIndex.value * estimatedFileRowHeight.value : 0);
const virtualBottomPadding = computed(() => shouldVirtualizeFileList.value
    ? Math.max(0, (filteredFileList.value.length - virtualEndIndex.value) * estimatedFileRowHeight.value)
    : 0);

const handleFileListScroll = () => {
    fileListScrollTop.value = fileListContainerRef.value?.scrollTop ?? 0;
};

const resetFileListScroll = () => {
    fileListScrollTop.value = 0;
    if (fileListContainerRef.value) fileListContainerRef.value.scrollTop = 0;
};

const handleSort = (key: keyof FileListItem | 'type' | 'size' | 'mtime') => {
    if (sortKey.value === key) {
        sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey.value = key;
        sortDirection.value = 'asc';
    }
};


// --- 列表项点击与选择逻辑 (使用 Composable) ---
const buildInlinePreviewUrl = (filePath: string, refreshKey?: string): string => {
  const params = new URLSearchParams({
    connectionId: props.dbConnectionId,
    sessionId: effectiveSessionId.value,
    remotePath: filePath,
    disposition: 'inline',
  });
  if (refreshKey) params.set('_previewRefresh', refreshKey);
  return `/api/v1/sftp/download?${params.toString()}`;
};

const fetchInlinePreview = async (filePath: string, signal: AbortSignal, refreshKey?: string): Promise<Response> => {
  const response = await fetch(buildInlinePreviewUrl(filePath, refreshKey), {
    credentials: 'same-origin',
    cache: refreshKey ? 'no-store' : 'default',
    signal,
  });

  if (!response.ok) {
    throw new Error(`Preview request failed with HTTP ${response.status}`);
  }

  return response;
};

const openFileInEditor = (item: FileListItem, filePath: string): void => {
  const fileInfo: FileInfo = { name: item.filename, fullPath: filePath };
  if (settingsStore.showPopupFileEditorBoolean) {
    fileEditorStore.triggerPopup(filePath, effectiveSessionId.value);
  }
  if (shareFileEditorTabsBoolean.value) {
    fileEditorStore.openFile(filePath, effectiveSessionId.value, props.instanceId);
  } else {
    sessionStore.openFileInSession(effectiveSessionId.value, fileInfo);
  }
};

const openFileTarget = async (item: FileListItem, filePath: string): Promise<void> => {
  const previewProvider = resolveFilePreviewProvider(item);
  if (previewProvider) {
    const maxInlineSize = previewProvider.maxInlineSize;
    if (maxInlineSize && item.attrs.size > maxInlineSize) {
      uiNotificationsStore.showError(
        t('fileManager.preview.fileTooLarge', { size: formatSize(maxInlineSize) })
      );
      return;
    }

    const tabId = `${effectiveSessionId.value}:${filePath}`;
    const existingTab = previewTabs.value.find((entry) => entry.id === tabId);
    if (existingTab) {
      activePreviewId.value = existingTab.id;
      previewWorkspaceVisible.value = true;
      return;
    }

    cancelPendingPreviewLoad();
    const loadToken = previewLoadToken;
    const abortController = new AbortController();
    previewAbortController.value = abortController;
    isPreviewLoading.value = true;
    previewWorkspaceVisible.value = true;

    try {
      const data = await previewProvider.load(item, {
        filePath,
        signal: abortController.signal,
        buildInlineUrl: buildInlinePreviewUrl,
        fetchInline: (path = filePath) => fetchInlinePreview(path, abortController.signal),
      });

      if (previewLoadToken !== loadToken) {
        data.dispose?.();
        return;
      }

      previewAbortController.value = null;
      previewTabs.value = [...previewTabs.value, {
        id: tabId,
        file: item,
        filePath,
        component: previewProvider.preview(item),
        componentProps: data.componentProps,
        dispose: data.dispose,
      }];
      activePreviewId.value = tabId;
      previewWorkspaceVisible.value = true;
      isPreviewLoading.value = false;
    } catch (error) {
      if (abortController.signal.aborted) return;
      console.error('[FileManager] Failed loading preview data', error);
      if (previewLoadToken === loadToken) {
        previewAbortController.value = null;
        isPreviewLoading.value = false;
        previewWorkspaceVisible.value = false;
        uiNotificationsStore.showError(t('fileManager.preview.loadFailed'));
      }
    }
    return;
  }

  openFileInEditor(item, filePath);
};

const canOpenAsText = (item: FileListItem): boolean => {
  return (item.attrs.isFile || item.attrs.isSymbolicLink) && /\.(md|markdown)$/i.test(item.filename);
};

const openItemAsText = (item: FileListItem): void => {
  const manager = currentSftpManager.value;
  if (!manager) return;
  const filePath = manager.joinPath(manager.currentPath.value, item.filename);
  hidePreview();
  openFileInEditor(item, filePath);
};

const editCurrentPreview = (): void => {
  const entry = activePreviewEntry.value;
  if (!entry) return;
  closePreviewTab(entry.id);
  hidePreview();
  openFileInEditor(entry.file, entry.filePath);
};

const editPreviewTab = (tabId: string): void => {
  activePreviewId.value = tabId;
  editCurrentPreview();
};

// 定义单击时的动作回调 (移到 Selection 实例化之前)
const handleItemAction = async (item: FileListItem): Promise<void> => {
  const manager = currentSftpManager.value;
  if (!manager) return;

  // Only the latest open action may resolve a symbolic-link target.
  cancelPendingPathResolutions();

  if (props.isMobile && isMultiSelectMode.value && (item.attrs.isFile || item.attrs.isSymbolicLink)) {
    if (selectedItems.value.has(item.filename)) {
      selectedItems.value.delete(item.filename);
    } else {
      selectedItems.value.add(item.filename);
    }
    return;
  }

  const itemPath = manager.joinPath(manager.currentPath.value, item.filename);

  if (item.attrs.isSymbolicLink) {
    if (manager.isLoading.value) return;

    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Symbolic link clicked: ${itemPath}. Attempting to resolve with sftp:realpath...`);
    const { sendMessage: wsSend, onMessage: wsOnMessage } = props.wsDeps;
    const requestId = generateRequestId();
    const requestSessionId = effectiveSessionId.value;
    const requestManager = manager;
    const isCurrentResolution = () =>
      effectiveSessionId.value === requestSessionId && currentSftpManager.value === requestManager;

    const handleResolvedPath = (realPath: string, targetType: 'file' | 'directory' | 'unknown') => {
      const activeManager = currentSftpManager.value;
      if (!activeManager) return;

      if (targetType === 'directory') {
        activeManager.loadDirectory(realPath);
        return;
      }

      const targetFilename = realPath.substring(realPath.lastIndexOf('/') + 1) || item.filename;
      const resolvedFile: FileListItem = {
        ...item,
        filename: targetFilename,
        attrs: {
          ...item.attrs,
          isDirectory: false,
          isFile: true,
          isSymbolicLink: false,
        },
      };
      void openFileTarget(resolvedFile, realPath);
    };

    let unregisterSuccess: (() => void) | undefined;
    let unregisterError: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanupListeners = () => {
      unregisterSuccess?.();
      unregisterError?.();
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = undefined;
      pendingPathResolutionCleanups.delete(cleanupListeners);
    };

    pendingPathResolutionCleanups.add(cleanupListeners);

    unregisterSuccess = wsOnMessage('sftp:realpath:success', (payload: any, message: WebSocketMessage) => {
      if (message.requestId !== requestId || payload.requestedPath !== itemPath) return;
      cleanupListeners();
      if (!isCurrentResolution()) return;

      const absolutePath = payload.absolutePath;
      if (!absolutePath) {
        console.error(`[FileManager ${props.sessionId}-${props.instanceId}] sftp:realpath:success for ${itemPath} missing absolutePath. Payload:`, payload);
        return;
      }

      const targetType = (payload.targetType || 'unknown') as 'file' | 'directory' | 'unknown';
      if (targetType === 'unknown') {
        console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] Symlink target type is unknown; attempting to open it as a file.`);
      }
      handleResolvedPath(absolutePath, targetType);
    });

    unregisterError = wsOnMessage('sftp:realpath:error', (payload: any, message: WebSocketMessage) => {
      if (message.requestId !== requestId || payload?.requestedPath !== itemPath) return;
      cleanupListeners();
      if (!isCurrentResolution()) return;
      const serverErrorMsg = payload.error || 'Unknown error resolving symlink target type';
      console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Failed to resolve symlink '${itemPath}': ${serverErrorMsg}`);
      uiNotificationsStore.showError(t('fileManager.errors.readFileFailed'));
    });

    timeoutId = setTimeout(() => {
      cleanupListeners();
      console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Timeout getting realpath for symlink '${itemPath}' (ID: ${requestId}).`);
      uiNotificationsStore.showError(t('fileManager.errors.readFileTimeout'));
    }, 10000);

    wsSend({ type: 'sftp:realpath', requestId, payload: { path: itemPath } });
    return;
  }

  if (item.attrs.isDirectory) {
    if (manager.isLoading.value) return;
    const newPath = item.filename === '..'
      ? manager.currentPath.value.substring(0, manager.currentPath.value.lastIndexOf('/')) || '/'
      : manager.joinPath(manager.currentPath.value, item.filename);
    manager.loadDirectory(newPath);
    return;
  }

  if (item.attrs.isFile) {
    await openFileTarget(item, itemPath);
  }
};

// 切换多选模式 (主要用于移动端)
const toggleMultiSelectMode = () => {
    isMultiSelectMode.value = !isMultiSelectMode.value;
    if (!isMultiSelectMode.value) {
        clearSelection(); // 退出多选模式时清空选择
    }
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Multi-select mode: ${isMultiSelectMode.value ? 'enabled' : 'disabled'}`);
};

// 实例化选择 Composable (需要 filteredFileList 和 handleItemAction)
const {
  selectedItems, // 使用 Composable 返回的 selectedItems
  lastClickedIndex, // 获取 lastClickedIndex 以传递给 ContextMenu
  handleItemClick: originalHandleItemClick, // 使用 Composable 返回的 handleItemClick
  clearSelection, // 获取清空选择的方法
} = useFileManagerSelection({
  // 传递当前显示的列表 (已排序和过滤)
  displayedFileList: filteredFileList, // 现在 filteredFileList 已定义
  onItemAction: handleItemAction,
  activateOnSingleClick: (item) => props.isMobile || item.attrs.isDirectory || item.filename === '..',
});

let suppressClickAfterLongPress = false;

// 自定义 handleItemClick 函数以支持移动端多选模式
const handleItemClick = (event: MouseEvent, item: FileListItem, forceMultiSelect = false) => {
  if (props.isMobile && suppressClickAfterLongPress) {
    suppressClickAfterLongPress = false;
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (props.isMobile && (isMultiSelectMode.value || forceMultiSelect)) {
    if (selectedItems.value.has(item.filename)) {
      selectedItems.value.delete(item.filename);
    } else {
      selectedItems.value.add(item.filename);
    }
    return;
  }
  originalHandleItemClick(event, item);
};

const handleItemDoubleClick = (event: MouseEvent, item: FileListItem) => {
  if (props.isMobile || isMultiSelectMode.value || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (item.attrs.isFile || item.attrs.isSymbolicLink) {
    event.preventDefault();
    event.stopPropagation();
    handleItemAction(item);
  }
};

// +++ 计算属性：获取选中的完整文件对象列表 +++
const computedSelectedFullItems = computed((): FileListItem[] => {
  if (!selectedItems.value || selectedItems.value.size === 0) {
    return [];
  }
  return filteredFileList.value.filter(item => selectedItems.value.has(item.filename));
});

// --- 操作模态框辅助函数 ---
const openActionModal = (
 type: 'delete' | 'rename' | 'chmod' | 'newFile' | 'newFolder',
 item?: FileListItem | null, // For single item operations like rename, chmod
 items?: FileListItem[], // For multi-item operations like delete
 initialValue?: string // For pre-filling input, e.g., old name for rename
) => {
 currentActionType.value = type;
 actionItem.value = item || null;
 actionItems.value = items || (item ? [item] : []); // Ensure actionItems has the item(s)
 actionInitialValue.value = initialValue || '';
 isActionModalVisible.value = true;
};

const handleModalClose = () => {
 isActionModalVisible.value = false;
 // Reset states if needed, though they'll be overwritten on next open
 currentActionType.value = null;
 actionItem.value = null;
 actionItems.value = [];
 actionInitialValue.value = '';
};

const handleModalConfirm = (value?: string) => {
 if (!currentSftpManager.value || !currentActionType.value) {
   handleModalClose();
   return;
 }
 const manager = currentSftpManager.value;

 switch (currentActionType.value) {
   case 'delete':
     if (actionItems.value.length > 0) {
       manager.deleteItems(actionItems.value);
       selectedItems.value.clear(); // Clear selection after delete
     }
     break;
   case 'rename':
     if (actionItem.value && value && value !== actionItem.value.filename) {
       manager.renameItem(actionItem.value, value);
     }
     break;
   case 'chmod':
     if (actionItem.value && value && /^[0-7]{3,4}$/.test(value)) {
       const newMode = parseInt(value, 8);
       manager.changePermissions(actionItem.value, newMode);
     } else if (value) { // value exists but is invalid
       // Optionally, re-open modal with error or use a notification
       // For now, just log and close
       console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Invalid chmod value from modal: ${value}`);
       // It might be better to show an error in the modal itself and not close it.
       // The modal currently has its own validation, so this path might not be hit often.
     }
     break;
   case 'newFile':
     if (value) {
       if (manager.fileList.value.some((item: FileListItem) => item.filename === value)) {
         console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] File ${value} already exists. Modal should prevent this.`);
         return; // Prevent closing if error
       }
       manager.createFile(value);
     }
     break;
   case 'newFolder':
     if (value) {
       if (manager.fileList.value.some((item: FileListItem) => item.filename === value)) {
         console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] Folder ${value} already exists. Modal should prevent this.`);
         return; // Prevent closing if error
       }
       manager.createDirectory(value);
     }
     break;
 }
 handleModalClose(); // Close modal after action
};


// --- SFTP 操作处理函数 (定义在此处，供 Composable 使用) ---
const handleDeleteSelectedClick = () => {
    // 修改：检查 currentSftpManager 是否存在
    if (!currentSftpManager.value) return;
    // 使用 props.wsDeps 和 currentSftpManager.value.fileList
    if (!props.wsDeps.isConnected.value || selectedItems.value.size === 0) return;
    const itemsToDelete = Array.from(selectedItems.value)
                               .map(filename => currentSftpManager.value?.fileList.value.find((f: FileListItem) => f.filename === filename))
                               .filter((item): item is FileListItem => item !== undefined);
   if (itemsToDelete.length === 0) return;
 
    // 根据设置决定是否显示确认模态框
    if (settingsStore.fileManagerShowDeleteConfirmationBoolean) {
        openActionModal('delete', null, itemsToDelete);
    } else {
        // 直接执行删除
        if (currentSftpManager.value) {
            currentSftpManager.value.deleteItems(itemsToDelete);
            selectedItems.value.clear(); // Clear selection after delete
        }
    }
};
 
const handleRenameContextMenuClick = (item: FileListItem) => { // item 已有类型
    if (!props.wsDeps.isConnected.value || !item) return; // 恢复使用 props.wsDeps
    if (!currentSftpManager.value) return;
    openActionModal('rename', item, undefined, item.filename);
};

const handleChangePermissionsContextMenuClick = (item: FileListItem) => { // item 已有类型
    if (!props.wsDeps.isConnected.value || !item) return; // 恢复使用 props.wsDeps
    if (!currentSftpManager.value) return;
    const currentModeOctal = (item.attrs.mode & 0o777).toString(8).padStart(3, '0');
    openActionModal('chmod', item, undefined, currentModeOctal);
};

const handleNewFolderContextMenuClick = () => {
    if (!props.wsDeps.isConnected.value) return; // 恢复使用 props.wsDeps
    if (!currentSftpManager.value) return;
    openActionModal('newFolder');
};

const handleNewFileContextMenuClick = () => {
    if (!props.wsDeps.isConnected.value) return; // 恢复使用 props.wsDeps
    if (!currentSftpManager.value) return;
    openActionModal('newFile');
};

// +++ 复制、剪切、粘贴处理函数 +++
const setFileClipboard = (operation: 'copy' | 'cut') => {
    if (!currentSftpManager.value || selectedItems.value.size === 0) return;
    const manager = currentSftpManager.value;
    const sourcePaths = Array.from(selectedItems.value)
        .map(filename => manager.joinPath(manager.currentPath.value, filename));
    fileClipboardStore.setClipboard({
        operation,
        sourceSessionId: effectiveSessionId.value,
        sourcePaths,
        sourceBaseDir: manager.currentPath.value,
    });
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] ${operation === 'copy' ? 'Copied' : 'Cut'} to shared clipboard:`, sourcePaths);
};

const handleCopy = () => setFileClipboard('copy');
const handleCut = () => setFileClipboard('cut');

const deleteSourcePathsAfterCrossHostCopy = (sourceSessionId: string, paths: string[], requestId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        const sourceSession = sessionStore.sessions.get(sourceSessionId);
        if (!sourceSession?.wsManager.isConnected.value || !sourceSession.wsManager.isSftpReady.value) {
            reject(new Error(t('fileManager.errors.sourceSessionNotReady')));
            return;
        }

        let unregisterSuccess = () => {};
        let unregisterError = () => {};
        const timeout = setTimeout(() => {
            unregisterSuccess();
            unregisterError();
            reject(new Error(t('fileManager.errors.sourceDeleteTimeout')));
        }, 30 * 60 * 1000);
        const finish = () => {
            clearTimeout(timeout);
            unregisterSuccess();
            unregisterError();
        };

        unregisterSuccess = sourceSession.wsManager.onMessage('sftp:delete_paths:success', (_payload, message) => {
            if (message.requestId !== requestId) return;
            finish();
            sourceSession.sftpManagers.forEach(sourceManager => {
                sourceManager.loadDirectory(sourceManager.currentPath.value, true);
            });
            resolve();
        });
        unregisterError = sourceSession.wsManager.onMessage('sftp:delete_paths:error', (payload, message) => {
            if (message.requestId !== requestId) return;
            finish();
            reject(new Error(typeof payload === 'string' ? payload : t('fileManager.errors.sourceDeleteFailed')));
        });

        sourceSession.wsManager.sendMessage({
            type: 'sftp:delete_paths',
            requestId,
            payload: { paths },
        });
    });
};

const handlePaste = async () => {
    if (!currentSftpManager.value || !clipboardState.value.hasContent || clipboardSourcePaths.value.length === 0) return;
    const manager = currentSftpManager.value;
    const destinationDir = manager.currentPath.value;
    const operation = clipboardState.value.operation;
    const sources = [...clipboardSourcePaths.value];
    const sourceBaseDir = clipboardSourceBaseDir.value;
    const sourceSessionId = sessionStore.resolveSessionId(clipboardSourceSessionId.value);
    const destinationSessionId = effectiveSessionId.value;
    const isCrossHost = sourceSessionId !== destinationSessionId;

    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Pasting items. Operation: ${operation}, Source session: ${sourceSessionId}, Destination session: ${destinationSessionId}, Sources: ${sources.join(', ')}, Destination: ${destinationDir}`);

    if (operation === 'copy') {
        if (isCrossHost) {
            void manager.copyItemsFromSession(sourceSessionId, sources, destinationDir).catch(() => {});
        } else {
            manager.copyItems(sources, destinationDir);
        }
        return;
    }

    if (operation !== 'cut') return;

    if (!isCrossHost) {
        if (sourceBaseDir === destinationDir) {
            console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] Cannot cut and paste in the same directory.`);
            return;
        }
        manager.moveItems(sources, destinationDir);
        fileClipboardStore.clearClipboard();
        return;
    }

    let transferRequestId: string;
    try {
        transferRequestId = await manager.copyItemsFromSession(sourceSessionId, sources, destinationDir, 'move');
    } catch {
        // copyItemsFromSession shares the normal copy success/error notifications.
        return;
    }

    try {
        await deleteSourcePathsAfterCrossHostCopy(sourceSessionId, sources, transferRequestId);
        const clipboardStillMatches = clipboardState.value.operation === 'cut'
            && sessionStore.resolveSessionId(clipboardSourceSessionId.value) === sourceSessionId
            && clipboardSourcePaths.value.length === sources.length
            && clipboardSourcePaths.value.every((path, index) => path === sources[index]);
        if (clipboardStillMatches) {
            fileClipboardStore.clearClipboard();
        }
        manager.completeTransfer(transferRequestId);
        uiNotificationsStore.showSuccess(t('fileManager.notifications.crossHostMoveSuccess'));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        manager.failTransfer(transferRequestId, message);
        uiNotificationsStore.showWarning(t('fileManager.warnings.crossHostDeleteFailed', { error: message }));
    }
};


// --- 文件上传触发器 (定义在此处，供 Composable 使用) ---
const triggerFileUpload = () => { fileInputRef.value?.click(); };

// --- 下载触发器 (定义在此处，供 Composable 使用) ---
const triggerDownload = (items: FileListItem[]) => { // 修改：接受 FileListItem 数组
    // 恢复使用 props.wsDeps.isConnected
    if (!props.wsDeps.isConnected.value) {
        return;
    }
    // connectionId 仍然从 props 获取
    const currentConnectionId = props.dbConnectionId;
    if (!currentConnectionId) {
        console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Cannot download: Missing connection ID.`);
        return;
    }
    // 修改：简化检查
    if (!currentSftpManager.value) {
        console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Cannot download: SFTP manager is not available.`);
        return;
    }

    // 遍历数组中的每个文件项
    items.forEach(item => {
        // 确保只下载文件
        if (!item.attrs.isFile && !item.attrs.isSymbolicLink) {
            console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] Skipping download for non-file item: ${item.filename}`);
            return;
        }

        const downloadPath = currentSftpManager.value!.joinPath(currentSftpManager.value!.currentPath.value, item.filename);
        const downloadUrl = `/api/v1/sftp/download?connectionId=${currentConnectionId}&sessionId=${encodeURIComponent(effectiveSessionId.value)}&remotePath=${encodeURIComponent(downloadPath)}`;
        console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Triggering download for ${item.filename}: ${downloadUrl}`);

        // 为每个文件创建一个链接并点击
        const link = document.createElement('a');
        link.href = downloadUrl;
        // --- 修正：移除文件名中的双引号以兼容 Chrome ---
        const safeFilename = item.filename.replace(/"/g, ''); // 移除所有双引号
        link.setAttribute('download', safeFilename);
        // --- 结束修正 ---
        document.body.appendChild(link);
        link.click();

        // 稍微延迟移除链接，以确保下载开始
        setTimeout(() => {
            document.body.removeChild(link);
        }, 100);
    });
};


// +++ 文件夹下载触发器 +++
const triggerDownloadDirectory = (item: FileListItem) => {
    if (!props.wsDeps.isConnected.value) return;
    const currentConnectionId = props.dbConnectionId;
    if (!currentConnectionId || !currentSftpManager.value || !item.attrs.isDirectory) return;

    const directoryPath = currentSftpManager.value.joinPath(currentSftpManager.value.currentPath.value, item.filename);
    const downloadUrl = `/api/v1/sftp/download-directory?connectionId=${currentConnectionId}&sessionId=${encodeURIComponent(effectiveSessionId.value)}&remotePath=${encodeURIComponent(directoryPath)}`;

    // Let the browser stream the response directly to disk. Converting the complete
    // archive to a Blob first doubled memory usage and delayed the visible download.
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.setAttribute('download', `${item.filename.replace(/"/g, '')}.zip`);
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => link.remove(), 100);
};


// +++ 压缩/解压处理函数 +++
const handleCompress = (items: FileListItem[], format: CompressFormat) => {
  if (!currentSftpManager.value) {
    console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Cannot compress: SFTP manager not available.`);
    return;
  }
  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Requesting compression for ${items.length} items, format: ${format}`);
  void currentSftpManager.value.compressItems(items, format).catch((error) => {
    if (error instanceof Error && (error.message === 'ARCHIVE_CANCELLED' || error.name === 'ARCHIVE_IN_PROGRESS')) return;
    console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Compression failed:`, error);
  });
};

const openArchivePasswordModal = (
  mode: 'compress' | 'decompress',
  options: { items?: FileListItem[]; item?: FileListItem; error?: string } = {},
) => {
  archivePasswordMode.value = mode;
  archivePasswordItems.value = options.items ? [...options.items] : [];
  archivePasswordItem.value = options.item ?? null;
  archivePasswordError.value = options.error ?? '';
  archivePasswordModalVisible.value = true;
};

const closeArchivePasswordModal = () => {
  archivePasswordModalVisible.value = false;
  archivePasswordMode.value = null;
  archivePasswordItems.value = [];
  archivePasswordItem.value = null;
  archivePasswordError.value = '';
};

const handleEncryptedCompress = (items: FileListItem[]) => {
  if (!currentSftpManager.value || items.length === 0) return;
  openArchivePasswordModal('compress', { items });
};

const getArchivePasswordErrorMessage = (error: Error): string => {
  if (error.name === 'INVALID_PASSWORD') {
    return t('fileManager.archivePassword.wrongPassword', 'Incorrect zip password. Try again.');
  }
  if (error.name === 'PASSWORD_TOO_LONG') {
    return t('fileManager.archivePassword.tooLong', { max: 128 });
  }
  if (error.name === 'INVALID_PASSWORD_FORMAT') {
    return t('fileManager.archivePassword.invalidCharacters', 'Password cannot contain line breaks or null characters.');
  }
  return error.message;
};

const handleDecompress = (item: FileListItem) => {
  const manager = currentSftpManager.value;
  if (!manager) {
    console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Cannot decompress: SFTP manager not available.`);
    return;
  }
  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Requesting decompression for item: ${item.filename}`);
  void manager.decompressItem(item).catch((error) => {
    if (error instanceof Error && error.name === 'ARCHIVE_IN_PROGRESS') return;
    if (error instanceof Error && error.name === 'PASSWORD_REQUIRED') {
      openArchivePasswordModal('decompress', { item });
      return;
    }
    console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Decompression failed:`, error);
  });
};

const handleArchivePasswordConfirm = (password: string) => {
  const manager = currentSftpManager.value;
  const mode = archivePasswordMode.value;
  const items = [...archivePasswordItems.value];
  const item = archivePasswordItem.value;
  if (!manager || !mode) {
    closeArchivePasswordModal();
    return;
  }

  closeArchivePasswordModal();

  if (mode === 'compress' && items.length > 0) {
    void manager.compressItems(items, 'zip', password).catch((error) => {
      if (error instanceof Error && (error.message === 'ARCHIVE_CANCELLED' || error.name === 'ARCHIVE_IN_PROGRESS')) return;
      if (error instanceof Error && ['PASSWORD_TOO_LONG', 'INVALID_PASSWORD_FORMAT'].includes(error.name)) {
        openArchivePasswordModal('compress', { items, error: getArchivePasswordErrorMessage(error) });
        return;
      }
      console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Password-protected ZIP compression failed:`, error);
    });
    return;
  }

  if (mode === 'decompress' && item) {
    void manager.decompressItem(item, password).catch((error) => {
      if (error instanceof Error && error.name === 'ARCHIVE_IN_PROGRESS') return;
      if (error instanceof Error && ['INVALID_PASSWORD', 'PASSWORD_TOO_LONG', 'INVALID_PASSWORD_FORMAT'].includes(error.name)) {
        openArchivePasswordModal('decompress', { item, error: getArchivePasswordErrorMessage(error) });
        return;
      }
      console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Password-protected ZIP extraction failed:`, error);
    });
  }
};


// +++ 复制路径到剪贴板 +++
const handleCopyPath = async (item: FileListItem) => {
  if (!currentSftpManager.value) return;
  const fullPath = currentSftpManager.value.joinPath(currentSftpManager.value.currentPath.value, item.filename);
  try {
    await navigator.clipboard.writeText(fullPath);
    // 可选：显示成功通知
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Copied path to clipboard: ${fullPath}`);
    uiNotificationsStore.showSuccess(t('fileManager.notifications.pathCopied', 'Path copied to clipboard'));
  } catch (err) {
    console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Failed to copy path: `, err);
    // 可选：显示错误通知
    uiNotificationsStore.showError(t('fileManager.errors.copyPathFailed', 'Failed to copy path'));
  }
};

// --- 上下文菜单逻辑 (使用 Composable, 需要 Selection 和 Action Handlers) ---
const {
  contextMenuVisible,
  contextMenuPosition,
  contextMenuItems,
  contextMenuRef, // 获取 ref 以传递给子组件
  contextTargetItem, // Get the target item from the composable
  showContextMenu, // 使用 Composable 提供的函数
  hideContextMenu, // <-- 获取 hideContextMenu 函数
} = useFileManagerContextMenu({
  selectedItems,
  lastClickedIndex,
  // 修改：传递 manager 的 fileList 和 currentPath ref (保持 computed)
  fileList: computed(() => currentSftpManager.value?.fileList.value ?? []),
  currentPath: computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  isConnected: computed(() => props.wsDeps.isConnected.value),
  isSftpReady: computed(() => props.wsDeps.isSftpReady.value),
  clipboardState: readonly(clipboardState), // +++ 传递剪贴板状态 (只读) +++
  t,
  // --- 传递回调函数 ---
  // 修改：确保在调用前检查 currentSftpManager.value
  onRefresh: () => {
      if (currentSftpManager.value) {
          currentSftpManager.value.loadDirectory(currentSftpManager.value.currentPath.value, true);
      }
  },
  onUpload: triggerFileUpload,
  onDownload: triggerDownload,
  onDelete: handleDeleteSelectedClick,
  onRename: handleRenameContextMenuClick,
  onChangePermissions: handleChangePermissionsContextMenuClick,
  onNewFolder: handleNewFolderContextMenuClick,
  onNewFile: handleNewFileContextMenuClick,
  onCopy: handleCopy, // +++ 传递复制回调 +++
  onCut: handleCut, // +++ 传递剪切回调 +++
  onPaste: handlePaste, // +++ 传递粘贴回调 +++
  onDownloadDirectory: triggerDownloadDirectory, // +++ 传递文件夹下载回调 +++
  // +++ 传递压缩/解压回调 +++
  onCompressRequest: handleCompress,
  onEncryptedCompressRequest: handleEncryptedCompress,
  onDecompressRequest: handleDecompress,
  onCopyPath: handleCopyPath, // +++ 传递复制路径回调 +++
  onOpenAsText: openItemAsText,
  canOpenAsText,
});

const MOBILE_CONTEXT_LONG_PRESS_MS = 550;
const MOBILE_CONTEXT_MOVE_TOLERANCE = 12;
let mobileContextTimer: ReturnType<typeof setTimeout> | null = null;
let mobileContextStart: { x: number; y: number } | null = null;
let mobileContextTriggered = false;
let mobileContextPointerId: number | null = null;

const clearMobileContextTimer = () => {
  if (mobileContextTimer) {
    clearTimeout(mobileContextTimer);
    mobileContextTimer = null;
  }
};

const releaseMobileContextPointer = (event: PointerEvent) => {
  const target = event.currentTarget;
  if (!(target instanceof Element) || mobileContextPointerId === null) return;
  try {
    if (target.hasPointerCapture(mobileContextPointerId)) {
      target.releasePointerCapture(mobileContextPointerId);
    }
  } catch {
    // Pointer may already have been released/cancelled by the browser scroll gesture.
  }
};

const handleMobileContextPointerStart = (event: PointerEvent, item?: FileListItem) => {
  if (!props.isMobile || !event.isPrimary || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
  clearMobileContextTimer();
  mobileContextPointerId = event.pointerId;
  mobileContextStart = { x: event.clientX, y: event.clientY };
  mobileContextTriggered = false;

  const target = event.currentTarget;
  if (target instanceof Element) {
    try { target.setPointerCapture(event.pointerId); } catch { /* browser may reject capture during native gestures */ }
  }

  mobileContextTimer = setTimeout(() => {
    mobileContextTimer = null;
    mobileContextTriggered = true;
    suppressClickAfterLongPress = !!item;
    fileListContainerRef.value?.focus({ preventScroll: true });
    showContextMenu(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
    }), item);
    navigator.vibrate?.(15);
  }, MOBILE_CONTEXT_LONG_PRESS_MS);
};

const handleMobileContextPointerMove = (event: PointerEvent) => {
  if (mobileContextPointerId !== event.pointerId || !mobileContextStart) return;
  if (
    Math.abs(event.clientX - mobileContextStart.x) > MOBILE_CONTEXT_MOVE_TOLERANCE
    || Math.abs(event.clientY - mobileContextStart.y) > MOBILE_CONTEXT_MOVE_TOLERANCE
  ) {
    clearMobileContextTimer();
    releaseMobileContextPointer(event);
    mobileContextPointerId = null;
    mobileContextStart = null;
    mobileContextTriggered = false;
  }
};

const handleMobileContextPointerEnd = (event: PointerEvent) => {
  if (mobileContextPointerId !== event.pointerId) return;
  if (mobileContextTriggered) {
    event.preventDefault();
    window.setTimeout(() => {
      suppressClickAfterLongPress = false;
    }, 500);
  }
  clearMobileContextTimer();
  releaseMobileContextPointer(event);
  mobileContextPointerId = null;
  mobileContextStart = null;
  mobileContextTriggered = false;
};

const handleMobileContextPointerCancel = (event: PointerEvent) => {
  if (mobileContextPointerId !== event.pointerId) return;
  clearMobileContextTimer();
  releaseMobileContextPointer(event);
  mobileContextPointerId = null;
  mobileContextStart = null;
  mobileContextTriggered = false;
};

const handleItemContextMenu = (event: MouseEvent, item: FileListItem) => {
  if (props.isMobile) {
    // Android 浏览器可能直接把长按转成 contextmenu，并取消 pointer 序列。
    // 同时抑制随后补发的 click，避免文件夹菜单刚出现就被单击导航覆盖。
    suppressClickAfterLongPress = true;
    window.setTimeout(() => {
      suppressClickAfterLongPress = false;
    }, 800);
  }
  showContextMenu(event, item);
};

// --- 目录加载与导航 ---
// loadDirectory is provided by props.sftpManager

// --- 拖放逻辑 (使用 Composable) ---
const {
  // isDraggingOver, // 不再直接使用容器的悬停状态
  showExternalDropOverlay, // 控制蒙版显示
  dragOverTarget, // 行拖拽悬停目标 (内部)
  // draggedItem, // 内部状态，不需要在 FileManager 中直接使用
  // --- 事件处理器 ---
  handleDragEnter,
  handleDragOver, // 容器的 dragover (主要处理内部滚动)
  handleDragLeave,
  handleDrop, // 容器的 drop (主要用于清理)
  handleOverlayDrop, // 蒙版的 drop
  handleDragStart,
  handleDragEnd,
  handleDragOverRow,
  handleDragLeaveRow,
  handleDropOnRow,
} = useFileManagerDragAndDrop({
  isConnected: computed(() => props.wsDeps.isConnected.value), 
  // 修改：传递 manager 的 currentPath (保持 computed)
  currentPath: computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  fileListContainerRef: fileListContainerRef,
  // 修改：传递一个包装函数给 joinPath
  joinPath: (base: string, target: string): string => {
      return currentSftpManager.value?.joinPath(base, target) ?? `${base}/${target}`.replace(/\/+/g, '/'); // 提供简单的默认实现
  },
  onFileUploadBatch: startFileUploadBatch,
  // 修改：确保在调用前检查 currentSftpManager.value
  onItemMove: (item, newName) => {
      currentSftpManager.value?.renameItem(item, newName);
  },
  selectedItems: selectedItems,
  // 修改：传递 manager 的 fileList ref (保持 computed)
  fileList: computed(() => currentSftpManager.value?.fileList.value ?? []),
});


// --- 文件上传逻辑 (handleFileSelected 保持在此处，由 triggerFileUpload 调用) ---
const handleFileSelected = (event: Event) => {
    const input = event.target as HTMLInputElement;
    // 恢复使用 props.wsDeps.isConnected
    if (!input.files || !props.wsDeps.isConnected.value) return;
    startFileUploadBatch(Array.from(input.files).map(file => ({ file })));
    input.value = '';
};

// --- 键盘导航逻辑 (使用 Composable) ---
const {
  selectedIndex, // 使用 Composable 返回的 selectedIndex
  handleKeydown, // 使用 Composable 返回的 handleKeydown
} = useFileManagerKeyboardNavigation({
  filteredFileList: filteredFileList,
  // 修改：传递 manager 的 currentPath ref
  currentPath: computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  fileListContainerRef: fileListContainerRef,
  getEstimatedRowHeight: () => estimatedFileRowHeight.value,
  // 当 Enter 键按下时，模拟鼠标单击
  onEnterPress: (item) => handleItemAction(item),
});

const ensureKeyboardSelection = (): FileListItem[] => {
  if (selectedItems.value.size > 0) return computedSelectedFullItems.value;
  if (selectedIndex.value < 0) return [];
  const offset = currentSftpManager.value?.currentPath.value !== '/' ? 1 : 0;
  const itemIndex = selectedIndex.value - offset;
  const item = filteredFileList.value[itemIndex];
  if (!item) return [];
  selectedItems.value.add(item.filename);
  return [item];
};

// Windows Explorer-style shortcuts also work with a physical keyboard on mobile/tablet.
const handleFileListKeydown = (event: KeyboardEvent) => {
  const key = event.key.toLowerCase();
  const ctrlOrMeta = event.ctrlKey || event.metaKey;

  if (ctrlOrMeta && key === 'a') {
    event.preventDefault();
    selectedItems.value.clear();
    filteredFileList.value.forEach(item => selectedItems.value.add(item.filename));
    return;
  }
  if (ctrlOrMeta && key === 'c') {
    event.preventDefault();
    ensureKeyboardSelection();
    handleCopy();
    return;
  }
  if (ctrlOrMeta && key === 'x') {
    event.preventDefault();
    ensureKeyboardSelection();
    handleCut();
    return;
  }
  if (ctrlOrMeta && key === 'v') {
    event.preventDefault();
    handlePaste();
    return;
  }
  if (ctrlOrMeta && event.shiftKey && key === 'n') {
    event.preventDefault();
    handleNewFolderContextMenuClick();
    return;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    ensureKeyboardSelection();
    handleDeleteSelectedClick();
    return;
  }
  if (event.key === 'F2') {
    event.preventDefault();
    const items = ensureKeyboardSelection();
    if (items.length === 1) handleRenameContextMenuClick(items[0]);
    return;
  }
  if (event.key === 'F5') {
    event.preventDefault();
    currentSftpManager.value?.loadDirectory(currentSftpManager.value.currentPath.value, true);
    return;
  }
  if (event.altKey && event.key === 'ArrowUp' && currentSftpManager.value?.currentPath.value !== '/') {
    event.preventDefault();
    handleItemAction({ filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } });
    return;
  }

  handleKeydown(event);
};


// --- 重置选中索引和清空选择的 Watchers ---
// 修改：监听 manager 的 currentPath
watch(() => currentSftpManager.value?.currentPath.value, () => {
    cancelPendingPathResolutions();
    closeAllPreviews();
    selectedIndex.value = -1;
    clearSelection();
    resetFileListScroll();
});
watch(searchQuery, () => {
    selectedIndex.value = -1;
    clearSelection(); // 清空选择
    resetFileListScroll();
});
watch(sortKey, () => {
    selectedIndex.value = -1;
    clearSelection(); // 清空选择
    resetFileListScroll();
});
watch(sortDirection, () => {
    selectedIndex.value = -1;
    clearSelection(); // 清空选择
    resetFileListScroll();
});


// --- 保存设置的函数 ---
type FileManagerLayoutSnapshot = { multiplier: number; widths: Record<string, number> };

const snapshotLayoutSettings = (): FileManagerLayoutSnapshot => ({
  multiplier: rowSizeMultiplier.value,
  widths: JSON.parse(JSON.stringify(colWidths.value)),
});

const persistLayoutSettings = async ({ multiplier, widths }: FileManagerLayoutSnapshot) => {
  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Persisting layout: multiplier=${multiplier}, widths=${JSON.stringify(widths)}`);
  await settingsStore.updateFileManagerLayoutSettings(multiplier, widths);
};

const layoutSettingsSaver = createLatestValueSaver<FileManagerLayoutSnapshot>({
  delayMs: 240,
  save: persistLayoutSettings,
  onPendingChange: (pending) => { rowScaleSyncLocked.value = pending; },
  onError: (error) => console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Failed to persist layout settings:`, error),
});

const saveLayoutSettings = () => {
  layoutSettingsSaver.schedule(snapshotLayoutSettings());
  void layoutSettingsSaver.flush();
};

const scheduleRowScaleSave = () => {
  layoutSettingsSaver.schedule(snapshotLayoutSettings());
};

// --- 生命周期钩子 ---
onMounted(() => {
    const container = fileListContainerRef.value;
    if (!container) return;
    const updateViewportHeight = () => {
      fileListViewportHeight.value = Math.max(1, container.clientHeight);
    };
    updateViewportHeight();
    fileListResizeObserver = new ResizeObserver(updateViewportHeight);
    fileListResizeObserver.observe(container);
});

// +++ 使用 watchEffect 响应式地加载和应用布局设置 +++
watchEffect(() => {
  // 检查 store 中的值是否有效 (避免在 store 加载完成前使用默认值覆盖本地 ref)
  // fileManagerColWidthsObject 初始可能是空对象 {}，需要检查其是否有键
  const storeMultiplier = fileManagerRowSizeMultiplierNumber.value;
  const storeWidths = fileManagerColWidthsObject.value;

  // +++ 日志：记录从 store 获取的值 +++
  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] watchEffect triggered. Store values: multiplier=${storeMultiplier}, widths=${JSON.stringify(storeWidths)}`);

  // 只有当 store 加载完成并提供了有效值时才更新
  // 假设 store 加载完成后 multiplier > 0 且 widths 对象有内容
  if (storeMultiplier > 0 && Object.keys(storeWidths).length > 0) {
    const currentMultiplier = rowSizeMultiplier.value;
    const currentWidthsString = JSON.stringify(colWidths.value);
    const storeWidthsString = JSON.stringify(storeWidths);

    // +++ 日志：记录当前值和 store 值，以及是否更新 +++
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Comparing values: Current Multiplier=${currentMultiplier}, Store Multiplier=${storeMultiplier}. Update needed: ${storeMultiplier !== currentMultiplier}`);
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Comparing values: Current Widths=${currentWidthsString}, Store Widths=${storeWidthsString}. Update needed: ${storeWidthsString !== currentWidthsString}`);

    // 仅在值不同时更新，避免不必要的重渲染和潜在的循环更新
    if (!rowScaleSyncLocked.value && storeMultiplier !== currentMultiplier) {
      rowSizeMultiplier.value = storeMultiplier;
      console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Row size multiplier updated from store: ${storeMultiplier}`);
    }
    if (storeWidthsString !== currentWidthsString) {
      // --- 修改：合并 storeWidths 到 colWidths.value ---
      // 确保 colWidths.value 的所有键都存在，并用 store 的值更新（如果存在且有效）
      const updatedWidths = { ...colWidths.value }; // 创建当前值的副本
      for (const key in updatedWidths) {
        if (storeWidths[key] !== undefined && typeof storeWidths[key] === 'number' && storeWidths[key] > 0) {
          updatedWidths[key as keyof typeof updatedWidths] = storeWidths[key];
        }
      }
      colWidths.value = updatedWidths; // 赋值更新后的对象
      console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Column widths updated from store: ${JSON.stringify(updatedWidths)}`);
    }
  } else {
    // +++ 日志：记录等待 store 加载 +++
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Waiting for valid layout settings from store... Store Multiplier=${storeMultiplier}, Store Widths Keys=${Object.keys(storeWidths).length}`);
  }
});

// 使用 watchEffect 监听连接和 SFTP 就绪状态以触发初始加载
// 恢复使用 props.wsDeps
watchEffect((onCleanup) => {
    let unregisterSuccess: (() => void) | undefined;
    let unregisterError: (() => void) | undefined;
    let timeoutId: NodeJS.Timeout | number | undefined; // 修正类型以兼容 Node 和浏览器环境
    const manager = currentSftpManager.value;
    const isManagerReady = !!(manager && props.wsDeps.isConnected.value && props.wsDeps.isSftpReady.value);
    const wasManagerReady = manager ? sftpReadyStateByManager.get(manager) : undefined;

    if (manager) {
        sftpReadyStateByManager.set(manager, isManagerReady);
    }

    const cleanupListeners = () => {
        unregisterSuccess?.();
        unregisterError?.();
        if (timeoutId) clearTimeout(timeoutId);
        // isFetchingInitialPath 状态移除
    };

    onCleanup(cleanupListeners);

    // 修改：添加 ?. 访问 isLoading, 检查 manager 的 initialLoadDone
    // 只有在连接就绪、SFTP 就绪、管理器存在、未加载且 initialLoadDone 为 false 时才获取初始路径
    if (manager && isManagerReady && !manager.isLoading.value && !manager.initialLoadDone.value) {
        console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Connection ready for manager, fetching initial path for the first time (isLoading: ${manager.isLoading.value}, initialLoadDone: ${manager.initialLoadDone.value}).`);
        // isFetchingInitialPath 状态移除, 使用 isLoading 状态

        // 仍然使用 props.wsDeps 中的 sendMessage 和 onMessage
        const { sendMessage: wsSend, onMessage: wsOnMessage } = props.wsDeps;
        const requestId = generateRequestId(); // 使用本地辅助函数
        const requestedPath = '.';

        unregisterSuccess = wsOnMessage('sftp:realpath:success', (payload: any, message: WebSocketMessage) => { // message 已有类型
            if (message.requestId === requestId && payload.requestedPath === requestedPath) {
                // 修改：检查 currentSftpManager 是否存在
                if (!currentSftpManager.value) return;
                const absolutePath = payload.absolutePath;
                console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Received initial absolute path for '.': ${absolutePath}. Loading directory.`);
                // 修改：添加 ?. 访问 loadDirectory 和 setInitialLoadDone
                currentSftpManager.value?.loadDirectory(absolutePath);
                currentSftpManager.value?.setInitialLoadDone(true); // 设置 manager 内部状态
                cleanupListeners();
            }
        });

        unregisterError = wsOnMessage('sftp:realpath:error', (payload: any, message: WebSocketMessage) => { // message 已有类型
            // 修改：使用 payload.requestedPath (如果存在) 或 message.requestId 匹配
            if (message.requestId === requestId && payload?.requestedPath === requestedPath) {
                console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Failed to get realpath for '${requestedPath}':`, payload);
                // TODO: 可以考虑通过 manager instance 暴露错误状态
                // 目前仅记录日志。
                // 即使获取 realpath 失败，也标记初始加载尝试完成，避免重复尝试
                currentSftpManager.value?.setInitialLoadDone(true);
                cleanupListeners();
            }
        });

        console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Sending initial sftp:realpath request (ID: ${requestId}) for path: ${requestedPath}`);
        wsSend({ type: 'sftp:realpath', requestId: requestId, payload: { path: requestedPath } });

        timeoutId = setTimeout(() => {
            console.error(`[FileManager ${props.sessionId}-${props.instanceId}] Timeout getting initial realpath for '.' (ID: ${requestId}).`);
            // 超时也标记初始加载尝试完成
            currentSftpManager.value?.setInitialLoadDone(true);
            cleanupListeners();
        }, 10000); // 10 秒超时

    } else if (manager && isManagerReady && manager.initialLoadDone.value) {
        if (wasManagerReady === false && !manager.isLoading.value) {
            const pathBeforeReconnect = manager.currentPath.value;
            console.log(`[FileManager ${props.sessionId}-${props.instanceId}] SFTP connection recovered. Reloading previous path: ${pathBeforeReconnect}`);
            manager.loadDirectory(pathBeforeReconnect, false);
        } else {
            console.log(`[FileManager ${props.sessionId}-${props.instanceId}] SFTP manager is already ready. Keeping cached directory without reload.`);
        }
        cleanupListeners(); // 清理可能存在的旧监听器

    } else if (!isManagerReady && manager?.initialLoadDone.value) { // 检查 manager 的 initialLoadDone
        // 连接丢失，不需要重置 initialLoadDone，因为我们希望在重连时恢复状态
        // 只需要清理监听器
        console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Connection lost (was previously loaded).`);
        // clearSelection(); // 可以在连接丢失时不清空选择，看产品需求
        // currentSftpManager.value?.setInitialLoadDone(false); // 不再重置，保持状态
        cleanupListeners();
    }
});

// +++ 监听 Store 中的触发器以激活搜索 +++
watch(() => focusSwitcherStore.activateFileManagerSearchTrigger, (newValue, oldValue) => { // 修改监听器
    // 确保只在触发器值增加时执行（避免初始加载或重置时触发）
    // 并且当前组件的 sessionId 与活动 sessionId 匹配
    // 检查 newValue > oldValue 确保是递增触发，避免重复执行
    // 检查是否是当前活动会话的此实例（如果需要区分实例）
    // 目前假设搜索触发器对会话内的所有 FileManager 生效
    if (newValue > (oldValue ?? 0) && effectiveSessionId.value === sessionStore.activeSessionId) {
        console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Received search activation trigger for active session.`);
        activateSearch(); // 调用组件内部的激活搜索方法
    }
}, { immediate: false }); // 添加 immediate: false 避免初始值为 0 时触发


// --- 监听 sessionId prop 的变化 ---
watch(() => props.sessionId, (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId) {
        cancelPendingPathResolutions();
        closeAllPreviews();
        closePathHistory(); // 关闭可能打开的路径历史下拉菜单
        pathHistoryStore.setSearchTerm(''); // 清空搜索词
        // 保留旧会话的 SFTP manager。切换回该会话时直接复用目录树和当前路径，避免重新加载。
        // 1. 重新初始化 SFTP 管理器
        initializeSftpManager(sessionStore.resolveSessionId(newSessionId), props.instanceId);

        // 2. 重置 UI 状态
        clearSelection();
        searchQuery.value = '';
        isSearchActive.value = false;
        isEditingPath.value = false;
        sortKey.value = 'filename'; // 重置排序
        sortDirection.value = 'asc';
    }
}, { immediate: false }); // immediate: false 避免初始挂载时触发



// +++ 注册/注销自定义聚焦动作 +++
let unregisterSearchFocusAction: (() => void) | null = null; // 搜索框注销函数
let unregisterPathFocusAction: (() => void) | null = null; // 路径编辑框注销函数

onMounted(() => {
  onWorkspaceEvent('ui:restoreProgressDisplay', restoreFloatingProgress);

  // 注册搜索框聚焦动作
  const focusSearchActionWrapper = async (): Promise<boolean | undefined> => {
    if (effectiveSessionId.value === sessionStore.activeSessionId) {
      console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Executing search focus action for active session.`);
      closePathHistory(); // Close path history if open
      return focusSearchInput();
    } else {
      console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Search focus action skipped for inactive session.`);
      return undefined;
    }
  };
  unregisterSearchFocusAction = focusSwitcherStore.registerFocusAction('fileManagerSearch', focusSearchActionWrapper);

  // 注册路径编辑框聚焦动作
  const focusPathActionWrapper = async (): Promise<boolean | undefined> => {
     if (effectiveSessionId.value === sessionStore.activeSessionId) {
       console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Executing path edit focus action for active session.`);
       // startPathEdit 本身不是 async，但注册时需要包装成 async 以匹配类型
       startPathEdit(); // 调用暴露的方法
       return true;
     } else {
       console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Path edit focus action skipped for inactive session.`);
       return undefined;
     }
  };
  unregisterPathFocusAction = focusSwitcherStore.registerFocusAction('fileManagerPathInput', focusPathActionWrapper);
  document.addEventListener('click', handleClickOutsidePathInput);
});

onBeforeUnmount(() => {
 offWorkspaceEvent('ui:restoreProgressDisplay', restoreFloatingProgress);
 clearMobileContextTimer();
 layoutSettingsSaver.dispose({ flush: true });
 cancelPendingPathResolutions();
 closeAllPreviews();
 fileListResizeObserver?.disconnect();
 fileListResizeObserver = null;
 // 注销搜索框动作
 if (unregisterSearchFocusAction) {
   unregisterSearchFocusAction();
   console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Unregistered search focus action on unmount.`);
 }
 unregisterSearchFocusAction = null;

 // 注销路径编辑框动作
 if (unregisterPathFocusAction) {
   unregisterPathFocusAction();
   console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Unregistered path edit focus action on unmount.`);
 }
 unregisterPathFocusAction = null;
 document.removeEventListener('click', handleClickOutsidePathInput);
 silentExecCleanup?.();
 silentExecCleanup = null;
 terminalPathChangeCleanup?.();
 terminalPathChangeCleanup = null;
 sessionStore.removeSftpManager(effectiveSessionId.value, props.instanceId);
});

// +++ 监听蒙版可见性，动态调整高度 +++
watch(showExternalDropOverlay, (isVisible) => {
  if (isVisible) {
    nextTick(() => { // 确保 refs 可用且 scrollHeight 已计算
      if (dropOverlayRef.value && fileListContainerRef.value) {
        const scrollHeight = fileListContainerRef.value.scrollHeight;
        dropOverlayRef.value.style.height = `${scrollHeight}px`;
      }
    });
  } else {
    // 蒙版隐藏时重置高度
    if (dropOverlayRef.value) {
      dropOverlayRef.value.style.height = ''; // 移除内联样式
      // console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Overlay hidden. Resetting height.`);
    }
  }
});

// --- 列宽调整逻辑 (保持不变) ---
const getColumnKeyByIndex = (index: number): keyof typeof colWidths.value | null => {
    const keys = Object.keys(colWidths.value) as Array<keyof typeof colWidths.value>;
    return keys[index] ?? null;
};

const startResize = (event: MouseEvent, index: number) => {
    event.stopPropagation();
    event.preventDefault();
    isResizing.value = true;
    resizingColumnIndex.value = index;
    startX.value = event.clientX;
    const colKey = getColumnKeyByIndex(index);
    if (colKey) {
        startWidth.value = colWidths.value[colKey];
    } else {
        const thElement = (event.target as HTMLElement).closest('th');
        startWidth.value = thElement?.offsetWidth ?? 100;
    }
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
};

const handleResize = (event: MouseEvent) => {
    if (!isResizing.value || resizingColumnIndex.value < 0) return;
    const currentX = event.clientX;
    const diffX = currentX - startX.value;
    const newWidth = Math.max(30, startWidth.value + diffX);
    const colKey = getColumnKeyByIndex(resizingColumnIndex.value);
    if (colKey) {
        colWidths.value[colKey] = newWidth;
    }
};

const stopResize = () => {
    if (isResizing.value) {
        isResizing.value = false;
        resizingColumnIndex.value = -1;
        document.removeEventListener('mousemove', handleResize);
        document.removeEventListener('mouseup', stopResize);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // +++ 在调整结束后保存列宽 +++
        // +++ 日志：记录触发保存 +++
        console.log(`[FileManager ${props.sessionId}-${props.instanceId}] stopResize triggered saveLayoutSettings.`);
        saveLayoutSettings();
    }
};

// --- 路径编辑逻辑 (包含路径历史) ---

const openPathHistory = () => {
  showPathHistoryDropdown.value = true; // 总是尝试显示下拉框
  // 如果列表为空，则尝试获取历史记录。
  // pathHistoryStore.fetchHistory() 应该能够处理未连接时 apiClient 的失败。
  if (pathHistoryStore.historyList.length === 0) {
    pathHistoryStore.fetchHistory();
  }
  // 总是设置搜索词，以便即使历史记录是旧的或空的，也能基于当前输入进行过滤或显示。
  pathHistoryStore.setSearchTerm(editablePath.value);
};

const closePathHistory = () => {
  showPathHistoryDropdown.value = false;
  pathHistoryStore.resetSelection();
};

const handlePathInputFocus = () => {
  isEditingPath.value = true; // Keep existing behavior
  if (!currentSftpManager.value || currentSftpManager.value.isLoading.value || !props.wsDeps.isConnected.value) return;
  editablePath.value = currentSftpManager.value.currentPath.value; // Set editable path on focus
  openPathHistory();
  nextTick(() => {
    pathInputRef.value?.select();
  });
};

const handlePathInputChange = () => {
  if (showPathHistoryDropdown.value) {
    pathHistoryStore.setSearchTerm(editablePath.value);
  }
};

const navigateToPath = async (path: string) => {
  if (!currentSftpManager.value || !path || path.trim().length === 0) return;
  const targetPath = path;
  isEditingPath.value = false;
  closePathHistory();

  if (targetPath === currentSftpManager.value.currentPath.value) {
    return;
  }

  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] 尝试导航到新路径: ${targetPath}`);
  try {
    await currentSftpManager.value.loadDirectory(targetPath);
    // 如果 loadDirectory 没有抛出错误，我们认为它成功了
    pathHistoryStore.addPath(targetPath); // 导航成功后添加到历史
    editablePath.value = targetPath; // 更新输入框内容
  } catch (error) {
    console.error(`[FileManager ${props.sessionId}-${props.instanceId}] 导航到路径 ${targetPath} 失败:`, error);
    // 导航失败，不添加到历史记录，也不更新输入框内容 (除非有特定需求)
  }
};

const handlePathInputKeydown = (event: KeyboardEvent) => {
  if (!showPathHistoryDropdown.value) {
    if (event.key === 'Enter') {
      navigateToPath(editablePath.value);
    } else if (event.key === 'Escape') {
      cancelPathEdit();
    }
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      pathHistoryStore.selectNextPath();
      // Dropdown component handles scrolling
      break;
    case 'ArrowUp':
      event.preventDefault();
      pathHistoryStore.selectPreviousPath();
      // Dropdown component handles scrolling
      break;
    case 'Enter':
      event.preventDefault();
      if (pathSelectedIndex.value >= 0 && filteredPathHistory.value[pathSelectedIndex.value]) {
        navigateToPath(filteredPathHistory.value[pathSelectedIndex.value].path);
      } else {
        navigateToPath(editablePath.value);
      }
      closePathHistory();
      break;
    case 'Escape':
      event.preventDefault();
      closePathHistory();
      // Keep isEditingPath true to allow user to continue editing or blur
      break;
  }
};

const handlePathSelectedFromDropdown = (path: string) => {
  editablePath.value = path; // Update input field
  navigateToPath(path); // Navigate and add to history
  closePathHistory();
};

const startPathEdit = () => {
    if (!currentSftpManager.value || currentSftpManager.value.isLoading.value || !props.wsDeps.isConnected.value) return;
    editablePath.value = currentSftpManager.value.currentPath.value;
    isEditingPath.value = true;
    openPathHistory(); // 打开历史记录
    nextTick(() => {
        pathInputRef.value?.focus();
        pathInputRef.value?.select();
    });
};

// Modified to handle path history logic
const handlePathInput = async (event?: Event | FocusEvent) => {
    // This function is now primarily for blur handling or if Enter is pressed outside keydown.
    // Most Enter logic is in handlePathInputKeydown.
    if (event && event instanceof KeyboardEvent && event.key !== 'Enter') {
      // If it's a key event but not Enter, it's handled by keydown or change.
      return;
    }

    if (event && event.type === 'blur') {
      setTimeout(() => {
        const activeEl = document.activeElement;
        const dropdownEl = pathHistoryDropdownRef.value?.$el;
        if (dropdownEl && dropdownEl.contains(activeEl)) {
          // Focus is within the dropdown, do nothing yet
          return;
        }
        if (pathInputRef.value !== activeEl) { 
            isEditingPath.value = false;
            closePathHistory();
        }
      }, 150); 
      return; 
    }

  
    if (!currentSftpManager.value) return;

    const newPath = editablePath.value;
    if (newPath.trim().length === 0) return;
    // Check if dropdown has a selection, if so, it should have been handled by Enter in keydown
    if (pathSelectedIndex.value >= 0 && filteredPathHistory.value[pathSelectedIndex.value]) {
        // This case should ideally not be hit if keydown is working correctly
        navigateToPath(filteredPathHistory.value[pathSelectedIndex.value].path);
    } else {
        navigateToPath(newPath);
    }
    isEditingPath.value = false; // Ensure editing mode is exited
    closePathHistory(); // Ensure dropdown is closed
};


const cancelPathEdit = () => {
    isEditingPath.value = false;
    closePathHistory();
    // Optionally, revert editablePath to currentSftpManager.currentPath.value
    if (currentSftpManager.value) {
        editablePath.value = currentSftpManager.value.currentPath.value;
    }
};

const handleClickOutsidePathInput = (event: MouseEvent) => {
  if (pathInputWrapperRef.value && !pathInputWrapperRef.value.contains(event.target as Node)) {
    if (isEditingPath.value || showPathHistoryDropdown.value) {
        isEditingPath.value = false;
        closePathHistory();
    }
  }
};


// --- 搜索框激活/取消逻辑 ---
const activateSearch = () => {
  isSearchActive.value = true;
  nextTick(() => {
    searchInputRef.value?.focus();
  });
};

const deactivateSearch = () => {
        isSearchActive.value = false;

};

const cancelSearch = () => {
    searchQuery.value = ''; // 按 Esc 清空并失活
    isSearchActive.value = false;
};

// --- Safely queue a directory change for the interactive shell ---
const sendCdCommandToTerminal = () => {
  if (!currentSftpManager.value || !props.wsDeps.isConnected.value || isChangingTerminalPath.value) return;
  const currentPath = currentSftpManager.value.currentPath.value;
  if (!currentPath) return;

  terminalPathChangeCleanup?.();
  const requestId = generateRequestId();
  let unregisterResult = () => {};
  let unregisterQueued = () => {};
  let unregisterError = () => {};
  const finish = () => {
    unregisterResult();
    unregisterQueued();
    unregisterError();
    isChangingTerminalPath.value = false;
    terminalPathChangeCleanup = null;
  };

  unregisterResult = props.wsDeps.onMessage('ssh:change_directory:result', (payload, message) => {
    if (message.requestId !== requestId) return;
    finish();
    uiNotificationsStore.showSuccess(t('fileManager.notifications.terminalPathChanged', { path: payload?.path || currentPath }));
  });
  unregisterQueued = props.wsDeps.onMessage('ssh:change_directory:queued', (payload, message) => {
    if (message.requestId !== requestId) return;
    if (payload?.waitingForPrompt) {
      uiNotificationsStore.showInfo(t('fileManager.notifications.terminalPathQueued'));
    }
  });
  unregisterError = props.wsDeps.onMessage('ssh:change_directory:error', (payload, message) => {
    if (message.requestId !== requestId) return;
    finish();
    uiNotificationsStore.showError(payload?.error || t('fileManager.errors.terminalPathChangeFailed'));
  });

  terminalPathChangeCleanup = finish;
  isChangingTerminalPath.value = true;
  props.wsDeps.sendMessage({
    type: 'ssh:change_directory',
    requestId,
    payload: { path: currentPath },
  });
};

const syncPathFromTerminal = () => {
  if (!currentSftpManager.value || !props.wsDeps.isConnected.value || isSyncingPathFromTerminal.value) return;

  const requestId = generateRequestId();
  const unregisterResult = props.wsDeps.onMessage('ssh:exec_silent:result', (payload, message) => {
    if (message.requestId !== requestId) return;
    finish();
    const path = typeof payload?.output === 'string' && payload.output.startsWith('/') ? payload.output : '';
    if (path) {
      currentSftpManager.value?.loadDirectory(path);
    } else {
      uiNotificationsStore.showError(t('fileManager.errors.pathReadFailed', 'Failed to read terminal path.'));
    }
  });
  const unregisterError = props.wsDeps.onMessage('ssh:exec_silent:error', (payload, message) => {
    if (message.requestId !== requestId) return;
    finish();
    uiNotificationsStore.showError(payload?.error || t('fileManager.errors.pathReadFailed', 'Failed to read terminal path.'));
  });
  const timeout = window.setTimeout(() => {
    finish();
    uiNotificationsStore.showError(t('fileManager.errors.pathReadTimeout', 'Timed out while reading terminal path.'));
  }, 6500);
  const finish = () => {
    unregisterResult();
    unregisterError();
    window.clearTimeout(timeout);
    isSyncingPathFromTerminal.value = false;
    silentExecCleanup = null;
  };

  silentExecCleanup?.();
  silentExecCleanup = finish;
  isSyncingPathFromTerminal.value = true;
  props.wsDeps.sendMessage({
    type: 'ssh:exec_silent',
    requestId,
    payload: { action: 'pwd', timeoutMs: 5000 },
  });
};


// --- 打开弹窗编辑器的方法 ---
const openPopupEditor = () => {
  if (!props.sessionId) {
    console.error('[FileManager] Cannot open popup editor: Missing session ID.');
    // 可以添加 UI 通知
    return;
  }
  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Triggering popup editor without specific file.`);
  fileEditorStore.triggerPopup('', effectiveSessionId.value); // 修复：使用空字符串触发空编辑器
};
// --- 行大小调整逻辑 ---
const handleWheel = (event: WheelEvent) => {
    const change = resolveFileManagerWheelScale(event, rowSizeMultiplier.value);
    if (!change) return;

    const oldEstimatedRowHeight = estimatedFileRowHeight.value;
    const container = fileListContainerRef.value;
    const anchoredRow = shouldVirtualizeFileList.value && container
      ? container.scrollTop / oldEstimatedRowHeight
      : null;
    rowSizeMultiplier.value = change.next;

    if (anchoredRow !== null && container) {
      void nextTick(() => {
        const nextScrollTop = anchoredRow * estimatedFileRowHeight.value;
        container.scrollTop = nextScrollTop;
        fileListScrollTop.value = nextScrollTop;
      });
    }
    scheduleRowScaleSave();
};

// +++ 聚焦搜索框的方法 +++
const focusSearchInput = (): boolean => {
  // 检查当前会话是否激活，防止后台实例响应
  if (effectiveSessionId.value !== sessionStore.activeSessionId) {
      console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Ignoring focus request for inactive session.`);
      return false;
  }

  if (!isSearchActive.value) {
    activateSearch(); // Activate search first
    // nextTick 确保 DOM 更新后再聚焦
    nextTick(() => {
        if (searchInputRef.value) {
            searchInputRef.value.focus();
            console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Search activated and input focused.`);
        } else {
            console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] Search activated but input ref not found after nextTick.`);
        }
    });
    return true; // 假设会成功
  } else if (searchInputRef.value) {
    searchInputRef.value.focus();
    console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Search already active, input focused.`);
    return true;
  }
  console.warn(`[FileManager ${props.sessionId}-${props.instanceId}] Could not focus search input.`);
  return false;
};
defineExpose({ focusSearchInput, startPathEdit });

// --- 处理“打开编辑器”按钮点击 ---
const handleOpenEditorClick = () => {
  if (!props.sessionId) {
    console.error(`[FileManager ${props.instanceId}] Cannot open editor: Missing session ID.`);
    // TODO: Show error notification to user
    return;
  }
  console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Triggering popup editor directly.`);
  fileEditorStore.triggerPopup('', effectiveSessionId.value); // 修复：传递空字符串而不是 null
 };
 
 // +++ Favorite Paths Modal Logic +++
 const toggleFavoritePathsModal = () => {
   showFavoritePathsModal.value = !showFavoritePathsModal.value;
   console.log(`[FileManager ${props.sessionId}-${props.instanceId}] Toggled FavoritePathsModal. Visible: ${showFavoritePathsModal.value}`);
 };
 
 const handleNavigateToPathFromFavorites = (path: string) => {
   if (currentSftpManager.value) {
     currentSftpManager.value.loadDirectory(path);
   }
   showFavoritePathsModal.value = false; // Close modal after navigation
 };
 </script>

<template>
  <div class="file-manager-root flex flex-col h-full overflow-hidden bg-background text-foreground text-sm font-sans">
    <div class="file-manager-toolbar flex items-center justify-between flex-wrap gap-1 p-2 bg-header flex-shrink-0">
        <!-- All file manager actions share one adaptive toolbar. -->
        <div class="file-manager-actions flex items-center gap-1 min-w-0">
              <input data-testid="file-upload-input" type="file" ref="fileInputRef" @change="handleFileSelected" multiple class="hidden" />
              <!-- CD 到终端按钮 -->
              <button
                class="file-manager-path-button file-manager-action-button flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
                @click.stop="sendCdCommandToTerminal"
                :disabled="!currentSftpManager || !props.wsDeps.isConnected.value || isEditingPath || isChangingTerminalPath"
                :title="t('fileManager.actions.cdToTerminal', 'Change terminal directory to current path')"
              >
                <i :class="['fas', isChangingTerminalPath ? 'fa-spinner fa-spin' : 'fa-terminal', 'text-sm']"></i>
              </button>
              <button
                class="file-manager-path-button file-manager-action-button flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
                @click.stop="syncPathFromTerminal"
                :disabled="!currentSftpManager || !props.wsDeps.isConnected.value || isEditingPath || isSyncingPathFromTerminal"
                :title="t('fileManager.actions.syncFromTerminalPath', 'Sync file manager to terminal directory')"
              >
                <i :class="['fas', isSyncingPathFromTerminal ? 'fa-spinner fa-spin' : 'fa-folder-open', 'text-sm']"></i>
              </button>
              <!-- 刷新按钮 -->
              <button
                class="file-manager-path-button file-manager-action-button flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
                @click.stop="currentSftpManager?.loadDirectory(currentSftpManager?.currentPath?.value ?? '/', true)"
                :disabled="!currentSftpManager || !props.wsDeps.isConnected.value || isEditingPath"
                :title="t('fileManager.actions.refresh')"
              >
                <i class="fas fa-sync-alt text-sm"></i>
              </button>
              <button
                class="file-manager-path-button file-manager-action-button flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
                @click.stop="handleItemClick($event, { filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } })"
                :disabled="!currentSftpManager || !props.wsDeps.isConnected.value || currentSftpManager?.currentPath?.value === '/' || isEditingPath"
                :title="t('fileManager.actions.parentDirectory')"
              >
                <i class="fas fa-arrow-up text-sm"></i>
              </button>
             <!-- Search Area -->
             <div class="file-manager-search-slot flex items-center flex-shrink-0" :class="{ 'is-active': isSearchActive }">
                 <button
                     v-if="!isSearchActive"
                     class="file-manager-path-button file-manager-action-button flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-foreground transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
                     @click.stop="activateSearch"
                     :disabled="!currentSftpManager || !props.wsDeps.isConnected.value"
                     :title="t('fileManager.searchPlaceholder')"
                 >
                     <i class="fas fa-search text-sm"></i>
                 </button>
                 <div v-else class="file-manager-search-box relative flex items-center min-w-[150px] flex-shrink">
                     <i class="fas fa-search absolute left-2 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"></i>
                     <input
                         ref="searchInputRef"
                         type="text"
                         v-model="searchQuery"
                         :placeholder="t('fileManager.searchPlaceholder')"
                         class="flex-grow bg-background border border-border rounded pl-7 pr-2 py-1 text-foreground text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary min-w-[10px] transition-colors duration-200"
                         data-focus-id="fileManagerSearch"
                         @blur="deactivateSearch"
                         @keyup.esc="cancelSearch"
                         @keydown.up.prevent="handleKeydown"
                         @keydown.down.prevent="handleKeydown"
                         @keydown.enter.prevent="handleKeydown"
                     />
                     <!-- Optional: Clear button -->
                     <!-- <button @click="searchQuery = ''; searchInputRef?.focus()" v-if="searchQuery" class="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-foreground">&times;</button> -->
                 </div>
             </div>
             <div class="file-manager-favorite-slot relative flex-shrink-0">
              <!-- Favorite Paths Button -->
              <button
                  ref="favoritePathsButtonRef"
                  class="file-manager-path-button file-manager-action-button flex items-center justify-center w-7 h-7 bg-background border border-border rounded text-foreground transition-colors duration-200 hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
                  @click="toggleFavoritePathsModal"
              >
                  <i class="fas fa-star text-sm"></i>
              </button>
              <!-- Favorite Paths Modal -->
              <FavoritePathsModal
                :is-visible="showFavoritePathsModal"
                :trigger-element="favoritePathsButtonRef"
                @close="showFavoritePathsModal = false"
                @navigate-to-path="handleNavigateToPathFromFavorites"
              />
            </div>
            <!-- 打开编辑器按钮 -->
            <button
              v-if="showPopupFileEditorBoolean"
              @click="openPopupEditor"
              :disabled="!currentSftpManager || !props.wsDeps.isConnected.value"
              :title="t('fileManager.actions.openEditor', 'Open Popup Editor')"
              class="file-manager-action-button flex items-center px-2 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
              :class="{ 'px-1.5': props.isMobile }"
            >
              <i class="far fa-edit text-sm"></i> <!-- 使用编辑图标 -->
            </button>
            <!-- 上传按钮 -->
            <button
              data-testid="file-upload-button"
              @click="triggerFileUpload"
              :disabled="!currentSftpManager || !props.wsDeps.isConnected.value"
              :title="t('fileManager.actions.uploadFile')"
              class="file-manager-action-button flex items-center px-2 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
              :class="{ 'px-1.5': props.isMobile }"
            >
              <i class="fas fa-upload text-sm"></i>
            </button>
            <button
              @click="handleNewFolderContextMenuClick"
              :disabled="!currentSftpManager || !props.wsDeps.isConnected.value"
              :title="t('fileManager.actions.newFolder')"
              class="file-manager-action-button flex items-center px-2 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
              :class="{ 'px-1.5': props.isMobile }"
            >
              <i class="fas fa-folder-plus text-sm"></i>
            </button>
            <button
              @click="handleNewFileContextMenuClick"
              :disabled="!currentSftpManager || !props.wsDeps.isConnected.value"
              :title="t('fileManager.actions.newFile')"
              class="file-manager-action-button flex items-center px-2 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:enabled:bg-header hover:enabled:border-primary hover:enabled:text-primary"
              :class="{ 'px-1.5': props.isMobile }"
            >
              <i class="far fa-file-alt text-sm"></i>
            </button>
            <!-- 多选模式切换按钮 (仅移动端) -->
            <button
              v-if="props.isMobile"
              @click="toggleMultiSelectMode"
              :title="isMultiSelectMode ? t('fileManager.actions.exitMultiSelect', 'Exit Multi-Select Mode') : t('fileManager.actions.multiSelect', 'Enter Multi-Select Mode')"
              class="file-manager-action-button flex items-center gap-1 px-1.5 py-1 bg-background border border-border rounded text-foreground text-xs transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              :class="{
                'hover:bg-header hover:border-primary hover:text-primary': !isMultiSelectMode,
                'bg-primary text-white border-primary': isMultiSelectMode
              }"
            >
              <i class="fas fa-check-square text-sm"></i>
            </button>
         </div>
       <!-- Path is the final item in the primary toolbar row. -->
       <div ref="pathInputWrapperRef" class="file-manager-path-input relative flex items-center bg-background border border-border rounded px-1.5 py-0.5 min-w-0">
         <span v-show="!isEditingPath && !showPathHistoryDropdown" @click="startPathEdit" class="text-text-secondary pr-2 cursor-text truncate min-w-0">
           <strong
             :title="t('fileManager.editPathTooltip')"
             class="font-medium text-link px-1 rounded transition-colors duration-200"
             :class="{
               'hover:bg-black/5': currentSftpManager && props.wsDeps.isConnected.value,
               'opacity-60 cursor-not-allowed': !currentSftpManager || !props.wsDeps.isConnected.value
             }"
           >
             {{ currentSftpManager?.currentPath?.value ?? '/' }}
           </strong>
         </span>
         <input
           v-show="isEditingPath || showPathHistoryDropdown"
           ref="pathInputRef"
           type="text"
           v-model="editablePath"
           class="flex-grow bg-transparent text-foreground p-0.5 outline-none min-w-[100px]"
           data-focus-id="fileManagerPathInput"
           @focus="handlePathInputFocus"
           @input="handlePathInputChange"
           @keydown="handlePathInputKeydown"
           @blur="handlePathInput"
         />
         <PathHistoryDropdown
           v-if="showPathHistoryDropdown"
           ref="pathHistoryDropdownRef"
           @pathSelected="handlePathSelectedFromDropdown"
           @closeDropdown="closePathHistory"
           class="left-0 right-0 top-full mt-1"
         />
       </div>
     </div>


    <!-- File List Container -->
    <div
      ref="fileListContainerRef"
      data-testid="file-manager-list"
      class="flex-grow overflow-y-auto relative outline-none"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent="handleDragOver"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
      @click="fileListContainerRef?.focus()"
      @keydown="handleFileListKeydown"
      @wheel="handleWheel"
      @scroll="handleFileListScroll"
      @contextmenu.prevent="showContextMenu($event)"
      @pointerdown="handleMobileContextPointerStart($event)"
      @pointermove="handleMobileContextPointerMove"
      @pointerup="handleMobileContextPointerEnd"
      @pointercancel="handleMobileContextPointerCancel"
      tabindex="0"
      :data-row-scale="rowSizeMultiplier.toFixed(2)"
      :style="{ '--row-size-multiplier': rowSizeMultiplier }"
    >
        <!-- 外部文件拖拽蒙版 -->
        <div
          v-if="showExternalDropOverlay"
          ref="dropOverlayRef"
          data-testid="file-upload-drop-overlay"
          class="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-xl font-semibold rounded z-50 pointer-events-auto"
          @dragover.prevent
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleOverlayDrop"
        >
          {{ t('fileManager.dropFilesHere', 'Drop files here to upload') }}
        </div>

        <!-- File Table -->
        <table
          ref="tableRef"
          class="w-full border-collapse table-fixed border-border rounded"
          :class="{'pointer-events-none': showExternalDropOverlay}"
          :style="{ minWidth: `${totalColumnWidth}px` }"
          @contextmenu.prevent
        >
            <colgroup>
                 <col :style="{ width: `${colWidths.type}px` }">
                <col :style="{ width: `${colWidths.name}px` }">
                <col :style="{ width: `${colWidths.size}px` }">
                <col :style="{ width: `${colWidths.permissions}px` }">
                <col :style="{ width: `${colWidths.modified}px` }">
           </colgroup>
          <thead class="sticky top-0 z-10 bg-header">
            <tr>
              <th
                data-testid="file-manager-type-header"
                @click="handleSort('type')"
                class="relative whitespace-nowrap overflow-hidden px-2 py-1 border-b-2 border-border text-left text-xs font-medium text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:bg-black/5"
                :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '1rem', paddingRight: '0.5rem' }"
              >
                {{ t('fileManager.headers.type') }}
                <span v-if="sortKey === 'type'" class="ml-1">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
                <span class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20" @mousedown.prevent="startResize($event, 0)" @click.stop></span>
              </th>
              <th
                @click="handleSort('filename')"
                class="relative whitespace-nowrap overflow-hidden px-2 py-1 border-b-2 border-border text-left text-xs font-medium text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:bg-black/5"
                :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem' }"
              >
                {{ t('fileManager.headers.name') }}
                <span v-if="sortKey === 'filename'" class="ml-1">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
                <span class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20" @mousedown.prevent="startResize($event, 1)" @click.stop></span>
              </th>
              <th
                @click="handleSort('size')"
                class="relative whitespace-nowrap overflow-hidden px-2 py-1 border-b-2 border-border text-left text-xs font-medium text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:bg-black/5"
                :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem' }"
              >
                {{ t('fileManager.headers.size') }}
                <span v-if="sortKey === 'size'" class="ml-1">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
                <span class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20" @mousedown.prevent="startResize($event, 2)" @click.stop></span>
              </th>
              <th
                class="relative whitespace-nowrap overflow-hidden px-2 py-1 border-b-2 border-border text-left text-xs font-medium text-text-secondary uppercase tracking-wider select-none"
                :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem' }"
              >
                {{ t('fileManager.headers.permissions') }}
                <span class="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-20 hover:bg-primary/20" @mousedown.prevent="startResize($event, 3)" @click.stop></span>
              </th>
              <th
                @click="handleSort('mtime')"
                class="relative whitespace-nowrap overflow-hidden px-2 py-1 border-b-2 border-border text-left text-xs font-medium text-text-secondary uppercase tracking-wider cursor-pointer select-none hover:bg-black/5"
                :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem' }"
              >
                {{ t('fileManager.headers.modified') }}
                <span v-if="sortKey === 'mtime'" class="ml-1">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span>
                <!-- No resizer on the last column -->
              </th>
            </tr>
          </thead>

          <!-- Loading State -->
          <tbody v-if="!currentSftpManager || currentSftpManager.isLoading.value">
              <tr>
                  <td :colspan="5" class="px-4 py-6 text-center text-text-secondary italic">
                    {{ t('fileManager.loading') }}
                  </td>
              </tr>
          </tbody>

          <!-- Empty Directory State -->
          <tbody v-else-if="filteredFileList.length === 0">
               <tr v-if="currentSftpManager?.currentPath.value !== '/'"
                   class="transition-colors duration-150 cursor-pointer select-none hover:bg-header/50"
                   @click="handleItemClick($event, { filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } })"
                   :data-filename="'..'"
               >
                 <td class="text-center border-b border-border align-middle" :style="{ paddingLeft: '1rem', paddingRight: '0.5rem' }">
                   <i class="fas fa-level-up-alt text-primary" :style="{ fontSize: `calc(1.1em * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }"></i>
                 </td>
                 <td class="border-b border-border align-middle" :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem', fontSize: `calc(0.8rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }">..</td>
                 <td class="border-b border-border align-middle"></td>
                 <td class="border-b border-border align-middle"></td>
                 <td class="border-b border-border align-middle"></td>
               </tr>
               <tr>
                   <td :colspan="5" class="px-4 py-6 text-center text-text-secondary italic">
                     {{ searchQuery ? t('fileManager.noSearchResults') : t('fileManager.emptyDirectory') }}
                   </td>
               </tr>
          </tbody>

          <!-- File List State -->
          <tbody v-else> <!-- Remove context menu handler from tbody -->
            <!-- '..' Entry -->
            <tr v-if="currentSftpManager?.currentPath.value !== '/'"
                class="transition-colors duration-150 cursor-pointer select-none"
                :class="{
                    'bg-primary/10': selectedIndex === 0,
                    'outline-dashed outline-2 outline-offset-[-1px] outline-primary': dragOverTarget === '..',
                    'hover:bg-header/50': dragOverTarget !== '..'
                }"
                @click="handleItemClick($event, { filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } })"
                @contextmenu.prevent.stop="showContextMenu($event, { filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } })"
                @dragover.prevent="handleDragOverRow({ filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } }, $event)"
                @dragleave="handleDragLeaveRow({ filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } })"
                @drop.prevent="handleDropOnRow({ filename: '..', longname: '..', attrs: { isDirectory: true, isFile: false, isSymbolicLink: false, size: 0, uid: 0, gid: 0, mode: 0, atime: 0, mtime: 0 } }, $event)"
                :data-filename="'..'"
                :data-list-index="0"
                >
              <td class="text-center border-b border-border align-middle" :style="{ paddingLeft: '1rem', paddingRight: '0.5rem' }">
                <i class="fas fa-level-up-alt text-primary" :style="{ fontSize: `calc(1.1em * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }"></i>
              </td>
              <td class="border-b border-border align-middle" :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem', fontSize: `calc(0.8rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }">..</td>
              <td class="border-b border-border align-middle"></td>
              <td class="border-b border-border align-middle"></td>
              <td class="border-b border-border align-middle"></td>
            </tr>
            <!-- File Entries -->
            <tr v-if="virtualTopPadding > 0" aria-hidden="true">
              <td :colspan="5" class="p-0 border-0" :style="{ height: `${virtualTopPadding}px` }"></td>
            </tr>
            <tr v-for="(item, index) in virtualFileList"
                :key="item.filename"
                :draggable="!props.isMobile && item.filename !== '..'" @dragstart="handleDragStart(item)" @dragend="handleDragEnd"
                @click="handleItemClick($event, item, props.isMobile && isMultiSelectMode)"
                @dblclick="handleItemDoubleClick($event, item)"
                @pointerdown.stop="handleMobileContextPointerStart($event, item)"
                @pointermove.stop="handleMobileContextPointerMove"
                @pointerup.stop="handleMobileContextPointerEnd"
                @pointercancel.stop="handleMobileContextPointerCancel"
                class="transition-colors duration-150 select-none touch-pan-y"
                :class="[
                    { 'cursor-pointer': item.attrs.isDirectory || item.attrs.isFile },
                    { 'bg-primary text-white': selectedItems.has(item.filename) || (virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0) === selectedIndex) },
                    { 'hover:bg-header/50': !(selectedItems.has(item.filename) || (virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0) === selectedIndex)) },
                    { 'outline-dashed outline-2 outline-offset-[-1px] outline-primary': item.attrs.isDirectory && dragOverTarget === item.filename }
                ]"
               :data-filename="item.filename"
               :data-list-index="virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0)"
               @contextmenu.prevent.stop="handleItemContextMenu($event, item)"
               @dragover.prevent="handleDragOverRow(item, $event)"
               @dragleave="handleDragLeaveRow(item)"
               @drop.prevent="handleDropOnRow(item, $event)">
              <td class="text-center border-b border-border align-middle" :style="{ paddingLeft: '1rem', paddingRight: '0.5rem' }">
                <i :class="[
                  'transition-colors duration-150',
                  item.attrs.isDirectory
                    ? 'fas fa-folder text-primary'
                    : item.attrs.isSymbolicLink
                      ? 'fas fa-link text-cyan-500'
                      : `${getFileIconClassBase(item.filename)} text-text-secondary`,
                  {
                    'text-white': selectedItems.has(item.filename) || (virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0) === selectedIndex)
                  }
                ]"
                :style="{ fontSize: `calc(1.1em * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }"></i>
              </td>
              <td class="border-b border-border truncate align-middle" :class="{'font-medium': item.attrs.isDirectory}" :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem', fontSize: `calc(0.8rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }">{{ item.filename }}</td>
              <td class="border-b border-border truncate align-middle" :class="[
                selectedItems.has(item.filename) || (virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0) === selectedIndex) ? 'text-white' : 'text-text-secondary'
              ]" :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem', fontSize: `calc(0.72rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }">{{ item.attrs.isFile ? formatSize(item.attrs.size) : '' }}</td>
              <td class="border-b border-border truncate font-mono align-middle" :class="[
                selectedItems.has(item.filename) || (virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0) === selectedIndex) ? 'text-white' : 'text-text-secondary'
              ]" :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem', fontSize: `calc(0.72rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }">{{ formatMode(item.attrs.mode) }}</td>
              <td class="border-b border-border truncate align-middle" :class="[
                selectedItems.has(item.filename) || (virtualStartIndex + index + (currentSftpManager?.currentPath.value !== '/' ? 1 : 0) === selectedIndex) ? 'text-white' : 'text-text-secondary'
              ]" :style="{ paddingTop: `calc(0.4rem * var(--row-size-multiplier))`, paddingBottom: `calc(0.4rem * var(--row-size-multiplier))`, paddingLeft: '0.8rem', paddingRight: '0.8rem', fontSize: `calc(0.72rem * max(0.85, var(--row-size-multiplier) * 0.5 + 0.5))` }">{{ new Date(item.attrs.mtime).toLocaleString() }}</td>
            </tr>
            <tr v-if="virtualBottomPadding > 0" aria-hidden="true">
              <td :colspan="5" class="p-0 border-0" :style="{ height: `${virtualBottomPadding}px` }"></td>
            </tr>
          </tbody>
        </table>
        <!-- Removed separate loading/empty divs -->
     </div>

     <!-- 使用 FileUploadPopup 组件 -->
     <FileUploadPopup
       :uploads="uploads"
       :session-label="progressSessionLabel"
       :progress-source-id="uploadProgressSourceId"
       :restore-token="floatingProgressRestoreToken"
       @cancel-upload="cancelUpload"
       @cancel-all="cancelAllUploads"
     />
     <UploadConflictModal :conflict="uploadConflict" @resolve="resolveUploadConflict" />
     <FileTransferPopup
       :transfers="transferTasks"
       :session-label="progressSessionLabel"
       :progress-source-id="currentSftpManager?.transferProgressSourceId"
       :restore-token="floatingProgressRestoreToken"
     />

     <ArchiveProgressPopup
       :progress="archiveProgress"
       :session-label="progressSessionLabel"
       :progress-source-id="currentSftpManager?.archiveProgressSourceId"
       :restore-token="floatingProgressRestoreToken"
       @cancel="currentSftpManager?.cancelArchive()"
     />

    <FileManagerContextMenu
      ref="contextMenuRef"
      :is-visible="contextMenuVisible"
      :position="contextMenuPosition"
      :items="contextMenuItems"
      :active-context-item="contextTargetItem"
      :selected-file-items="computedSelectedFullItems"
      :current-directory-path="currentSftpManager?.currentPath?.value ?? '/'"
      :source-ready="props.wsDeps.isConnected.value && props.wsDeps.isSftpReady.value"
     @close-request="hideContextMenu"
   />

   <!-- Action Modal -->
   <FileManagerActionModal
     :is-visible="isActionModalVisible"
     :action-type="currentActionType"
     :item="actionItem"
     :items="actionItems"
     :initial-value="actionInitialValue"
     @close="handleModalClose"
     @confirm="handleModalConfirm"
   />

   <ArchivePasswordModal
     :is-visible="archivePasswordModalVisible"
     :mode="archivePasswordMode"
     :item-count="archivePasswordItems.length"
     :archive-name="archivePasswordItem?.filename ?? ''"
     :error-message="archivePasswordError"
     @close="closeArchivePasswordModal"
     @confirm="handleArchivePasswordConfirm"
   />

   <div
     v-if="isPreviewLoading"
     class="file-preview-loading-overlay"
     role="dialog"
     aria-modal="true"
     :aria-label="t('fileManager.preview.loading')"
     @click.self="hidePreview"
   >
     <div class="file-preview-loading-card">
       <i class="fas fa-spinner fa-spin" aria-hidden="true"></i>
       <span>{{ t('fileManager.preview.loading', 'Loading preview...') }}</span>
       <button
         type="button"
         :aria-label="t('fileManager.preview.close')"
         @click="hidePreview"
       >×</button>
     </div>
   </div>

   <component
     v-for="entry in previewTabs"
     :key="entry.id"
     :is="entry.component"
     :file="entry.file"
     :active="previewWorkspaceVisible && entry.id === activePreviewId"
     v-bind="entry.componentProps"
     @close="hidePreview"
     @edit="editPreviewTab(entry.id)"
   />

  <!-- Favorite Paths Modal is now positioned near its button -->


</div>
</template>

<style scoped>
.file-preview-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.68);
}

.file-preview-loading-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1rem;
  border: 1px solid var(--border-color, rgba(255, 255, 255, 0.2));
  border-radius: 0.5rem;
  color: white;
  background: rgba(20, 20, 20, 0.95);
}

.file-preview-loading-card button {
  margin-left: 0.25rem;
  border: 0;
  color: inherit;
  background: transparent;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
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
.file-manager-root {
  container-type: inline-size;
  container-name: file-manager-pane;
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
.file-manager-path-button {
  flex: 0 0 1.75rem;
}
.file-manager-search-box,
.file-manager-path-input {
  max-width: 100%;
}
.file-manager-path-input {
  flex: 1 1 12rem;
  min-width: 8rem;
  order: 3;
}
.file-manager-actions {
  flex: 1 1 auto;
  max-width: 100%;
  flex-wrap: wrap;
  justify-content: flex-start;
  order: 2;
}
.file-manager-action-button {
  min-height: 1.75rem;
  min-width: 1.75rem;
  justify-content: center;
  white-space: nowrap;
}
.file-manager-action-label {
  min-width: 0;
}
@container file-manager-pane (max-width: 520px) {
  .file-manager-search-box {
    min-width: 0 !important;
    width: min(100%, 10rem);
  }
  .file-manager-actions {
    gap: 0.25rem;
  }
  .file-manager-action-button {
    padding-left: 0.45rem !important;
    padding-right: 0.45rem !important;
  }
}
@container file-manager-pane (max-width: 420px) {
  .file-manager-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(1.75rem, 1fr));
    flex: 1 1 100%;
    width: 100%;
    gap: 0.25rem;
  }
  .file-manager-actions > .file-manager-action-button,
  .file-manager-search-slot,
  .file-manager-favorite-slot {
    width: 100%;
    min-width: 0;
    flex: none;
  }
  .file-manager-action-button {
    width: 100% !important;
    height: 1.75rem !important;
  }
  .file-manager-search-slot,
  .file-manager-favorite-slot {
    width: 100%;
  }
  .file-manager-search-slot .file-manager-action-button,
  .file-manager-favorite-slot .file-manager-action-button {
    width: 100% !important;
  }
  .file-manager-actions .file-manager-search-slot > .file-manager-path-button {
    width: 100% !important;
    height: 1.75rem !important;
    min-width: 0;
    flex-basis: auto;
  }
  .file-manager-search-slot.is-active {
    grid-column: 1 / -1;
  }
  .file-manager-search-slot.is-active .file-manager-search-box {
    width: 100%;
  }
  .file-manager-action-label {
    display: none;
  }
  .file-manager-action-button {
    padding-left: 0.35rem !important;
    padding-right: 0.35rem !important;
  }
}
@container file-manager-pane (max-width: 320px) {
  .file-manager-toolbar {
    padding: 0.35rem;
    gap: 0.25rem;
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
