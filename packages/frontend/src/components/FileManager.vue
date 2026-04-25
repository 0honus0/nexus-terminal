<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  nextTick,
  watch,
  watchEffect,
  type PropType,
  readonly,
  shallowRef,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import {
  createSftpActionsManager,
  type WebSocketDependencies,
} from '../composables/useSftpActions';
import { useFileUploader } from '../composables/useFileUploader';
import { useFileEditorStore, type FileInfo } from '../stores/fileEditor.store';
import { useSessionStore } from '../stores/session.store';
import { useSettingsStore } from '../stores/settings.store';
import { useFocusSwitcherStore } from '../stores/focusSwitcher.store';
import {
  useFileManagerContextMenu,
  type ClipboardState,
  type CompressFormat,
} from '../composables/file-manager/useFileManagerContextMenu';
import {
  SILENT_PWD_PREFIX,
  parsePathFromSilentOutput,
} from '../composables/file-manager/fileManagerTerminalPathUtils';
import { useFileManagerSelection } from '../composables/file-manager/useFileManagerSelection';
import { useFileManagerDragAndDrop } from '../composables/file-manager/useFileManagerDragAndDrop';
import { useFileManagerKeyboardNavigation } from '../composables/file-manager/useFileManagerKeyboardNavigation';
import { useFileManagerSortFilter } from '../composables/file-manager/useFileManagerSortFilter';
import { useFileManagerColumnResize } from '../composables/file-manager/useFileManagerColumnResize';
import { useFileManagerLayoutSettings } from '../composables/file-manager/useFileManagerLayoutSettings';
import { useFileManagerPathNavigation } from '../composables/file-manager/useFileManagerPathNavigation';
import FileUploadPopup from './FileUploadPopup.vue';
import FileManagerContextMenu from './FileManagerContextMenu.vue';
import FileManagerActionModal from './FileManagerActionModal.vue';
import FileManagerToolbar from './FileManagerToolbar.vue';
import FileManagerFileList from './FileManagerFileList.vue';
import type { FileListItem } from '../types/sftp.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import { usePathHistoryStore } from '../stores/pathHistory.store';
import { useUiNotificationsStore } from '../stores/uiNotifications.store';

type SftpManagerInstance = ReturnType<typeof createSftpActionsManager>;
type SftpRealpathPayload = {
  requestedPath?: string;
  absolutePath?: string;
  targetType?: 'file' | 'directory' | 'unknown';
  error?: string;
};
type SilentExecPayload = {
  output?: string;
  error?: string;
};

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
    default: false,
  },
});

// --- 核心 Composables ---
const { t } = useI18n();
const route = useRoute(); // Keep for download URL generation for now
const sessionStore = useSessionStore(); // 实例化 Session Store

// --- 获取并存储 SFTP 管理器实例 ---
// 使用 shallowRef 存储管理器实例，以便在 sessionId 变化时切换
const currentSftpManager = shallowRef<SftpManagerInstance | null>(null);

const initializeSftpManager = (sessionId: string, instanceId: string) => {
  const manager = sessionStore.getOrCreateSftpManager(sessionId, instanceId);
  if (!manager) {
    // 抛出错误或显示错误消息，阻止组件进一步渲染
    console.error(
      `[FileManager ${sessionId}-${instanceId}] Failed to get or create SFTP manager instance.`
    );
    // 可以设置一个错误状态 ref 在模板中显示
    // managerError.value = `Failed to get SFTP manager for instance ${instanceId}`;
    currentSftpManager.value = null; // 确保设置为 null
    // 抛出错误会阻止组件渲染，可能不是最佳用户体验
    // throw new Error(`[FileManager ${sessionId}-${instanceId}] Failed to get or create SFTP manager instance.`);
  } else {
    currentSftpManager.value = manager;
    console.info(`[FileManager ${sessionId}-${instanceId}] SFTP Manager initialized/retrieved.`);
  }
};

// 初始加载管理器
initializeSftpManager(props.sessionId, props.instanceId);

// --- 文件上传模块 ---
// 修改：依赖 currentSftpManager 的状态
const { uploads, startFileUpload, cancelUpload } = useFileUploader(
  computed(() => props.sessionId),
  // 传递 manager 的 currentPath 和 fileList ref
  computed(() => currentSftpManager.value?.currentPath.value ?? '/'),
  computed(() => currentSftpManager.value?.fileList.value ?? []),
  computed(() => props.wsDeps)
);

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
  fileManagerSingleClickOpenFileBoolean,
} = storeToRefs(settingsStore); // 使用 storeToRefs 保持响应性

// --- 排序与过滤 Composable ---
const { sortKey, sortDirection, searchQuery, filteredFileList, handleSort } =
  useFileManagerSortFilter({
    fileList: computed(() => currentSftpManager.value?.fileList.value ?? []),
  });

// --- UI 状态 Refs (Remain mostly the same) ---
const fileInputRef = ref<HTMLInputElement | null>(null);
const isMultiSelectMode = ref(false); // 多选模式状态 (主要用于移动端)
const isSearchActive = ref(false); // 控制搜索框激活状态
const fileListContainerRef = ref<HTMLDivElement | null>(null); // 文件列表容器引用
const toolbarRef = ref<InstanceType<typeof FileManagerToolbar> | null>(null); // 工具栏子组件引用
const fileListRef = ref<InstanceType<typeof FileManagerFileList> | null>(null); // 文件列表子组件引用

// --- 日志前缀（供多个 composable 共享）---
const logPrefix = computed(() => `[FileManager ${props.sessionId}-${props.instanceId}]`);

// --- 路径导航 Composable ---
const {
  isEditingPath,
  editablePath,
  showPathHistoryDropdown,
  startPathEdit,
  cancelPathEdit,
  handlePathInputFocus,
  handlePathInputKeydown,
  handlePathSelectedFromDropdown,
  navigateToPath,
  closePathHistory,
} = useFileManagerPathNavigation({
  currentSftpManager: computed(() => currentSftpManager.value),
  isConnected: computed(() => props.wsDeps.isConnected.value),
  pathHistoryStore,
  pathInputRef: computed(() => toolbarRef.value?.pathInputRef ?? null),
  logPrefix,
});

// +++ Path History Refs (for template binding) +++
const { selectedIndex: pathSelectedIndex, filteredHistory: filteredPathHistory } =
  storeToRefs(pathHistoryStore);

// +++ 操作模态框状态 +++
const isActionModalVisible = ref(false);
const currentActionType = ref<'delete' | 'rename' | 'chmod' | 'newFile' | 'newFolder' | null>(null);
const actionItem = ref<FileListItem | null>(null); // For single item operations
const actionItems = ref<FileListItem[]>([]); // For multi-item operations (e.g., delete)
const actionInitialValue = ref(''); // For pre-filling input in modal

