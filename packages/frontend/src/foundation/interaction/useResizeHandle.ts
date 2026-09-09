import { onBeforeUnmount, ref, type Ref } from 'vue';

export interface ResizeSize {
  width: number;
  height: number;
}

export interface ResizeHandleOptions {
  width: Ref<number>;
  height: Ref<number>;
  minWidth: number | (() => number);
  minHeight: number | (() => number);
  maxWidth?: () => number;
  maxHeight?: () => number;
  canStart?: (event: PointerEvent) => boolean;
  onStart?: (size: ResizeSize) => void;
  onMove?: (size: ResizeSize) => void;
  onEnd?: (size: ResizeSize) => void;
  widthDirection?: 1 | -1;
  heightDirection?: 1 | -1;
  widthMultiplier?: number;
  heightMultiplier?: number;
}

const clamp = (value: number, min: number, max: number | undefined): number =>
  Math.min(Math.max(min, value), max ?? Number.POSITIVE_INFINITY);
const resolveLimit = (value: number | (() => number)): number => (typeof value === 'function' ? value() : value);

/** Business-agnostic bottom-right pointer resize mechanics. */
export function useResizeHandle(options: ResizeHandleOptions) {
  const isResizing = ref(false);

  let activePointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;
  let previousBodyUserSelect = '';

  const currentSize = (): ResizeSize => ({ width: options.width.value, height: options.height.value });

  const removeWindowListeners = (): void => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  };

  const handlePointerMove = (event: PointerEvent): void => {
    if (!isResizing.value || event.pointerId !== activePointerId) return;

    const widthDirection = options.widthDirection ?? 1;
    const heightDirection = options.heightDirection ?? 1;
    options.width.value = clamp(
      startWidth + (event.clientX - startX) * widthDirection * (options.widthMultiplier ?? 1),
      resolveLimit(options.minWidth),
      options.maxWidth?.(),
    );
    options.height.value = clamp(
      startHeight + (event.clientY - startY) * heightDirection * (options.heightMultiplier ?? 1),
      resolveLimit(options.minHeight),
      options.maxHeight?.(),
    );
    options.onMove?.(currentSize());
  };

  function stopResize(event?: PointerEvent): void {
    if (!isResizing.value) return;
    if (event && event.pointerId !== activePointerId) return;

    isResizing.value = false;
    activePointerId = null;
    removeWindowListeners();
    document.body.style.userSelect = previousBodyUserSelect;
    options.onEnd?.(currentSize());
  }

  const startResize = (event: PointerEvent): void => {
    if (!event.isPrimary || isResizing.value || options.canStart?.(event) === false) return;

    event.preventDefault();
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startWidth = options.width.value;
    startHeight = options.height.value;
    previousBodyUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    isResizing.value = true;

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    options.onStart?.(currentSize());
  };

  onBeforeUnmount(() => {
    const shouldNotifyEnd = isResizing.value;
    isResizing.value = false;
    activePointerId = null;
    removeWindowListeners();
    document.body.style.userSelect = previousBodyUserSelect;
    if (shouldNotifyEnd) options.onEnd?.(currentSize());
  });

  return { isResizing, startResize, stopResize };
}
