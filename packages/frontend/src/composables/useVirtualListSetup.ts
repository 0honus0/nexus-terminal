import { computed, type Ref } from 'vue';
import { useVirtualList } from '@vueuse/core';

/**
 * 虚拟列表通用配置 composable
 *
 * 封装 @vueuse/core 的 useVirtualList，提供统一的接口和自动 overscan 缩放。
 * 消除各组件重复的虚拟滚动样板代码。
 *
 * @param dataSource - 数据源响应式引用
 * @param options - 配置项
 * @returns 虚拟列表控制对象
 */
export function useVirtualListSetup<T>(
  dataSource: Ref<T[]>,
  options: {
    /** 每项高度（px），支持固定数值或动态函数 */
    itemHeight: number | (() => number);
    /** overscan 预渲染数量，默认自动缩放 */
    overscan?: number;
  }
) {
  const { itemHeight, overscan: overscanOverride } = options;

  // 自动 overscan 缩放：根据行高动态调整预渲染数量，平衡滚动流畅度与渲染开销
  const resolvedOverscan = computed(() => {
    if (overscanOverride !== undefined) return overscanOverride;
    const height = typeof itemHeight === 'function' ? itemHeight() : itemHeight;
    return Math.min(15, Math.max(5, Math.ceil(200 / height)));
  });

  const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(dataSource, {
    itemHeight,
    overscan: resolvedOverscan.value,
  });

  return {
    /** 虚拟列表渲染数据 */
    list,
    /** 绑定到滚动容器的属性 */
    containerProps,
    /** 绑定到内容包装器的属性 */
    wrapperProps,
    /** 滚动到指定索引 */
    scrollTo,
  };
}