// +++ 剪贴板状态 +++
const clipboardState = ref<ClipboardState>({ hasContent: false });
const clipboardSourcePaths = ref<string[]>([]); // 存储源完整路径
const clipboardSourceBaseDir = ref<string>(''); // 存储源目录

const isSyncingPathFromTerminal = ref(false);
let unregisterSilentExecResult: (() => void) | null = null;
let unregisterSilentExecError: (() => void) | null = null;
let unregisterSilentExecDisconnect: (() => void) | null = null;
let unregisterSilentExecClosed: (() => void) | null = null;
let unregisterSilentExecSocketError: (() => void) | null = null;
let silentExecTimeoutId: ReturnType<typeof setTimeout> | null = null;
// --- 键盘导航状态 (移至 useFileManagerKeyboardNavigation) ---
// const selectedIndex = ref<number>(-1);

// --- 布局设置 Composable（列宽 + 行大小乘数）---
const { rowSizeMultiplier, colWidths, saveLayoutSettings, handleWheel } =
  useFileManagerLayoutSettings({
    storeMultiplier: fileManagerRowSizeMultiplierNumber,
    storeWidths: fileManagerColWidthsObject,
    onSaveSettings: (multiplier, widths) => {
      settingsStore.updateFileManagerLayoutSettings(multiplier, widths);
    },
  });

// --- 列宽调整 Composable ---
const { startResize } = useFileManagerColumnResize({
  colWidths,
  onResizeEnd: saveLayoutSettings,
});

// --- 辅助函数 ---
const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// --- 排序与过滤逻辑已提取至 useFileManagerSortFilter composable ---

// --- 键盘导航滚动（委托给子组件 FileManagerFileList）---
const scrollToForKeyboardNavigation = (fileIndex: number) => {
  const hasParentLink = (currentSftpManager.value?.currentPath.value ?? '/') !== '/';
  const offset = hasParentLink ? 1 : 0;
  fileListRef.value?.scrollTo(fileIndex + offset);
};

// 文件列表子组件挂载后同步容器引用（供拖拽与键盘导航 composable 使用）
watch(
  () => fileListRef.value?.containerElement,
  (val) => {
    if (!val) return;
    fileListContainerRef.value = val as HTMLDivElement;
  },
  { immediate: true }
);

// --- 列表项点击与选择逻辑 (使用 Composable) ---
// 定义单击时的动作回调 (移到 Selection 实例化之前)
const handleItemAction = (item: FileListItem) => {
  if (!currentSftpManager.value) return;

  const itemPath = currentSftpManager.value.joinPath(
    currentSftpManager.value.currentPath.value,
    item.filename
  );

  if (item.attrs.isSymbolicLink) {
    if (currentSftpManager.value.isLoading.value) {
      return;
    }
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Symbolic link clicked: ${itemPath}. Attempting to resolve with sftp:realpath...`
    );

    const { sendMessage: wsSend, onMessage: wsOnMessage } = props.wsDeps;
    const requestId = generateRequestId();

    const handleResolvedPath = (
      realPath: string,
      targetType: 'file' | 'directory' | 'unknown',
      originalLinkItem: FileListItem
    ) => {
      if (!currentSftpManager.value) return;

      if (targetType === 'directory') {
        currentSftpManager.value.loadDirectory(realPath);
      } else if (targetType === 'file') {
        const targetFilename =
          realPath.substring(realPath.lastIndexOf('/') + 1) || originalLinkItem.filename; // Get filename from realPath
        const fileInfo: FileInfo = { name: targetFilename, fullPath: realPath };

        // Preserve mobile multi-select behavior for the original link item
        if (props.isMobile && isMultiSelectMode.value) {
          if (selectedItems.value.has(originalLinkItem.filename)) {
            selectedItems.value.delete(originalLinkItem.filename);
          } else {
            selectedItems.value.add(originalLinkItem.filename);
          }
          return;
        }

        if (settingsStore.showPopupFileEditorBoolean) {
          fileEditorStore.triggerPopup(realPath, props.sessionId);
        }
        if (shareFileEditorTabsBoolean.value) {
          fileEditorStore.openFile(realPath, props.sessionId, props.instanceId);
        } else {
          sessionStore.openFileInSession(props.sessionId, fileInfo);
        }
      } else {
        // targetType is 'unknown' or not provided as expected
        console.warn(
          `[FileManager ${props.sessionId}-${props.instanceId}] Symlink target '${realPath}' has an unknown type from server ('${targetType}'). Defaulting to open as file.`
        );
        // Fallback: attempt to open as file, or display an error
        const targetFilename =
          realPath.substring(realPath.lastIndexOf('/') + 1) || originalLinkItem.filename;
        const fileInfo: FileInfo = { name: targetFilename, fullPath: realPath };
        if (settingsStore.showPopupFileEditorBoolean) {
          fileEditorStore.triggerPopup(realPath, props.sessionId);
        }
        if (shareFileEditorTabsBoolean.value) {
          fileEditorStore.openFile(realPath, props.sessionId, props.instanceId);
        } else {
          sessionStore.openFileInSession(props.sessionId, fileInfo);
        }
      }
    };

    let unregisterSuccess: (() => void) | undefined;
    let unregisterError: (() => void) | undefined;
    let timeoutId: NodeJS.Timeout | number | undefined;

    const cleanupListeners = () => {
      unregisterSuccess?.();
      unregisterError?.();
      if (timeoutId) clearTimeout(timeoutId as any);
      timeoutId = undefined;
    };

    unregisterSuccess = wsOnMessage(
      'sftp:realpath:success',
      (payload: MessagePayload, message: WebSocketMessage) => {
        if (!payload || typeof payload === 'string') return;
        const p = payload as SftpRealpathPayload;
        if (message.requestId === requestId && p.requestedPath === itemPath) {
          cleanupListeners();
          if (!currentSftpManager.value) return;
          // 从 payload 中获取 absolutePath 和 targetType
          const absolutePath = p.absolutePath;
          const targetType = p.targetType as 'file' | 'directory' | 'unknown'; // 类型断言

          if (!absolutePath) {
            console.error(
              `[FileManager ${props.sessionId}-${props.instanceId}] sftp:realpath:success for ${itemPath} missing absolutePath. Payload:`,
              p
            );
            return;
          }
          if (!targetType) {
            console.warn(
              `[FileManager ${props.sessionId}-${props.instanceId}] sftp:realpath:success for ${itemPath} missing targetType. Defaulting to 'file'. Payload:`,
              p
            );
          }

          handleResolvedPath(absolutePath, targetType || 'unknown', item);
        }
      }
    );

    unregisterError = wsOnMessage(
      'sftp:realpath:error',
      (payload: MessagePayload, message: WebSocketMessage) => {
        if (!payload || typeof payload === 'string') return;
        const p = payload as SftpRealpathPayload;
        if (message.requestId === requestId && p?.requestedPath === itemPath) {
          cleanupListeners();
          // payload.error 可能包含来自后端的具体错误信息
          // payload.absolutePath 可能在 stat 失败时仍然存在
          const serverErrorMsg = p.error || 'Unknown error resolving symlink target type';
          const resolvedPathInfo = p.absolutePath ? ` (Resolved path: ${p.absolutePath})` : '';

          console.error(
            `[FileManager ${props.sessionId}-${props.instanceId}] Failed to get realpath or target type for symlink '${itemPath}': ${serverErrorMsg}${resolvedPathInfo}`
          );
        }
      }
    );

    timeoutId = setTimeout(() => {
      cleanupListeners();
      console.error(
        `[FileManager ${props.sessionId}-${props.instanceId}] Timeout getting realpath for symlink '${itemPath}' (ID: ${requestId}).`
      );
    }, 10000); // 10 秒超时
    wsSend({ type: 'sftp:realpath', requestId: requestId, payload: { path: itemPath } });
    return; // Handled by async callbacks
  }

  if (item.attrs.isDirectory) {
    if (currentSftpManager.value.isLoading.value) {
      return;
    }
    const newPath =
      item.filename === '..'
        ? currentSftpManager.value.currentPath.value.substring(
            0,
            currentSftpManager.value.currentPath.value.lastIndexOf('/')
          ) || '/'
        : currentSftpManager.value.joinPath(
            currentSftpManager.value.currentPath.value,
            item.filename
          );
    currentSftpManager.value.loadDirectory(newPath);
  } else if (item.attrs.isFile) {
    // This block now only handles regular files, as symlinks are handled above.
    if (props.isMobile && isMultiSelectMode.value) {
      if (selectedItems.value.has(item.filename)) {
        selectedItems.value.delete(item.filename);
      } else {
        selectedItems.value.add(item.filename);
      }
      return;
    }
    const filePath = itemPath; // itemPath is already calculated
    const fileInfo: FileInfo = { name: item.filename, fullPath: filePath };

    if (settingsStore.showPopupFileEditorBoolean) {
      fileEditorStore.triggerPopup(filePath, props.sessionId);
    }

    if (shareFileEditorTabsBoolean.value) {
      fileEditorStore.openFile(filePath, props.sessionId, props.instanceId);
    } else {
      sessionStore.openFileInSession(props.sessionId, fileInfo);
    }
  }
};

// 切换多选模式 (主要用于移动端)
const toggleMultiSelectMode = () => {
  isMultiSelectMode.value = !isMultiSelectMode.value;
  if (!isMultiSelectMode.value) {
    clearSelection(); // 退出多选模式时清空选择
  }
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Multi-select mode: ${isMultiSelectMode.value ? 'enabled' : 'disabled'}`
  );
};

