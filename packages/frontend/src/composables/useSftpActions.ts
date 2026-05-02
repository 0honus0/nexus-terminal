import { ref, reactive, computed, type Ref, type ComputedRef } from 'vue';
import type {
  FileListItem,
  FileAttributes,
  SftpReadFileSuccessPayload,
  SftpReadFileRequestPayload,
} from '../types/sftp.types';
import type { WebSocketMessage, MessagePayload, MessageHandler } from '../types/websocket.types';

import { useUiNotificationsStore } from '../stores/uiNotifications.store';
import {
  findNodeByPath,
  removeNodeFromTree,
  addOrUpdateNodeInTree,
  sortFiles,
} from './useSftpTreeUtils';
import { createMessageHandlers } from './useSftpMessageHandlers';

/**
 * @interface WebSocketDependencies
 * @description Defines the necessary functions and state required from a WebSocket manager instance.
 */
export interface WebSocketDependencies {
  sendMessage: (message: WebSocketMessage) => void;
  onMessage: (type: string, handler: MessageHandler) => () => void;
  isConnected: ComputedRef<boolean>;
  isSftpReady: Readonly<Ref<boolean>>;
}

/**
 * @interface SftpManagerInstance
 * @description Defines the shape of the object returned by createSftpActionsManager.
 */
export interface SftpManagerInstance {
  // State
  fileList: Readonly<ComputedRef<FileListItem[]>>;
  isLoading: Readonly<Ref<boolean>>;
  fileTree: Readonly<FileTreeNode>;
  initialLoadDone: Readonly<Ref<boolean>>;
  currentPath: Readonly<Ref<string>>;

  // Methods
  loadDirectory: (path: string, forceRefresh?: boolean) => void;
  createDirectory: (newDirName: string) => void;
  createFile: (newFileName: string) => void;
  deleteItems: (items: FileListItem[]) => void;
  renameItem: (item: FileListItem, newName: string) => void;
  changePermissions: (item: FileListItem, mode: number) => void;
  readFile: (path: string, encoding?: string) => Promise<SftpReadFileSuccessPayload>;
  writeFile: (path: string, content: string, encoding?: string) => Promise<void>;
  copyItems: (sourcePaths: string[], destinationDir: string) => void;
  moveItems: (sourcePaths: string[], destinationDir: string) => void;
  compressItems: (items: FileListItem[], format: 'zip' | 'targz' | 'tarbz2') => Promise<void>;
  decompressItem: (item: FileListItem) => Promise<void>;
  joinPath: (base: string, name: string) => string;
  setInitialLoadDone: (value: boolean) => void;

  // Cleanup function
  cleanup: () => void;
}

