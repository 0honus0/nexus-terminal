import { ref, type Ref } from 'vue';
import type { FileListItem } from '../../types/sftp.types'; // 确保路径正确

// 定义 Composable 的输入参数类型
export interface UseFileManagerSelectionOptions {
  // 注意：这里传入的应该是当前渲染在表格中的列表 (可能已排序/过滤)
  // 在 FileManager.vue 中，这通常是 filteredFileList 或 sortedFileList
  displayedFileList: Ref<Readonly<FileListItem[]>>;
  // 回调函数：普通单击时触发（例如目录单击进入）
  onItemSingleClickAction?: (item: FileListItem) => void;
  // 回调函数：双击时触发（例如文件双击打开）
  onItemDoubleClickAction?: (item: FileListItem) => void;
}

export function useFileManagerSelection(options: UseFileManagerSelectionOptions) {
  const { displayedFileList, onItemSingleClickAction, onItemDoubleClickAction } = options;

  const selectedItems = ref(new Set<string>());
  const lastClickedIndex = ref(-1); // 索引相对于 displayedFileList

  const findItemIndex = (item: FileListItem) =>
    displayedFileList.value.findIndex((f) => f.filename === item.filename);

  const updateSelectionToSingleItem = (item: FileListItem, itemIndex: number) => {
    selectedItems.value.clear();
    if (item.filename === '..') {
      lastClickedIndex.value = -1;
      return;
    }
    selectedItems.value.add(item.filename);
    lastClickedIndex.value = itemIndex;
  };

  const handleItemClick = (event: MouseEvent, item: FileListItem) => {
    const ctrlOrMeta = event.ctrlKey || event.metaKey;
    const shift = event.shiftKey;

    // 查找点击项在当前显示列表中的索引
    const itemIndex = findItemIndex(item);

    // 如果找不到项（理论上不应发生），或者点击的是 '..'
    // (注意: '..' 通常是单独处理或在列表开头，这里假设它不在 displayedFileList 中，或者其点击事件由外部单独处理)
    // 我们主要处理 displayedFileList 中的项的选择逻辑
    if (itemIndex === -1) {
      // 如果点击的是 '..'
      if (item.filename === '..') {
        // 只有在没有修饰键时才执行 '..' 的动作
        if (ctrlOrMeta || shift) {
          return;
        }
        selectedItems.value.clear();
        lastClickedIndex.value = -1;
        onItemSingleClickAction?.(item);
        return;
      }

      // 如果不是 '..' 且找不到索引，则忽略无效点击
      return;
    }

    // --- 主要选择逻辑 ---
    if (ctrlOrMeta) {
      // 1. 检查 Ctrl/Meta
      event.preventDefault();
      event.stopPropagation();
      // Ctrl/Cmd + Click: Toggle selection
      if (selectedItems.value.has(item.filename)) {
        selectedItems.value.delete(item.filename);
      } else {
        selectedItems.value.add(item.filename);
      }
      lastClickedIndex.value = itemIndex;
    } else if (shift) {
      // 2. 检查 Shift
      event.preventDefault();
      event.stopPropagation();
      // Shift + Click: Range selection
      selectedItems.value.clear();
      // 如果 lastClickedIndex 是 -1 (例如第一次 Shift 点击)，则只选中当前项
      const start =
        lastClickedIndex.value === -1 ? itemIndex : Math.min(lastClickedIndex.value, itemIndex);
      const end =
        lastClickedIndex.value === -1 ? itemIndex : Math.max(lastClickedIndex.value, itemIndex);
      for (let i = start; i <= end; i++) {
        const fileToAdd = displayedFileList.value[i];
        if (fileToAdd && fileToAdd.filename !== '..') {
          selectedItems.value.add(fileToAdd.filename);
        }
      }
      lastClickedIndex.value = itemIndex;
    } else {
      // 3. 处理普通单击 (没有修饰键)
      updateSelectionToSingleItem(item, itemIndex);
      onItemSingleClickAction?.(item);
    }
  };

  const handleItemDoubleClick = (event: MouseEvent, item: FileListItem) => {
    // 双击交互不参与修饰键多选语义
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const itemIndex = findItemIndex(item);
    if (itemIndex === -1 && item.filename !== '..') {
      return;
    }

    if (itemIndex >= 0) {
      updateSelectionToSingleItem(item, itemIndex);
    } else if (item.filename === '..') {
      selectedItems.value.clear();
      lastClickedIndex.value = -1;
    }

    onItemDoubleClickAction?.(item);
  };

  // 清空选择的辅助函数，可能在其他地方（如路径改变时）需要
  const clearSelection = () => {
    selectedItems.value.clear();
    lastClickedIndex.value = -1;
  };

  return {
    selectedItems,
    lastClickedIndex, // 只读暴露，主要由内部管理
    handleItemClick,
    handleItemDoubleClick,
    clearSelection, // 暴露清空选择的方法
  };
}