// 实例化选择 Composable (需要 filteredFileList 和 handleItemAction)
const {
  selectedItems, // 使用 Composable 返回的 selectedItems
  lastClickedIndex, // 获取 lastClickedIndex 以传递给 ContextMenu
  handleItemClick: originalHandleItemClick, // 使用 Composable 返回的 handleItemClick
  handleItemDoubleClick: originalHandleItemDoubleClick,
  clearSelection, // 获取清空选择的方法
} = useFileManagerSelection({
  // 传递当前显示的列表 (已排序和过滤)
  displayedFileList: filteredFileList, // 现在 filteredFileList 已定义
  // 目录保持单击进入；移动端保持原有单击打开/进入行为
  onItemSingleClickAction: (item) => {
    if (
      props.isMobile ||
      item.filename === '..' ||
      item.attrs.isDirectory ||
      fileManagerSingleClickOpenFileBoolean.value
    ) {
      handleItemAction(item);
    }
  },
  // 桌面端非目录项改为双击打开（文件/符号链接等）
  onItemDoubleClickAction: (item) => {
    if (
      !props.isMobile &&
      !fileManagerSingleClickOpenFileBoolean.value &&
      item.filename !== '..' &&
      !item.attrs.isDirectory
    ) {
      handleItemAction(item);
    }
  },
});

