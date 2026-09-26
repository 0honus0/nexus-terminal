import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { jsonStorageCodec, readStoredValue, writeStoredValue } from '@/foundation/browser';
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

const sizeStorage = (storageKey: string) =>
  ({
    namespace: `panel-size.${storageKey}`,
    version: 1,
    codec: jsonStorageCodec<Partial<ResizeSize>>((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const candidate = value as Record<string, unknown>;
      return {
        ...(positiveFiniteNumber(candidate.width) ? { width: candidate.width } : {}),
        ...(positiveFiniteNumber(candidate.height) ? { height: candidate.height } : {}),
      };
    }),
    legacyKeys: [storageKey],
  }) as const;

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
    const stored = readStoredValue(sizeStorage(options.storageKey));
    if (positiveFiniteNumber(stored?.width)) width.value = stored.width;
    if (positiveFiniteNumber(stored?.height)) height.value = stored.height;
    clampSize();
  };

  const persist = (): void => {
    if (!enabled()) return;
    writeStoredValue(sizeStorage(options.storageKey), {
      width: Math.round(width.value),
      height: Math.round(height.value),
    });
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
