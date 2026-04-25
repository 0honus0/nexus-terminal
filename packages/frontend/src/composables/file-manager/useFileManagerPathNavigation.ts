/**
 * 文件管理器路径编辑与导航逻辑
 * 从 FileManager.vue 提取，负责路径输入、历史记录下拉、路径导航
 */

import { ref, nextTick, type Ref, type ComputedRef } from 'vue';
import { usePathHistoryStore } from '../../stores/pathHistory.store';

type PathHistoryStore = ReturnType<typeof usePathHistoryStore>;

type SftpManagerInstance = {
  currentPath: Ref<string>;
  isLoading: Ref<boolean>;
  loadDirectory: (path: string) => void;
};

export interface UseFileManagerPathNavigationOptions {
  /** SFTP 管理器实例（响应式） */
  currentSftpManager: ComputedRef<SftpManagerInstance | null>;
  /** WebSocket 连接状态 */
  isConnected: ComputedRef<boolean>;
  /** 路径历史 Store */
  pathHistoryStore: PathHistoryStore;
  /** 路径输入框引用（用于聚焦和选中） */
  pathInputRef: Ref<HTMLInputElement | null>;
  /** 日志前缀 */
  logPrefix?: string;
}

export interface UseFileManagerPathNavigationReturn {
  /** 是否正在编辑路径 */
  isEditingPath: Ref<boolean>;
  /** 可编辑的路径值 */
  editablePath: Ref<string>;
  /** 是否显示路径历史下拉框 */
  showPathHistoryDropdown: Ref<boolean>;
  /** 开始路径编辑 */
  startPathEdit: () => void;
  /** 取消路径编辑 */
  cancelPathEdit: () => void;
  /** 路径输入框获得焦点 */
  handlePathInputFocus: () => void;
  /** 路径输入变化 */
  handlePathInputChange: () => void;
  /** 路径输入框键盘事件 */
  handlePathInputKeydown: (event: KeyboardEvent) => void;
  /** 从下拉框选择路径 */
  handlePathSelectedFromDropdown: (path: string) => void;
  /** 导航到指定路径 */
  navigateToPath: (path: string) => Promise<void>;
  /** 关闭路径历史 */
  closePathHistory: () => void;
}

export const useFileManagerPathNavigation = (
  options: UseFileManagerPathNavigationOptions
): UseFileManagerPathNavigationReturn => {
  const {
    currentSftpManager,
    isConnected,
    pathHistoryStore,
    pathInputRef,
    logPrefix = '[FileManager]',
  } = options;

  const isEditingPath = ref(false);
  const editablePath = ref('');
  const showPathHistoryDropdown = ref(false);

  const openPathHistory = () => {
    showPathHistoryDropdown.value = true;
    if (pathHistoryStore.historyList.length === 0) {
      pathHistoryStore.fetchHistory();
    }
    pathHistoryStore.setSearchTerm(editablePath.value);
  };

  const closePathHistory = () => {
    showPathHistoryDropdown.value = false;
    pathHistoryStore.resetSelection();
  };

  const handlePathInputFocus = () => {
    isEditingPath.value = true;
    const manager = currentSftpManager.value;
    if (!manager || manager.isLoading.value || !isConnected.value) return;
    editablePath.value = manager.currentPath.value;
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
    const manager = currentSftpManager.value;
    if (!manager || !path || path.trim().length === 0) return;
    const trimmedPath = path.trim();
    isEditingPath.value = false;
    closePathHistory();

    if (trimmedPath === manager.currentPath.value) return;

    console.info(`${logPrefix} 尝试导航到新路径: ${trimmedPath}`);
    try {
      await manager.loadDirectory(trimmedPath);
      pathHistoryStore.addPath(trimmedPath);
      editablePath.value = trimmedPath;
    } catch (error) {
      console.error(`${logPrefix} 导航到路径 ${trimmedPath} 失败:`, error);
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
        break;
      case 'ArrowUp':
        event.preventDefault();
        pathHistoryStore.selectPreviousPath();
        break;
      case 'Enter': {
        event.preventDefault();
        const selectedIdx = pathHistoryStore.selectedIndex;
        const history = pathHistoryStore.filteredHistory;
        if (selectedIdx >= 0 && history[selectedIdx]) {
          navigateToPath(history[selectedIdx].path);
        } else {
          navigateToPath(editablePath.value);
        }
        closePathHistory();
        break;
      }
      case 'Escape':
        event.preventDefault();
        closePathHistory();
        break;
    }
  };

  const handlePathSelectedFromDropdown = (path: string) => {
    editablePath.value = path;
    navigateToPath(path);
    closePathHistory();
  };

  const startPathEdit = () => {
    const manager = currentSftpManager.value;
    if (!manager || manager.isLoading.value || !isConnected.value) return;
    editablePath.value = manager.currentPath.value;
    isEditingPath.value = true;
    openPathHistory();
    nextTick(() => {
      pathInputRef.value?.focus();
      pathInputRef.value?.select();
    });
  };

  const cancelPathEdit = () => {
    isEditingPath.value = false;
    closePathHistory();
    const manager = currentSftpManager.value;
    if (manager) {
      editablePath.value = manager.currentPath.value;
    }
  };

  return {
    isEditingPath,
    editablePath,
    showPathHistoryDropdown,
    startPathEdit,
    cancelPathEdit,
    handlePathInputFocus,
    handlePathInputChange,
    handlePathInputKeydown,
    handlePathSelectedFromDropdown,
    navigateToPath,
    closePathHistory,
  };
};