// 自定义 handleItemClick 函数以支持移动端多选模式
const handleItemClick = (event: MouseEvent, item: FileListItem, forceMultiSelect = false) => {
  if (item.filename === '..') {
    originalHandleItemClick(event, item);
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
  if (props.isMobile) return;
  originalHandleItemDoubleClick(event, item);
};

// +++ 计算属性：获取选中的完整文件对象列表 +++
const computedSelectedFullItems = computed((): FileListItem[] => {
  if (!selectedItems.value || selectedItems.value.size === 0) {
    return [];
  }
  return filteredFileList.value.filter((item) => selectedItems.value.has(item.filename));
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
      } else if (value) {
        // value exists but is invalid
        // Optionally, re-open modal with error or use a notification
        // For now, just log and close
        console.error(
          `[FileManager ${props.sessionId}-${props.instanceId}] Invalid chmod value from modal: ${value}`
        );
        // It might be better to show an error in the modal itself and not close it.
        // The modal currently has its own validation, so this path might not be hit often.
      }
      break;
    case 'newFile':
      if (value) {
        if (manager.fileList.value.some((item: FileListItem) => item.filename === value)) {
          console.warn(
            `[FileManager ${props.sessionId}-${props.instanceId}] File ${value} already exists. Modal should prevent this.`
          );
          return; // Prevent closing if error
        }
        manager.createFile(value);
      }
      break;
    case 'newFolder':
      if (value) {
        if (manager.fileList.value.some((item: FileListItem) => item.filename === value)) {
          console.warn(
            `[FileManager ${props.sessionId}-${props.instanceId}] Folder ${value} already exists. Modal should prevent this.`
          );
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
    .map((filename) =>
      currentSftpManager.value?.fileList.value.find((f: FileListItem) => f.filename === filename)
    )
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

const handleRenameContextMenuClick = (item: FileListItem) => {
  // item 已有类型
  if (!props.wsDeps.isConnected.value || !item) return; // 恢复使用 props.wsDeps
  if (!currentSftpManager.value) return;
  openActionModal('rename', item, undefined, item.filename);
};

const handleChangePermissionsContextMenuClick = (item: FileListItem) => {
  // item 已有类型
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
const handleCopy = () => {
  if (!currentSftpManager.value || selectedItems.value.size === 0) return;
  const manager = currentSftpManager.value;
  clipboardSourcePaths.value = Array.from(selectedItems.value).map((filename) =>
    manager.joinPath(manager.currentPath.value, filename)
  );
  clipboardState.value = { hasContent: true, operation: 'copy' };
  clipboardSourceBaseDir.value = manager.currentPath.value; // 记录源目录
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Copied to clipboard:`,
    clipboardSourcePaths.value
  );
  // 可选：添加 UI 通知
};

const handleCut = () => {
  if (!currentSftpManager.value || selectedItems.value.size === 0) return;
  const manager = currentSftpManager.value;
  clipboardSourcePaths.value = Array.from(selectedItems.value).map((filename) =>
    manager.joinPath(manager.currentPath.value, filename)
  );
  clipboardState.value = { hasContent: true, operation: 'cut' };
  clipboardSourceBaseDir.value = manager.currentPath.value; // 记录源目录
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Cut to clipboard:`,
    clipboardSourcePaths.value
  );
  // 可选：添加 UI 通知
};

const handlePaste = () => {
  if (
    !currentSftpManager.value ||
    !clipboardState.value.hasContent ||
    clipboardSourcePaths.value.length === 0
  )
    return;
  const manager = currentSftpManager.value;
  const destinationDir = manager.currentPath.value;
  const operation = clipboardState.value.operation;
  const sources = clipboardSourcePaths.value;
  const sourceBaseDir = clipboardSourceBaseDir.value; // 获取源目录

  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Pasting items. Operation: ${operation}, Sources: ${sources.join(', ')}, Destination: ${destinationDir}`
  );

  if (operation === 'copy') {
    // 调用 SFTP 管理器的 copyItems 方法 (稍后添加)
    manager.copyItems(sources, destinationDir);
  } else if (operation === 'cut') {
    // 调用 SFTP 管理器的 moveItems 方法 (稍后添加)
    // 检查是否在同一目录下剪切粘贴（无效操作）
    if (sourceBaseDir === destinationDir) {
      console.warn(
        `[FileManager ${props.sessionId}-${props.instanceId}] Cannot cut and paste in the same directory.`
      );
      // 可选：显示警告通知
      return;
    }
    manager.moveItems(sources, destinationDir);
    // 剪切后清空剪贴板
    clipboardState.value = { hasContent: false };
    clipboardSourcePaths.value = [];
    clipboardSourceBaseDir.value = '';
  }
  // 粘贴后不清空复制的剪贴板，允许重复粘贴
  // 清空选择可能不是最佳体验，用户可能想继续操作粘贴后的文件
  // clearSelection();
};

// --- 文件上传触发器 (定义在此处，供 Composable 使用) ---
const triggerFileUpload = () => {
  fileInputRef.value?.click();
};

// --- 下载触发器 (定义在此处，供 Composable 使用) ---
const triggerDownload = (items: FileListItem[]) => {
  // 修改：接受 FileListItem 数组
  // 恢复使用 props.wsDeps.isConnected
  if (!props.wsDeps.isConnected.value) {
    return;
  }
  // connectionId 仍然从 props 获取
  const currentConnectionId = props.dbConnectionId;
  if (!currentConnectionId) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot download: Missing connection ID.`
    );
    return;
  }
  // 修改：简化检查
  if (!currentSftpManager.value) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot download: SFTP manager is not available.`
    );
    return;
  }

  // 遍历数组中的每个文件项
  items.forEach((item) => {
    // 确保只下载文件
    if (!item.attrs.isFile) {
      console.warn(
        `[FileManager ${props.sessionId}-${props.instanceId}] Skipping download for non-file item: ${item.filename}`
      );
      return;
    }

    const downloadPath = currentSftpManager.value!.joinPath(
      currentSftpManager.value!.currentPath.value,
      item.filename
    );
    const downloadUrl = `/api/v1/sftp/download?connectionId=${currentConnectionId}&remotePath=${encodeURIComponent(downloadPath)}`;
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Triggering download for ${item.filename}: ${downloadUrl}`
    );

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
  if (!props.wsDeps.isConnected.value) {
    return;
  }
  const currentConnectionId = props.dbConnectionId;
  if (!currentConnectionId) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot download directory: Missing connection ID.`
    );
    return;
  }
  if (!currentSftpManager.value) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot download directory: SFTP manager is not available.`
    );
    return;
  }

  // 确保是目录
  if (!item.attrs.isDirectory) {
    console.warn(
      `[FileManager ${props.sessionId}-${props.instanceId}] Skipping directory download for non-directory item: ${item.filename}`
    );
    return;
  }

  const directoryPath = currentSftpManager.value.joinPath(
    currentSftpManager.value.currentPath.value,
    item.filename
  );
  // 定义新的后端 API 端点 URL (稍后实现)
  const downloadUrl = `/api/v1/sftp/download-directory?connectionId=${currentConnectionId}&remotePath=${encodeURIComponent(directoryPath)}`;

  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Attempting directory download for ${item.filename}: ${downloadUrl}`
  );

  // --- 修改：使用 fetch 尝试下载，并处理后端未实现的情况 ---
  fetch(downloadUrl)
    .then(async (response) => {
      if (response.ok) {
        // 后端实现成功，尝试触发下载
        const blob = await response.blob();
        // 从 Content-Disposition 头获取文件名 (需要后端设置)
        const contentDisposition = response.headers.get('content-disposition');
        let filename = `${item.filename}.zip`; // 默认文件名
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
          if (filenameMatch && filenameMatch.length > 1) {
            filename = filenameMatch[1];
          }
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        // --- 修正：移除 ZIP 文件名中的双引号以兼容 Chrome ---
        const safeZipFilename = filename.replace(/"/g, '');
        link.setAttribute('download', safeZipFilename);
        // --- 结束修正 ---
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href); // 释放对象 URL
        console.info(
          `[FileManager ${props.sessionId}-${props.instanceId}] Directory download triggered for: ${filename}`
        );
      } else {
        // 处理错误，例如 404 Not Found
        console.error(
          `[FileManager ${props.sessionId}-${props.instanceId}] Directory download failed: ${response.status} ${response.statusText}`
        );
        // 尝试读取错误信息体
        let errorMsg = `Server responded with status ${response.status}`;
        try {
          const errorData = await response.json(); // 假设后端返回 JSON 错误
          errorMsg = errorData.message || errorMsg;
        } catch (e) {
          // 如果响应体不是 JSON 或读取失败
          try {
            const textError = await response.text();
            if (textError) errorMsg = textError;
          } catch (e2) {
            /* ignore */
          }
        }
      }
    })
    .catch((error) => {
      console.error(
        `[FileManager ${props.sessionId}-${props.instanceId}] Network error during directory download:`,
        error
      );
    });
};

// +++ 压缩/解压处理函数 +++
const handleCompress = (items: FileListItem[], format: CompressFormat) => {
  if (!currentSftpManager.value) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot compress: SFTP manager not available.`
    );
    uiNotificationsStore.showError(t('fileManager.errors.sftpManagerUnavailable'));
    return;
  }
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Requesting compression for ${items.length} items, format: ${format}`
  );
  // 调用 SFTP 管理器上的新方法 (将在 useSftpActions.ts 中实现)
  currentSftpManager.value.compressItems(items, format);
};

const handleDecompress = (item: FileListItem) => {
  if (!currentSftpManager.value) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot decompress: SFTP manager not available.`
    );
    uiNotificationsStore.showError(t('fileManager.errors.sftpManagerUnavailable'));
    return;
  }
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Requesting decompression for item: ${item.filename}`
  );
  // 调用 SFTP 管理器上的新方法 (将在 useSftpActions.ts 中实现)
  currentSftpManager.value.decompressItem(item);
};

// +++ 复制路径到剪贴板 +++
const handleCopyPath = async (item: FileListItem) => {
  if (!currentSftpManager.value) return;
  const fullPath = currentSftpManager.value.joinPath(
    currentSftpManager.value.currentPath.value,
    item.filename
  );
  try {
    await navigator.clipboard.writeText(fullPath);
    // 可选：显示成功通知
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Copied path to clipboard: ${fullPath}`
    );
    uiNotificationsStore.showSuccess(
      t('fileManager.notifications.pathCopied', 'Path copied to clipboard')
    );
  } catch (err) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Failed to copy path: `,
      err
    );
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
  isConnected: props.wsDeps.isConnected,
  isSftpReady: props.wsDeps.isSftpReady,
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
  onDecompressRequest: handleDecompress,
  onCopyPath: handleCopyPath, // +++ 传递复制路径回调 +++
});

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
    return (
      currentSftpManager.value?.joinPath(base, target) ?? `${base}/${target}`.replace(/\/+/g, '/')
    ); // 提供简单的默认实现
  },
  onFileUpload: startFileUpload,
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
  // --- 修正：使用匿名函数包装 startFileUpload 调用 ---
  Array.from(input.files).forEach((file) => startFileUpload(file)); // 只传递 file 参数
  // --- 结束修正 ---
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
  // Enter 保持原有行为：直接触发打开/进入动作
  onEnterPress: (item) => handleItemAction(item),
  scrollTo: scrollToForKeyboardNavigation, // 传递虚拟滚动的 scrollTo 函数（键盘索引 -> 虚拟列表索引）
});

// --- 重置选中索引和清空选择的 Watchers ---
// 修改：监听 manager 的 currentPath
watch(
  () => currentSftpManager.value?.currentPath.value,
  () => {
    selectedIndex.value = -1;
    clearSelection();
  }
);
watch(searchQuery, () => {
  selectedIndex.value = -1;
  clearSelection(); // 清空选择
});
watch(sortKey, () => {
  selectedIndex.value = -1;
  clearSelection(); // 清空选择
});
watch(sortDirection, () => {
  selectedIndex.value = -1;
  clearSelection(); // 清空选择
});

// --- 生命周期钩子 ---
onMounted(() => {
  // --- 移除 onMounted 中的加载逻辑 ---
  // Initial load logic is handled by watchEffect below and the main sftp loading watchEffect
});

// 布局设置同步逻辑已提取至 useFileManagerLayoutSettings composable

// 使用 watchEffect 监听连接和 SFTP 就绪状态以触发初始加载
// 恢复使用 props.wsDeps
watchEffect((onCleanup) => {
  let unregisterSuccess: (() => void) | undefined;
  let unregisterError: (() => void) | undefined;
  let timeoutId: NodeJS.Timeout | number | undefined; // 修正类型以兼容 Node 和浏览器环境

  const cleanupListeners = () => {
    unregisterSuccess?.();
    unregisterError?.();
    if (timeoutId) clearTimeout(timeoutId);
    // isFetchingInitialPath 状态移除
  };

  onCleanup(cleanupListeners);

  // 修改：添加 ?. 访问 isLoading, 检查 manager 的 initialLoadDone
  // 只有在连接就绪、SFTP 就绪、管理器存在、未加载且 initialLoadDone 为 false 时才获取初始路径
  if (
    currentSftpManager.value &&
    props.wsDeps.isConnected.value &&
    props.wsDeps.isSftpReady.value &&
    !currentSftpManager.value.isLoading.value &&
    !currentSftpManager.value.initialLoadDone.value
  ) {
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Connection ready for manager, fetching initial path for the first time (isLoading: ${currentSftpManager.value.isLoading.value}, initialLoadDone: ${currentSftpManager.value.initialLoadDone.value}).`
    );
    // isFetchingInitialPath 状态移除, 使用 isLoading 状态

    // 仍然使用 props.wsDeps 中的 sendMessage 和 onMessage
    const { sendMessage: wsSend, onMessage: wsOnMessage } = props.wsDeps;
    const requestId = generateRequestId(); // 使用本地辅助函数
    const requestedPath = '.';

    unregisterSuccess = wsOnMessage(
      'sftp:realpath:success',
      (payload: MessagePayload, message: WebSocketMessage) => {
        if (!payload || typeof payload === 'string') return;
        const p = payload as SftpRealpathPayload;
        // message 已有类型
        if (message.requestId === requestId && p.requestedPath === requestedPath) {
          // 修改：检查 currentSftpManager 是否存在
          if (!currentSftpManager.value) return;
          const absolutePath = p.absolutePath;
          if (!absolutePath) {
            console.error(
              `[FileManager ${props.sessionId}-${props.instanceId}] Missing absolutePath for initial realpath response.`,
              payload
            );
            cleanupListeners();
            return;
          }
          console.info(
            `[FileManager ${props.sessionId}-${props.instanceId}] Received initial absolute path for '.': ${absolutePath}. Loading directory.`
          );
          // 修改：添加 ?. 访问 loadDirectory 和 setInitialLoadDone
          currentSftpManager.value?.loadDirectory(absolutePath);
          currentSftpManager.value?.setInitialLoadDone(true); // 设置 manager 内部状态
          cleanupListeners();
        }
      }
    );

    unregisterError = wsOnMessage(
      'sftp:realpath:error',
      (payload: MessagePayload, message: WebSocketMessage) => {
        if (!payload || typeof payload === 'string') return;
        const p = payload as SftpRealpathPayload;
        // message 已有类型
        // 修改：使用 payload.requestedPath (如果存在) 或 message.requestId 匹配
        if (message.requestId === requestId && p?.requestedPath === requestedPath) {
          console.error(
            `[FileManager ${props.sessionId}-${props.instanceId}] Failed to get realpath for '${requestedPath}':`,
            payload
          );
          // 获取 realpath 失败时仅记录日志，标记初始加载完成以避免重复尝试
          currentSftpManager.value?.setInitialLoadDone(true);
          cleanupListeners();
        }
      }
    );

    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Sending initial sftp:realpath request (ID: ${requestId}) for path: ${requestedPath}`
    );
    wsSend({ type: 'sftp:realpath', requestId: requestId, payload: { path: requestedPath } });

    timeoutId = setTimeout(() => {
      console.error(
        `[FileManager ${props.sessionId}-${props.instanceId}] Timeout getting initial realpath for '.' (ID: ${requestId}).`
      );
      // 超时也标记初始加载尝试完成
      currentSftpManager.value?.setInitialLoadDone(true);
      cleanupListeners();
    }, 10000); // 10 秒超时
  } else if (
    currentSftpManager.value &&
    props.wsDeps.isConnected.value &&
    props.wsDeps.isSftpReady.value &&
    currentSftpManager.value.initialLoadDone.value
  ) {
    // 连接恢复，并且之前已经加载过 (initialLoadDone is true)
    // 显式地重新加载管理器中记录的当前路径，以防内部状态被重置
    const pathBeforeReconnect = currentSftpManager.value.currentPath.value;
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Connection re-established. Explicitly reloading previous path: ${pathBeforeReconnect}`
    );
    // 检查是否正在加载，避免并发请求
    if (!currentSftpManager.value.isLoading.value) {
      // 使用 false 参数可能表示非强制刷新，如果 SFTP 管理器支持的话
      // 主要目的是确保视图与管理器状态同步到重连前的路径
      currentSftpManager.value.loadDirectory(pathBeforeReconnect, false);
    } else {
      console.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] SFTP manager is currently loading, skipping explicit path reload on reconnect.`
      );
    }
    cleanupListeners(); // 清理可能存在的旧监听器
  } else if (!props.wsDeps.isConnected.value && currentSftpManager.value?.initialLoadDone.value) {
    // 检查 manager 的 initialLoadDone
    // 连接丢失，不需要重置 initialLoadDone，因为我们希望在重连时恢复状态
    // 只需要清理监听器
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Connection lost (was previously loaded).`
    );
    // clearSelection(); // 可以在连接丢失时不清空选择，看产品需求
    // currentSftpManager.value?.setInitialLoadDone(false); // 不再重置，保持状态
    cleanupListeners();
  }
});

