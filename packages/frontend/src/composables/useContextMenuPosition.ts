/**
 * 右键菜单位置计算 composable
 *
 * 从 WorkspaceConnectionList.vue 中提取，消除 showContextMenu 和 showTagContextMenu
 * 中重复的边界检测逻辑。
 *
 * 提供一个统一的位置计算函数，根据鼠标事件坐标和菜单尺寸计算最终菜单位置，
 * 确保菜单不会超出视口边界。
 */
import { ref, nextTick } from 'vue';

/** 默认边距（px），防止菜单紧贴屏幕边缘 */
const EDGE_PADDING = 5;

export interface MenuPosition {
  x: number;
  y: number;
}

export function useContextMenuPosition() {
  const position = ref<MenuPosition>({ x: 0, y: 0 });
  const visible = ref(false);

  /**
   * 根据鼠标事件计算菜单位置（含边界检测）
   *
   * 使用 nextTick 等待 DOM 渲染后获取真实菜单尺寸，再进行边界修正。
   * 如果菜单会超出视口，自动调整位置使其完全可见。
   *
   * @param event 鼠标事件
   * @param menuSelector 菜单元素的 CSS 选择器（用于获取实际尺寸）
   */
  const calculateMenuPosition = (event: MouseEvent, menuSelector: string) => {
    // 先用鼠标坐标设置初始位置
    position.value = { x: event.clientX, y: event.clientY };
    visible.value = true;

    // 下一帧获取真实菜单尺寸并修正位置
    nextTick(() => {
      const menuElement = document.querySelector(menuSelector) as HTMLElement;
      if (!menuElement) return;

      const menuRect = menuElement.getBoundingClientRect();
      let finalX = position.value.x;
      let finalY = position.value.y;
      const menuWidth = menuRect.width;
      const menuHeight = menuRect.height;

      // 右边界检测：如果菜单超出右侧，向左偏移
      if (finalX + menuWidth > window.innerWidth) {
        finalX = window.innerWidth - menuWidth - EDGE_PADDING;
      }

      // 下边界检测：如果菜单超出底部，向上偏移
      if (finalY + menuHeight > window.innerHeight) {
        finalY = window.innerHeight - menuHeight - EDGE_PADDING;
      }

      // 左/上边界检测：确保菜单不超出屏幕左上角
      finalX = Math.max(EDGE_PADDING, finalX);
      finalY = Math.max(EDGE_PADDING, finalY);

      // 仅在位置发生变化时更新（减少不必要的响应式触发）
      if (finalX !== position.value.x || finalY !== position.value.y) {
        position.value = { x: finalX, y: finalY };
      }
    });
  };

  /** 关闭菜单 */
  const closeMenu = () => {
    visible.value = false;
  };

  return {
    position,
    visible,
    calculateMenuPosition,
    closeMenu,
  };
}