// Helper function
const generateRequestId = (): string =>
  `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Helper function
const joinPath = (base: string, name: string): string => {
  if (base === '/') return `/${name}`;
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
};

// *** 文件树节点接口 ***
export interface FileTreeNode {
  filename: string;
  longname: string;
  attrs: FileAttributes;
  children: FileTreeNode[] | null;
  childrenLoaded: boolean;
}

/**
 * 创建并管理单个 SFTP 会话的操作。
 * 每个实例对应一个会话 (Session) 并依赖于一个 WebSocket 管理器实例。
 */
export function createSftpActionsManager(
  sessionId: string,
  currentPathRef: Ref<string>,
  wsDeps: WebSocketDependencies,
  t: Function
): SftpManagerInstance {
  const { sendMessage, onMessage, isSftpReady } = wsDeps;

  const isLoading = ref<boolean>(false);
  const loadingRequestId = ref<string | null>(null);
  const instanceSessionId = sessionId;
  const uiNotificationsStore = useUiNotificationsStore();
  const initialLoadDone = ref<boolean>(false);

  const unregisterCallbacks: (() => void)[] = [];

  // *** 响应式文件树 ***
  const fileTree = reactive<FileTreeNode>({
    filename: '/',
    longname: '/',
    attrs: {
      isDirectory: true,
      isFile: false,
      isSymbolicLink: false,
      size: 0,
      mtime: 0,
      atime: 0,
      uid: 0,
      gid: 0,
      mode: 0o755,
    },
    children: null,
    childrenLoaded: false,
  });

  const cleanup = () => {
    console.info(`[SFTP ${instanceSessionId}] Cleaning up message handlers.`);
    unregisterCallbacks.forEach((cb) => cb());
    unregisterCallbacks.length = 0;
  };

  // --- Action Methods ---

  const loadDirectory = (path: string, forceRefresh: boolean = false) => {
    const targetNode = findNodeByPath(fileTree, path, instanceSessionId);

    if (targetNode && targetNode.childrenLoaded && !forceRefresh) {
      console.info(`[SFTP ${instanceSessionId}] 使用文件树缓存加载目录: ${path}`);
      isLoading.value = false;
      currentPathRef.value = path;
      return;
    }

    if (forceRefresh && targetNode) {
      console.info(`[SFTP ${instanceSessionId}] 强制刷新，重置节点 ${path} 的 childrenLoaded 状态`);
      targetNode.childrenLoaded = false;
    }

    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      isLoading.value = false;
      console.warn(`[SFTP ${instanceSessionId}] 尝试加载目录 ${path} 但 SFTP 未就绪。`);
      return;
    }
    if (isLoading.value) {
      console.warn(`[SFTP ${instanceSessionId}] 尝试加载目录 ${path} 但已在加载中。`);
      return;
    }

    console.info(`[SFTP ${instanceSessionId}] ${forceRefresh ? '强制' : ''}加载目录: ${path}`);
    isLoading.value = true;
    const requestId = generateRequestId();
    loadingRequestId.value = requestId;
    sendMessage({ type: 'sftp:readdir', requestId, payload: { path } });
  };

  // --- 防抖刷新：合并短时间内的多次 loadDirectory 请求 ---
  const _pendingRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduleDirectoryRefresh = (path: string, delay = 150) => {
    const existing = _pendingRefreshTimers.get(path);
    if (existing) clearTimeout(existing);
    _pendingRefreshTimers.set(
      path,
      setTimeout(() => {
        _pendingRefreshTimers.delete(path);
        if (currentPathRef.value === path && !isLoading.value) {
          loadDirectory(path, true);
        }
      }, delay)
    );
  };

  const createDirectory = (newDirName: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试创建目录 ${newDirName} 但 SFTP 未就绪。`);
      return;
    }
    const newFolderPath = joinPath(currentPathRef.value, newDirName);
    const requestId = generateRequestId();
    sendMessage({ type: 'sftp:mkdir', requestId, payload: { path: newFolderPath } });
  };

  const createFile = (newFileName: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试创建文件 ${newFileName} 但 SFTP 未就绪。`);
      return;
    }
    const newFilePath = joinPath(currentPathRef.value, newFileName);
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:writefile',
      requestId,
      payload: { path: newFilePath, content: '', encoding: 'utf8' },
    });
  };

  const deleteItems = (items: FileListItem[]) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试删除项目但 SFTP 未就绪。`);
      return;
    }
    if (items.length === 0) return;
    items.forEach((item) => {
      const targetPath = joinPath(currentPathRef.value, item.filename);
      const actionType = item.attrs.isDirectory ? 'sftp:rmdir' : 'sftp:unlink';
      const requestId = generateRequestId();
      sendMessage({ type: actionType, requestId, payload: { path: targetPath } });
    });
  };

  const renameItem = (item: FileListItem, newName: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试重命名项目 ${item.filename} 但 SFTP 未就绪。`);
      return;
    }
    if (!newName || item.filename === newName) return;
    const oldPath = joinPath(currentPathRef.value, item.filename);
    const newPath = newName.startsWith('/') ? newName : joinPath(currentPathRef.value, newName);
    const requestId = generateRequestId();
    sendMessage({ type: 'sftp:rename', requestId, payload: { oldPath, newPath } });
  };

  const changePermissions = (item: FileListItem, mode: number) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试修改 ${item.filename} 的权限但 SFTP 未就绪。`);
      return;
    }
    const targetPath = joinPath(currentPathRef.value, item.filename);
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:chmod',
      requestId,
      payload: { path: targetPath, mode },
    });
  };

  const readFile = (path: string, encoding?: string): Promise<SftpReadFileSuccessPayload> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        console.warn(`[SFTP ${instanceSessionId}] 尝试读取文件 ${path} 但 SFTP 未就绪。`);
        uiNotificationsStore.showError(errMsg);
        return reject(new Error(errMsg));
      }
      const requestId = generateRequestId();
      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        unregisterSuccess?.();
        unregisterError?.();
        const errMsg = t('fileManager.errors.readFileTimeout');
        uiNotificationsStore.showError(errMsg);
        reject(new Error(errMsg));
      }, 20000);

      unregisterSuccess = onMessage(
        'sftp:readfile:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const successPayload = payload as unknown as SftpReadFileSuccessPayload;
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            resolve({
              rawContentBase64: successPayload.rawContentBase64,
              encodingUsed: successPayload.encodingUsed,
            });
          }
        }
      );

      unregisterError = onMessage(
        'sftp:readfile:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as string;
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            const errorMsg = errorPayload || t('fileManager.errors.readFileFailed');
            uiNotificationsStore.showError(`${t('fileManager.errors.readFileError')}: ${errorMsg}`);
            reject(new Error(errorMsg));
          }
        }
      );

      const requestPayload: SftpReadFileRequestPayload = { path };
      if (encoding) {
        requestPayload.encoding = encoding;
      }
      sendMessage({ type: 'sftp:readfile', requestId, payload: requestPayload });
    });
  };

  const writeFile = (path: string, content: string, encoding?: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        console.warn(`[SFTP ${instanceSessionId}] 尝试写入文件 ${path} 但 SFTP 未就绪。`);
        uiNotificationsStore.showError(errMsg);
        return reject(new Error(errMsg));
      }
      const requestId = generateRequestId();
      const finalEncoding = encoding || 'utf8';
      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        unregisterSuccess?.();
        unregisterError?.();
        const errMsg = t('fileManager.errors.saveTimeout');
        uiNotificationsStore.showError(errMsg);
        reject(new Error(errMsg));
      }, 20000);

      unregisterSuccess = onMessage(
        'sftp:writefile:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            resolve();
          }
        }
      );

      unregisterError = onMessage(
        'sftp:writefile:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as string;
          if (message.requestId === requestId && message.path === path) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            const errorMsg = errorPayload || t('fileManager.errors.saveFailed');
            uiNotificationsStore.showError(errorMsg);
            reject(new Error(errorMsg));
          }
        }
      );

      sendMessage({
        type: 'sftp:writefile',
        requestId,
        payload: { path, content, encoding: finalEncoding },
      });
    });
  };

  const copyItems = (sourcePaths: string[], destinationDir: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试复制项目但 SFTP 未就绪。`);
      return;
    }
    if (sourcePaths.length === 0) return;
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:copy',
      requestId,
      payload: { sources: sourcePaths, destination: destinationDir },
    });
    console.info(
      `[SFTP ${instanceSessionId}] 发送 sftp:copy 请求 (ID: ${requestId}) Sources: ${sourcePaths.join(', ')}, Dest: ${destinationDir}`
    );
  };

  const moveItems = (sourcePaths: string[], destinationDir: string) => {
    if (!isSftpReady.value) {
      uiNotificationsStore.showError(t('fileManager.errors.sftpNotReady'));
      console.warn(`[SFTP ${instanceSessionId}] 尝试移动项目但 SFTP 未就绪。`);
      return;
    }
    if (sourcePaths.length === 0) return;
    const requestId = generateRequestId();
    sendMessage({
      type: 'sftp:move',
      requestId,
      payload: { sources: sourcePaths, destination: destinationDir },
    });
    console.info(
      `[SFTP ${instanceSessionId}] 发送 sftp:move 请求 (ID: ${requestId}) Sources: ${sourcePaths.join(', ')}, Dest: ${destinationDir}`
    );
  };

  const compressItems = (
    items: FileListItem[],
    format: 'zip' | 'targz' | 'tarbz2'
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        uiNotificationsStore.showError(errMsg);
        console.warn(`[SFTP ${instanceSessionId}] 尝试压缩项目但 SFTP 未就绪。`);
        return reject(new Error(errMsg));
      }
      const sourcePaths = items.map((item) => joinPath(currentPathRef.value, item.filename));
      const requestId = generateRequestId();
      const parentDir = currentPathRef.value;
      let archiveBaseName = 'archive';
      if (items.length === 1) {
        archiveBaseName = items[0].filename.split('.')[0];
      } else if (items.length > 1) {
        const parentFolderName = parentDir.split('/').pop();
        if (parentFolderName && parentFolderName !== 'root' && parentFolderName !== '') {
          archiveBaseName = parentFolderName;
        }
      }
      let archiveExtension: string = format;
      if (format === 'targz') {
        archiveExtension = 'tar.gz';
      } else if (format === 'tarbz2') {
        archiveExtension = 'tar.bz2';
      }
      const archiveName = `${archiveBaseName}.${archiveExtension}`;
      const destinationPath = joinPath(parentDir, archiveName);

      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        unregisterSuccess?.();
        unregisterError?.();
        const errMsg = t('fileManager.errors.compressTimeout');
        uiNotificationsStore.showError(errMsg);
        reject(new Error(errMsg));
      }, 60000);

      unregisterSuccess = onMessage(
        'sftp:compress:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            uiNotificationsStore.showSuccess(
              t('fileManager.notifications.compressSuccess', { name: archiveName })
            );
            loadDirectory(currentPathRef.value, true);
            resolve();
          }
        }
      );

      unregisterError = onMessage(
        'sftp:compress:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as { error: string; details?: string };
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            const errorMsg =
              errorPayload.details || errorPayload.error || t('fileManager.errors.compressFailed');
            uiNotificationsStore.showError(
              t('fileManager.errors.compressErrorDetailed', { error: errorMsg })
            );
            reject(new Error(errorMsg));
          }
        }
      );

      console.info(
        `[SFTP ${instanceSessionId}] 发送 sftp:compress 请求 (ID: ${requestId}) Sources: ${sourcePaths.join(', ')}, Dest: ${destinationPath}, Format: ${format}`
      );
      sendMessage({
        type: 'sftp:compress',
        requestId,
        payload: { sources: sourcePaths, destination: destinationPath, format },
      });
    });
  };

  const decompressItem = (item: FileListItem): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!isSftpReady.value) {
        const errMsg = t('fileManager.errors.sftpNotReady');
        uiNotificationsStore.showError(errMsg);
        console.warn(`[SFTP ${instanceSessionId}] 尝试解压项目 ${item.filename} 但 SFTP 未就绪。`);
        return reject(new Error(errMsg));
      }
      const sourcePath = joinPath(currentPathRef.value, item.filename);
      const destinationDir = currentPathRef.value;
      const requestId = generateRequestId();

      let unregisterSuccess: (() => void) | null = null;
      let unregisterError: (() => void) | null = null;

      const timeoutId = setTimeout(() => {
        unregisterSuccess?.();
        unregisterError?.();
        const errMsg = t('fileManager.errors.decompressTimeout');
        uiNotificationsStore.showError(errMsg);
        reject(new Error(errMsg));
      }, 60000);

      unregisterSuccess = onMessage(
        'sftp:decompress:success',
        (payload: MessagePayload, message: WebSocketMessage) => {
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            uiNotificationsStore.showSuccess(
              t('fileManager.notifications.decompressSuccess', { name: item.filename })
            );
            loadDirectory(currentPathRef.value, true);
            resolve();
          }
        }
      );

      unregisterError = onMessage(
        'sftp:decompress:error',
        (payload: MessagePayload, message: WebSocketMessage) => {
          const errorPayload = payload as unknown as { error: string; details?: string };
          if (message.requestId === requestId) {
            clearTimeout(timeoutId);
            unregisterSuccess?.();
            unregisterError?.();
            const errorMsg =
              errorPayload.details ||
              errorPayload.error ||
              t('fileManager.errors.decompressFailed');
            uiNotificationsStore.showError(
              t('fileManager.errors.decompressErrorDetailed', { error: errorMsg })
            );
            reject(new Error(errorMsg));
          }
        }
      );

      console.info(
        `[SFTP ${instanceSessionId}] 发送 sftp:decompress 请求 (ID: ${requestId}) Source: ${sourcePath}, Dest: ${destinationDir}`
      );
      sendMessage({
        type: 'sftp:decompress',
        requestId,
        payload: { source: sourcePath, destination: destinationDir },
      });
    });
  };

  // --- Message Handlers (委托给子模块) ---
  const { registrations } = createMessageHandlers({
    fileTree,
    currentPathRef,
    instanceSessionId,
    isLoading,
    loadingRequestId,
    uiNotificationsStore,
    t,
    loadDirectory,
    scheduleDirectoryRefresh,
  });

  // 注册所有消息处理器
  for (const { type, handler } of registrations) {
    unregisterCallbacks.push(onMessage(type, handler));
  }

  // *** 计算属性 fileList ***
  const fileList = computed<FileListItem[]>(() => {
    const node = findNodeByPath(fileTree, currentPathRef.value, instanceSessionId);
    if (node && node.childrenLoaded && node.children) {
      return node.children.map((child) => ({
        filename: child.filename,
        longname: child.longname,
        attrs: child.attrs,
      }));
    }
    return [];
  });

  return {
    fileList,
    isLoading,
    fileTree,
    initialLoadDone,
    loadDirectory,
    createDirectory,
    createFile,
    deleteItems,
    renameItem,
    changePermissions,
    readFile,
    writeFile,
    copyItems,
    moveItems,
    compressItems,
    decompressItem,
    joinPath,
    currentPath: currentPathRef,
    setInitialLoadDone: (value: boolean) => {
      initialLoadDone.value = value;
    },
    cleanup,
  };
}