// +++ 监听 Store 中的触发器以激活搜索 +++
watch(
  () => focusSwitcherStore.activateFileManagerSearchTrigger,
  (newValue, oldValue) => {
    // 修改监听器
    // 确保只在触发器值增加时执行（避免初始加载或重置时触发）
    // 并且当前组件的 sessionId 与活动 sessionId 匹配
    // 检查 newValue > oldValue 确保是递增触发，避免重复执行
    // 检查是否是当前活动会话的此实例（如果需要区分实例）
    // 目前假设搜索触发器对会话内的所有 FileManager 生效
    if (newValue > (oldValue ?? 0) && props.sessionId === sessionStore.activeSessionId) {
      console.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] Received search activation trigger for active session.`
      );
      activateSearch(); // 调用组件内部的激活搜索方法
    }
  },
  { immediate: false }
); // 添加 immediate: false 避免初始值为 0 时触发

// --- 监听 sessionId prop 的变化 ---
watch(
  () => props.sessionId,
  (newSessionId, oldSessionId) => {
    if (newSessionId && newSessionId !== oldSessionId) {
      cancelPathEdit(); // 关闭路径编辑、历史下拉、并重置 editablePath
      pathHistoryStore.setSearchTerm(''); // 清空搜索词
      // 1. 重新初始化 SFTP 管理器
      initializeSftpManager(newSessionId, props.instanceId);

      // 2. 重置 UI 状态
      clearSelection();
      searchQuery.value = '';
      isSearchActive.value = false;
      sortKey.value = 'filename'; // 重置排序
      sortDirection.value = 'asc';
    }
  },
  { immediate: false }
); // immediate: false 避免初始挂载时触发

// +++ 注册/注销自定义聚焦动作 +++
let unregisterSearchFocusAction: (() => void) | null = null; // 搜索框注销函数
let unregisterPathFocusAction: (() => void) | null = null; // 路径编辑框注销函数

onMounted(() => {
  // 注册搜索框聚焦动作
  const focusSearchActionWrapper = async (): Promise<boolean | undefined> => {
    if (props.sessionId === sessionStore.activeSessionId) {
      console.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] Executing search focus action for active session.`
      );
      closePathHistory(); // Close path history if open
      return focusSearchInput();
    } else {
      console.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] Search focus action skipped for inactive session.`
      );
      return undefined;
    }
  };
  unregisterSearchFocusAction = focusSwitcherStore.registerFocusAction(
    'fileManagerSearch',
    focusSearchActionWrapper
  );

  // 注册路径编辑框聚焦动作
  const focusPathActionWrapper = async (): Promise<boolean | undefined> => {
    if (props.sessionId === sessionStore.activeSessionId) {
      console.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] Executing path edit focus action for active session.`
      );
      // startPathEdit 本身不是 async，但注册时需要包装成 async 以匹配类型
      startPathEdit(); // 调用暴露的方法
      return true;
    } else {
      console.info(
        `[FileManager ${props.sessionId}-${props.instanceId}] Path edit focus action skipped for inactive session.`
      );
      return undefined;
    }
  };
  unregisterPathFocusAction = focusSwitcherStore.registerFocusAction(
    'fileManagerPathInput',
    focusPathActionWrapper
  );
});

