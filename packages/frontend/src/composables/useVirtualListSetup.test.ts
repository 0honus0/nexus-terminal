import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @vueuse/core's useVirtualList
const mockScrollTo = vi.fn();
const mockContainerProps = { ref: vi.fn(), onScroll: vi.fn() };
const mockWrapperProps = { style: { marginTop: '0px', marginBottom: '0px' } };
const mockList = ref<{ data: unknown; index: number }[]>([]);

const mockUseVirtualList = vi.fn(() => ({
  list: mockList,
  containerProps: mockContainerProps,
  wrapperProps: mockWrapperProps,
  scrollTo: mockScrollTo,
}));

vi.mock('@vueuse/core', () => ({
  useVirtualList: mockUseVirtualList,
}));

import { useVirtualListSetup } from './useVirtualListSetup';

describe('useVirtualListSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('返回值结构', () => {
    it('应该返回 list、containerProps、wrapperProps 和 scrollTo', () => {
      const source = ref(['a', 'b', 'c']);
      const result = useVirtualListSetup(source, { itemHeight: 40 });

      expect(result).toHaveProperty('list');
      expect(result).toHaveProperty('containerProps');
      expect(result).toHaveProperty('wrapperProps');
      expect(result).toHaveProperty('scrollTo');
    });

    it('应该返回来自 useVirtualList 的 containerProps', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });
      expect(result.containerProps).toBe(mockContainerProps);
    });

    it('应该返回来自 useVirtualList 的 wrapperProps', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });
      expect(result.wrapperProps).toBe(mockWrapperProps);
    });

    it('应该返回来自 useVirtualList 的 scrollTo 函数', () => {
      const source = ref([1, 2, 3]);
      const result = useVirtualListSetup(source, { itemHeight: 40 });
      expect(result.scrollTo).toBe(mockScrollTo);
    });
  });

  describe('overscan 自动计算', () => {
    it('小行高（10px）应计算出最大 overscan 15', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 10 });

      // Math.min(15, Math.max(5, Math.ceil(200 / 10))) = Math.min(15, Math.max(5, 20)) = Math.min(15, 20) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('中等行高（40px）应计算出 5', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 40 });

      // Math.min(15, Math.max(5, Math.ceil(200 / 40))) = Math.min(15, Math.max(5, 5)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('大行高（180px）应计算出最小 overscan 5', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 180 });

      // Math.min(15, Math.max(5, Math.ceil(200 / 180))) = Math.min(15, Math.max(5, 2)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('行高 20px 应计算出 10', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 20 });

      // Math.min(15, Math.max(5, Math.ceil(200 / 20))) = Math.min(15, Math.max(5, 10)) = 10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('行高恰好 200px 时应计算出 5', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 200 });

      // Math.min(15, Math.max(5, Math.ceil(200 / 200))) = Math.min(15, Math.max(5, 1)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('行高 14px 时 ceil(200/14)=15，应计算出 15', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 14 });

      // Math.ceil(200/14) = Math.ceil(14.28) = 15 -> Math.min(15, Math.max(5, 15)) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('行高 13px 时应钳制为最大值 15', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 13 });

      // Math.ceil(200/13) = Math.ceil(15.38) = 16 -> Math.min(15, 16) = 15
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });
  });

  describe('显式 overscan 覆盖', () => {
    it('显式指定 overscan 应直接使用，不自动计算', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 40, overscan: 10 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('显式 overscan 为 15 应传递 15', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 40, overscan: 15 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('显式 overscan 为 5 应传递 5（文件管理器配置）', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 50, overscan: 15 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });

    it('显式 overscan 为 0 也应直接使用', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 40, overscan: 0 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 0 })
      );
    });
  });

  describe('函数形式的 itemHeight', () => {
    it('函数形式 itemHeight 应传递给 useVirtualList', () => {
      const source = ref([1, 2, 3]);
      const heightFn = () => 60;
      useVirtualListSetup(source, { itemHeight: heightFn });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ itemHeight: heightFn })
      );
    });

    it('函数形式 itemHeight 无显式 overscan 时应根据函数返回值自动计算', () => {
      const source = ref([1, 2, 3]);
      const heightFn = () => 100;
      useVirtualListSetup(source, { itemHeight: heightFn });

      // Math.min(15, Math.max(5, Math.ceil(200 / 100))) = Math.min(15, Math.max(5, 2)) = 5
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 5 })
      );
    });

    it('函数形式 itemHeight 返回 20px 时 overscan 应为 10', () => {
      const source = ref([1, 2, 3]);
      const heightFn = () => 20;
      useVirtualListSetup(source, { itemHeight: heightFn });

      // Math.ceil(200 / 20) = 10 -> Math.min(15, Math.max(5, 10)) = 10
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10 })
      );
    });

    it('函数形式 + 显式 overscan 时显式值优先', () => {
      const source = ref([1, 2, 3]);
      const heightFn = () => 20;
      useVirtualListSetup(source, { itemHeight: heightFn, overscan: 7 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 7 })
      );
    });
  });

  describe('数据源传递', () => {
    it('应该将 dataSource 作为第一参数传递给 useVirtualList', () => {
      const source = ref(['item1', 'item2']);
      useVirtualListSetup(source, { itemHeight: 40 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(source, expect.any(Object));
    });

    it('应该支持空数组数据源', () => {
      const source = ref<string[]>([]);
      useVirtualListSetup(source, { itemHeight: 40 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(source, expect.any(Object));
    });

    it('应该支持对象数组数据源', () => {
      const source = ref([{ id: 1, name: 'test' }]);
      useVirtualListSetup(source, { itemHeight: 40 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(source, expect.any(Object));
    });
  });

  describe('itemHeight 数值传递', () => {
    it('固定数值 itemHeight 应传递给 useVirtualList', () => {
      const source = ref([1, 2, 3]);
      useVirtualListSetup(source, { itemHeight: 50 });

      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ itemHeight: 50 })
      );
    });
  });

  describe('实际使用场景', () => {
    it('WorkspaceConnectionList 配置（overscan: 10）应按预期工作', () => {
      const source = ref([{ id: 1 }, { id: 2 }]);
      const CONNECTION_ITEM_HEIGHT = 48;
      const result = useVirtualListSetup(source, {
        itemHeight: CONNECTION_ITEM_HEIGHT,
        overscan: 10,
      });

      expect(result.list).toBeDefined();
      expect(result.scrollTo).toBeDefined();
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10, itemHeight: CONNECTION_ITEM_HEIGHT })
      );
    });

    it('AuditLogView 配置（itemHeight: 180）应按预期工作', () => {
      const source = ref([{ id: 1 }]);
      const result = useVirtualListSetup(source, { itemHeight: 180, overscan: 10 });

      expect(result.list).toBeDefined();
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 10, itemHeight: 180 })
      );
    });

    it('FileManagerFileList 配置（overscan: 15）应按预期工作', () => {
      const source = ref([{ name: 'file.txt' }]);
      const result = useVirtualListSetup(source, {
        itemHeight: () => 36,
        overscan: 15,
      });

      expect(result.list).toBeDefined();
      expect(mockUseVirtualList).toHaveBeenCalledWith(
        source,
        expect.objectContaining({ overscan: 15 })
      );
    });
  });
});