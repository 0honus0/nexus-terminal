import { describe, it, expect, vi } from 'vitest';
import { ref, type Ref } from 'vue';
import { useFileManagerSelection } from './useFileManagerSelection';
import type { FileListItem } from '../../types/sftp.types';

function createItem(filename: string, opts: Partial<FileListItem['attrs']> = {}): FileListItem {
  return {
    filename,
    longname: filename,
    attrs: {
      size: 0,
      uid: 0,
      gid: 0,
      mode: 0o644,
      atime: 0,
      mtime: 0,
      isDirectory: false,
      isFile: true,
      isSymbolicLink: false,
      ...opts,
    },
  };
}

function createMouseEvent(modifiers?: Partial<MouseEvent>): MouseEvent {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...modifiers,
  } as unknown as MouseEvent;
}

describe('useFileManagerSelection', () => {
  const directory = createItem('dir', { isDirectory: true, isFile: false });
  const fileA = createItem('a.txt');
  const fileB = createItem('b.txt');
  const parent = createItem('..', { isDirectory: true, isFile: false });
  const displayedFileList = ref([directory, fileA, fileB]) as Ref<Readonly<FileListItem[]>>;

  it('普通单击应更新选中并触发 single-click 回调', () => {
    const onItemSingleClickAction = vi.fn();
    const onItemDoubleClickAction = vi.fn();
    const selection = useFileManagerSelection({
      displayedFileList,
      onItemSingleClickAction,
      onItemDoubleClickAction,
    });

    selection.handleItemClick(createMouseEvent(), fileA);

    expect(onItemSingleClickAction).toHaveBeenCalledTimes(1);
    expect(onItemSingleClickAction).toHaveBeenCalledWith(fileA);
    expect(onItemDoubleClickAction).not.toHaveBeenCalled();
    expect(selection.selectedItems.value.has('a.txt')).toBe(true);
    expect(selection.lastClickedIndex.value).toBe(1);
  });

  it('双击应触发 double-click 回调并保持单项选中', () => {
    const onItemSingleClickAction = vi.fn();
    const onItemDoubleClickAction = vi.fn();
    const selection = useFileManagerSelection({
      displayedFileList,
      onItemSingleClickAction,
      onItemDoubleClickAction,
    });

    selection.handleItemClick(createMouseEvent(), fileB);
    selection.handleItemDoubleClick(createMouseEvent(), fileA);

    expect(onItemDoubleClickAction).toHaveBeenCalledTimes(1);
    expect(onItemDoubleClickAction).toHaveBeenCalledWith(fileA);
    expect(selection.selectedItems.value.size).toBe(1);
    expect(selection.selectedItems.value.has('a.txt')).toBe(true);
    expect(selection.lastClickedIndex.value).toBe(1);
  });

  it('Ctrl/Cmd 单击应切换多选且不触发动作回调', () => {
    const onItemSingleClickAction = vi.fn();
    const onItemDoubleClickAction = vi.fn();
    const selection = useFileManagerSelection({
      displayedFileList,
      onItemSingleClickAction,
      onItemDoubleClickAction,
    });

    selection.handleItemClick(createMouseEvent({ ctrlKey: true }), fileA);
    selection.handleItemClick(createMouseEvent({ metaKey: true }), fileB);

    expect(onItemSingleClickAction).not.toHaveBeenCalled();
    expect(onItemDoubleClickAction).not.toHaveBeenCalled();
    expect(selection.selectedItems.value.has('a.txt')).toBe(true);
    expect(selection.selectedItems.value.has('b.txt')).toBe(true);
  });

  it('Shift 单击应范围选中且不触发动作回调', () => {
    const onItemSingleClickAction = vi.fn();
    const onItemDoubleClickAction = vi.fn();
    const selection = useFileManagerSelection({
      displayedFileList,
      onItemSingleClickAction,
      onItemDoubleClickAction,
    });

    selection.handleItemClick(createMouseEvent(), directory);
    selection.handleItemClick(createMouseEvent({ shiftKey: true }), fileB);

    expect(onItemSingleClickAction).toHaveBeenCalledTimes(1);
    expect(onItemDoubleClickAction).not.toHaveBeenCalled();
    expect(selection.selectedItems.value.has('dir')).toBe(true);
    expect(selection.selectedItems.value.has('a.txt')).toBe(true);
    expect(selection.selectedItems.value.has('b.txt')).toBe(true);
  });

  it('双击带修饰键时应忽略动作', () => {
    const onItemDoubleClickAction = vi.fn();
    const selection = useFileManagerSelection({
      displayedFileList,
      onItemDoubleClickAction,
    });

    selection.handleItemDoubleClick(createMouseEvent({ shiftKey: true }), fileA);
    selection.handleItemDoubleClick(createMouseEvent({ ctrlKey: true }), fileA);

    expect(onItemDoubleClickAction).not.toHaveBeenCalled();
  });

  it('单击父目录项应触发 single-click 回调并清空选择', () => {
    const onItemSingleClickAction = vi.fn();
    const selection = useFileManagerSelection({
      displayedFileList,
      onItemSingleClickAction,
    });

    selection.handleItemClick(createMouseEvent(), fileA);
    selection.handleItemClick(createMouseEvent(), parent);

    expect(onItemSingleClickAction).toHaveBeenLastCalledWith(parent);
    expect(selection.selectedItems.value.size).toBe(0);
    expect(selection.lastClickedIndex.value).toBe(-1);
  });
});