onBeforeUnmount(() => {
  // 注销搜索框动作
  if (unregisterSearchFocusAction) {
    unregisterSearchFocusAction();
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Unregistered search focus action on unmount.`
    );
  }
  unregisterSearchFocusAction = null;

  // 注销路径编辑框动作
  if (unregisterPathFocusAction) {
    unregisterPathFocusAction();
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Unregistered path edit focus action on unmount.`
    );
  }
  unregisterPathFocusAction = null;
  cleanupSilentExecRequest();
  isSyncingPathFromTerminal.value = false;
  sessionStore.removeSftpManager(props.sessionId, props.instanceId);
});

// 拖拽蒙版逻辑已移至子组件 FileManagerFileList 内部处理

// --- 列宽调整逻辑已提取至 useFileManagerColumnResize composable ---

// --- 路径编辑逻辑已提取至 useFileManagerPathNavigation composable ---

// --- 搜索框激活/取消逻辑 ---
const activateSearch = () => {
  isSearchActive.value = true;
  nextTick(() => {
    toolbarRef.value?.searchInputRef?.focus();
  });
};

const deactivateSearch = () => {
  isSearchActive.value = false;
};

const cancelSearch = () => {
  searchQuery.value = ''; // 按 Esc 清空并失活
  isSearchActive.value = false;
};

