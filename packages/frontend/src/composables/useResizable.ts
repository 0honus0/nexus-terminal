import { ref, onMounted, onBeforeUnmount, type Ref, watch } from 'vue';

interface UseResizableOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  edgeThreshold?: number; // How close to an edge to consider it a drag handle
  initialWidth?: number | string; // Allow string for % or vh/vw, or number for px
  initialHeight?: number | string; // Allow string for % or vh/vw, or number for px
}

type Edge = 'right' | 'bottom' | 'left' | 'top' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | null;

const isResizableElement = (value: unknown): value is HTMLElement => (
  value instanceof HTMLElement
  && typeof value.getBoundingClientRect === 'function'
);

export function useResizable(
  elementRef: Ref<HTMLElement | null>,
  options: UseResizableOptions = {}
) {
  const {
    minWidth = 100, // Default min width
    minHeight = 100, // Default min height
    maxWidth = Infinity,
    maxHeight = Infinity,
    edgeThreshold = 8, // pixels, sensitivity for edge detection
  } = options;

  const width = ref<number | null>(null);
  const height = ref<number | null>(null);
  const isResizing = ref(false);
  const currentEdge = ref<Edge>(null);

  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  const getEdge = (event: MouseEvent, el: HTMLElement): Edge => {
    const rect = el.getBoundingClientRect();
    const { clientX, clientY } = event;

    // Check corners first
    const onRight = Math.abs(clientX - rect.right) < edgeThreshold;
    const onLeft = Math.abs(clientX - rect.left) < edgeThreshold;
    const onBottom = Math.abs(clientY - rect.bottom) < edgeThreshold;
    const onTop = Math.abs(clientY - rect.top) < edgeThreshold;

    if (onRight && onBottom) return 'bottom-right';
    if (onLeft && onBottom) return 'bottom-left';
    if (onRight && onTop) return 'top-right';
    if (onLeft && onTop) return 'top-left';
    if (onRight) return 'right';
    if (onLeft) return 'left';
    if (onBottom) return 'bottom';
    if (onTop) return 'top';
    
    return null;
  };
  
  const updateCursorStyle = (el: HTMLElement, edge: Edge) => {
    if (edge === 'left' || edge === 'right') el.style.cursor = 'ew-resize';
    else if (edge === 'top' || edge === 'bottom') el.style.cursor = 'ns-resize';
    else if (edge === 'top-left' || edge === 'bottom-right') el.style.cursor = 'nwse-resize';
    else if (edge === 'top-right' || edge === 'bottom-left') el.style.cursor = 'nesw-resize';
    else el.style.cursor = 'default';
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isResizing.value || !currentEdge.value) return;
    event.preventDefault();

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    let newWidth = width.value ?? startWidth;
    let newHeight = height.value ?? startHeight;

    if (currentEdge.value.includes('right')) newWidth = startWidth + deltaX;
    if (currentEdge.value.includes('left')) newWidth = startWidth - deltaX;
    if (currentEdge.value.includes('bottom')) newHeight = startHeight + deltaY;
    if (currentEdge.value.includes('top')) newHeight = startHeight - deltaY;

    width.value = Math.max(minWidth, Math.min(maxWidth, newWidth));
    height.value = Math.max(minHeight, Math.min(maxHeight, newHeight));
  };

  const handleMouseUp = () => {
    if (!isResizing.value) return;
    isResizing.value = false;
    currentEdge.value = null;
    const element = elementRef.value;
    if (isResizableElement(element)) {
      element.style.userSelect = '';
      updateCursorStyle(element, null);
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  const handleMouseDown = (event: MouseEvent) => {
    const element = elementRef.value;
    if (!isResizableElement(element)) return;
    const edge = getEdge(event, element);
    if (!edge) return;

    event.preventDefault();
    isResizing.value = true;
    currentEdge.value = edge;
    startX = event.clientX;
    startY = event.clientY;

    const rect = element.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    width.value = startWidth;
    height.value = startHeight;
    element.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleElementHover = (event: MouseEvent) => {
    const element = elementRef.value;
    if (!isResizableElement(element) || isResizing.value) return;
    updateCursorStyle(element, getEdge(event, element));
  };

  const handleMouseLeave = (event: MouseEvent) => {
    if (isResizing.value) return;
    const element = event.currentTarget;
    if (isResizableElement(element)) updateCursorStyle(element, null);
  };

  const initializeDimensions = (element: HTMLElement) => {
    const computedStyle = window.getComputedStyle(element);
    const parsedWidth = Number.parseFloat(computedStyle.width);
    const parsedHeight = Number.parseFloat(computedStyle.height);
    width.value = Number.isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
    height.value = Number.isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);
  };

  const attachElement = (element: unknown) => {
    if (!isResizableElement(element)) return;
    initializeDimensions(element);
    element.addEventListener('mousedown', handleMouseDown);
    element.addEventListener('mousemove', handleElementHover);
    element.addEventListener('mouseleave', handleMouseLeave);
  };

  const detachElement = (element: unknown) => {
    if (!isResizableElement(element)) return;
    element.removeEventListener('mousedown', handleMouseDown);
    element.removeEventListener('mousemove', handleElementHover);
    element.removeEventListener('mouseleave', handleMouseLeave);
    element.style.userSelect = '';
    updateCursorStyle(element, null);
  };

  onMounted(() => attachElement(elementRef.value));

  onBeforeUnmount(() => {
    detachElement(elementRef.value);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });

  watch(elementRef, (newElement, oldElement) => {
    if (newElement === oldElement) return;
    detachElement(oldElement);
    attachElement(newElement);
  });

  return {
    width,
    height,
    isResizing,
  };
}