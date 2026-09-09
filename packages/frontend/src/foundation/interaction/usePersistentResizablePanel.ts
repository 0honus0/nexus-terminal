import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { useResizeHandle, type ResizeHandleOptions, type ResizeSize } from './useResizeHandle';

type SizeLimit = number | (() => number);

export interface PersistentResizablePanelOptions {
  storageKey: string;
  defaultSize: () => ResizeSize;
  minWidth: SizeLimit;
  minHeight: SizeLimit;
  maxWidth: () => number;
  maxHeight: () => number;
  active?: Readonly<Ref<boolean>>;
  enabled?: () => boolean;
  widthMultiplier?: number;
  heightMultiplier?: number;
  canStart?: ResizeHandleOptions['canStart'];
}

const resolveLimit = (value: SizeLimit): number => (typeof value === 'function' ? value() : value);
const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(min, value), max);
const positiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Reusable desktop panel sizing: persisted geometry, viewport clamping and bottom-right pointer resize.
 * Consumers provide only their business-specific defaults and bounds.
 */
export function usePersistentResizablePanel(options: PersistentResizablePanelOptions) {
  const initial = options.defaultSize();
  const width = ref(initial.width);
  const height = ref(initial.height);
  const enabled = (): boolean => options.enabled?.() !== false;

  const clampSize = (): void => {
    if (!enabled()) return;
    width.value = clamp(width.value, resolveLimit(options.minWidth), options.maxWidth());
    height.value = clamp(height.value, resolveLimit(options.minHeight), options.maxHeight());
  };

  const resetToDefault = (): void => {
    const fallback = options.defaultSize();
    width.value = fallback.width;
    height.value = fallback.height;
  };

  const restore = (): void => {
    if (!enabled()) return;
    resetToDefault();
    try {
      const raw = localStorage.getItem(options.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown };
        if (positiveFiniteNumber(parsed.width)) width.value = parsed.width;
        if (positiveFiniteNumber(parsed.height)) height.value = parsed.height;
      }
    } catch {
      resetToDefault();
    }
    clampSize();
  };

  const persist = (): void => {
    if (!enabled()) return;
    try {
      localStorage.setItem(
        options.storageKey,
        JSON.stringify({ width: Math.round(width.value), height: Math.round(height.value) }),
      );
    } catch {
      // Browser-local presentation state may remain in memory when storage is unavailable.
    }
  };

  const resize = useResizeHandle({
    width,
    height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    widthMultiplier: options.widthMultiplier,
    heightMultiplier: options.heightMultiplier,
    canStart: (event) => enabled() && (options.canStart?.(event) ?? true),
    onEnd: persist,
  });

  const handleViewportResize = (): void => clampSize();

  onMounted(() => window.addEventListener('resize', handleViewportResize));
  onBeforeUnmount(() => window.removeEventListener('resize', handleViewportResize));

  watch(
    () => [options.active?.value ?? true, enabled()] as const,
    ([active, isEnabled]) => {
      if (active && isEnabled) restore();
    },
    { immediate: true },
  );

  return {
    width,
    height,
    clampSize,
    restore,
    persist,
    resize,
  };
}