// --- 发送 CD 命令到终端的方法 ---
const sendCdCommandToTerminal = () => {
  if (!currentSftpManager.value || !props.wsDeps.isConnected.value) {
    console.warn(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot send CD command: SFTP manager not ready or not connected.`
    );
    return;
  }
  const currentPath = currentSftpManager.value.currentPath.value;
  if (!currentPath) {
    console.warn(
      `[FileManager ${props.sessionId}-${props.instanceId}] Cannot send CD command: Current path is empty.`
    );
    return;
  }

  // 路径可能包含空格，需要用引号括起来以确保在各种 shell 中正确处理
  const escapedPath = `"${currentPath}"`;
  // 添加换行符以模拟按下 Enter 键执行命令
  const command = `cd ${escapedPath}\n`;

  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Sending command to terminal: ${command.trim()}`
  );
  try {
    // 获取当前活动会话
    const activeSession = sessionStore.activeSession;
    if (!activeSession) {
      console.error(
        `[FileManager ${props.sessionId}-${props.instanceId}] Failed to send command: No active session found.`
      );
      // 可选：添加 UI 通知
      // uiNotificationsStore.addNotification({ message: t('fileManager.errors.noActiveSession', 'No active session found.'), type: 'error' });
      return;
    }
    // 检查 terminalManager 是否存在
    if (!activeSession.terminalManager) {
      console.error(
        `[FileManager ${props.sessionId}-${props.instanceId}] Failed to send command: Terminal manager not found for active session.`
      );
      // 可选：添加 UI 通知
      // uiNotificationsStore.addNotification({ message: t('fileManager.errors.terminalManagerNotFound', 'Terminal manager not found.'), type: 'error' });
      return;
    }
    // 使用 terminalManager 的 sendData 方法发送命令
    activeSession.terminalManager.sendData(command);
  } catch (error) {
    console.error(
      `[FileManager ${props.sessionId}-${props.instanceId}] Failed to send command to terminal:`,
      error
    );
  }
};

const cleanupSilentExecRequest = () => {
  unregisterSilentExecResult?.();
  unregisterSilentExecResult = null;
  unregisterSilentExecError?.();
  unregisterSilentExecError = null;
  unregisterSilentExecDisconnect?.();
  unregisterSilentExecDisconnect = null;
  unregisterSilentExecClosed?.();
  unregisterSilentExecClosed = null;
  unregisterSilentExecSocketError?.();
  unregisterSilentExecSocketError = null;
  if (silentExecTimeoutId) {
    clearTimeout(silentExecTimeoutId);
    silentExecTimeoutId = null;
  }
};

const syncCurrentPathToTerminalDirectory = () => {
  if (
    !currentSftpManager.value ||
    !props.wsDeps.isConnected.value ||
    isSyncingPathFromTerminal.value
  ) {
    return;
  }

  const requestId = generateRequestId();
  const { sendMessage, onMessage } = props.wsDeps;
  const posixPwdCommand = `printf '${SILENT_PWD_PREFIX}%s\\n' "$(pwd 2>/dev/null || /bin/pwd 2>/dev/null || command pwd 2>/dev/null || printf '%s' "$PWD" 2>/dev/null || echo "$PWD" 2>/dev/null)"`;
  const commandsByShell = {
    posix: posixPwdCommand,
    fish: `printf '${SILENT_PWD_PREFIX}%s\\n' (pwd)`,
    powershell: `Write-Output ('${SILENT_PWD_PREFIX}' + (Get-Location).Path)`,
    cmd: `echo ${SILENT_PWD_PREFIX}%cd%`,
    default: posixPwdCommand,
  };

  isSyncingPathFromTerminal.value = true;
  cleanupSilentExecRequest();

  const finishWithError = (message: string) => {
    cleanupSilentExecRequest();
    isSyncingPathFromTerminal.value = false;
    uiNotificationsStore.showError(message);
  };

  const finishSilentlyOnDisconnect = () => {
    cleanupSilentExecRequest();
    isSyncingPathFromTerminal.value = false;
  };

  unregisterSilentExecResult = onMessage(
    'ssh:exec_silent:result',
    (payload: MessagePayload, message: WebSocketMessage) => {
      const p = payload as unknown as SilentExecPayload;
      if (message.requestId !== requestId) return;

      cleanupSilentExecRequest();
      isSyncingPathFromTerminal.value = false;

      const output = typeof p?.output === 'string' ? p.output : '';
      const path = parsePathFromSilentOutput(output);

      if (!path) {
        uiNotificationsStore.showError(t('fileManager.errors.pathReadFailed', '读取终端路径失败'));
        return;
      }

      currentSftpManager.value?.loadDirectory(path);
    }
  );

  unregisterSilentExecError = onMessage(
    'ssh:exec_silent:error',
    (payload: MessagePayload, message: WebSocketMessage) => {
      const p = payload as unknown as SilentExecPayload;
      if (message.requestId !== requestId) return;
      const errorMessage =
        typeof p?.error === 'string'
          ? p.error
          : t('fileManager.errors.pathReadFailed', '读取终端路径失败');
      finishWithError(errorMessage);
    }
  );

  unregisterSilentExecDisconnect = onMessage('ssh:disconnected', () => {
    finishSilentlyOnDisconnect();
  });

  unregisterSilentExecClosed = onMessage('internal:closed', () => {
    finishSilentlyOnDisconnect();
  });

  unregisterSilentExecSocketError = onMessage('internal:error', () => {
    finishSilentlyOnDisconnect();
  });

  silentExecTimeoutId = setTimeout(() => {
    finishWithError(t('fileManager.errors.pathReadTimeout', '读取终端路径超时'));
  }, 6000);

  sendMessage({
    type: 'ssh:exec_silent',
    requestId,
    payload: {
      commandsByShell,
      timeoutMs: 5000,
      successCriteria: 'absolute_path',
      suppressTerminalPrompt: true,
    },
  });
};

// --- 打开弹窗编辑器的方法 ---
const openPopupEditor = () => {
  if (!props.sessionId) {
    console.error('[FileManager] Cannot open popup editor: Missing session ID.');
    // 可以添加 UI 通知
    return;
  }
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Triggering popup editor without specific file.`
  );
  fileEditorStore.triggerPopup('', props.sessionId); // 修复：使用空字符串触发空编辑器
};
// --- 行大小调整逻辑已提取至 useFileManagerLayoutSettings composable ---

// +++ 聚焦搜索框的方法 +++
const focusSearchInput = (): boolean => {
  // 检查当前会话是否激活，防止后台实例响应
  if (props.sessionId !== sessionStore.activeSessionId) {
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Ignoring focus request for inactive session.`
    );
    return false;
  }

  if (!isSearchActive.value) {
    activateSearch(); // Activate search first
    // nextTick 确保 DOM 更新后再聚焦
    nextTick(() => {
      if (toolbarRef.value?.searchInputRef) {
        toolbarRef.value.searchInputRef.focus();
        console.info(
          `[FileManager ${props.sessionId}-${props.instanceId}] Search activated and input focused.`
        );
      } else {
        console.warn(
          `[FileManager ${props.sessionId}-${props.instanceId}] Search activated but input ref not found after nextTick.`
        );
      }
    });
    return true; // 假设会成功
  } else if (toolbarRef.value?.searchInputRef) {
    toolbarRef.value.searchInputRef.focus();
    console.info(
      `[FileManager ${props.sessionId}-${props.instanceId}] Search already active, input focused.`
    );
    return true;
  }
  console.warn(
    `[FileManager ${props.sessionId}-${props.instanceId}] Could not focus search input.`
  );
  return false;
};
// --- 工具栏关闭路径历史回调 ---
const handleClosePathHistoryFromToolbar = () => {
  cancelPathEdit();
};

// --- 返回上级目录（供工具栏使用）---
const handleGoToParent = () => {
  if (!currentSftpManager.value || currentSftpManager.value.isLoading.value) return;
  const currentPath = currentSftpManager.value.currentPath.value;
  if (currentPath === '/') return;
  handleItemClick({} as MouseEvent, {
    filename: '..',
    longname: '..',
    attrs: {
      isDirectory: true,
      isFile: false,
      isSymbolicLink: false,
      size: 0,
      uid: 0,
      gid: 0,
      mode: 0,
      atime: 0,
      mtime: 0,
    },
  });
};

defineExpose({ focusSearchInput, startPathEdit });

// --- 处理'打开编辑器'按钮点击 ---
const handleOpenEditorClick = () => {
  if (!props.sessionId) {
    console.error(`[FileManager ${props.instanceId}] Cannot open editor: Missing session ID.`);
    uiNotificationsStore.showError(t('fileManager.errors.missingSessionId'));
    return;
  }
  console.info(
    `[FileManager ${props.sessionId}-${props.instanceId}] Triggering popup editor directly.`
  );
  fileEditorStore.triggerPopup('', props.sessionId); // 修复：传递空字符串而不是 null
};

// +++ 收藏路径导航（走路径导航 composable，记录历史）+++
const handleNavigateToPathFromFavorites = (path: string) => {
  navigateToPath(path);
};
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden bg-background text-foreground text-sm font-sans">
    <!-- 隐藏的文件选择输入框，由 triggerFileUpload 触发 -->
    <input ref="fileInputRef" type="file" multiple class="hidden" @change="handleFileSelected" />
    <FileManagerToolbar
      ref="toolbarRef"
      :current-path="currentSftpManager?.currentPath?.value ?? '/'"
      :is-editing-path="isEditingPath"
      :editable-path="editablePath"
      :search-query="searchQuery"
      :is-search-active="isSearchActive"
      :is-mobile="props.isMobile"
      :is-connected="!!currentSftpManager && props.wsDeps.isConnected.value"
      :is-loading="!currentSftpManager || currentSftpManager.isLoading.value"
      :is-syncing-from-terminal="isSyncingPathFromTerminal"
      :is-at-root="currentSftpManager?.currentPath?.value === '/'"
      :show-popup-editor="showPopupFileEditorBoolean"
      :is-multi-select-mode="isMultiSelectMode"
      :show-path-history-dropdown="showPathHistoryDropdown"
      :path-selected-index="pathSelectedIndex"
      :filtered-path-history="filteredPathHistory"
      @cd-to-terminal="sendCdCommandToTerminal"
      @sync-from-terminal="syncCurrentPathToTerminalDirectory"
      @refresh="
        currentSftpManager?.loadDirectory(currentSftpManager?.currentPath?.value ?? '/', true)
      "
      @go-to-parent="handleGoToParent"
      @activate-search="activateSearch"
      @deactivate-search="deactivateSearch"
      @cancel-search="cancelSearch"
      @update:search-query="
        (v: string) => {
          searchQuery = v;
        }
      "
      @update:editable-path="
        (v: string) => {
          editablePath = v;
          pathHistoryStore.setSearchTerm(v);
        }
      "
      @start-path-edit="startPathEdit"
      @path-input-focus="handlePathInputFocus"
      @path-input-keydown="handlePathInputKeydown"
      @path-selected="handlePathSelectedFromDropdown"
      @close-path-history="handleClosePathHistoryFromToolbar"
      @navigate-to-favorite="handleNavigateToPathFromFavorites"
      @open-popup-editor="openPopupEditor"
      @trigger-file-upload="triggerFileUpload"
      @new-folder="handleNewFolderContextMenuClick"
      @new-file="handleNewFileContextMenuClick"
      @toggle-multi-select="toggleMultiSelectMode"
      @search-keydown="handleKeydown"
    />
    <!-- 文件列表子组件 -->
    <FileManagerFileList
      ref="fileListRef"
      :files="filteredFileList"
      :has-parent-link="currentSftpManager ? currentSftpManager.currentPath.value !== '/' : false"
      :sort-key="sortKey"
      :sort-direction="sortDirection"
      :selected-items="selectedItems"
      :selected-index="selectedIndex"
      :is-mobile="props.isMobile"
      :col-widths="colWidths"
      :row-size-multiplier="rowSizeMultiplier"
      :is-loading="!currentSftpManager || currentSftpManager.isLoading.value"
      :search-query="searchQuery"
      :is-multi-select-mode="isMultiSelectMode"
      :show-external-drop-overlay="showExternalDropOverlay"
      :drag-over-target="dragOverTarget"
      @sort="handleSort"
      @item-click="handleItemClick"
      @item-double-click="handleItemDoubleClick"
      @context-menu="showContextMenu"
      @start-resize="startResize"
      @drag-enter="handleDragEnter"
      @drag-over="handleDragOver"
      @drag-leave="handleDragLeave"
      @drop="handleDrop"
      @overlay-drop="handleOverlayDrop"
      @drag-start="handleDragStart"
      @drag-end="handleDragEnd"
      @drag-over-row="handleDragOverRow"
      @drag-leave-row="handleDragLeaveRow"
      @drop-on-row="handleDropOnRow"
      @wheel="handleWheel"
      @keydown="handleKeydown"
    />

    <!-- 使用 FileUploadPopup 组件 -->
    <FileUploadPopup :uploads="uploads" @cancel-upload="cancelUpload" />

    <FileManagerContextMenu
      ref="contextMenuRef"
      :is-visible="contextMenuVisible"
      :position="contextMenuPosition"
      :items="contextMenuItems"
      :active-context-item="contextTargetItem"
      :selected-file-items="computedSelectedFullItems"
      :current-directory-path="currentSftpManager?.currentPath?.value ?? '/'"
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

    <!-- Favorite Paths Modal is now positioned near its button -->
  </div>
</template>

<style scoped>
/* Scoped styles removed for Tailwind CSS refactoring */
</style>
