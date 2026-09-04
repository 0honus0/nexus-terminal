import { computed, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue';

export interface DeviceCapabilities {
  isMobile: ComputedRef<boolean>;
  hasTouch: Readonly<Ref<boolean>>;
  hasCoarsePointer: Readonly<Ref<boolean>>;
  isNarrowViewport: Readonly<Ref<boolean>>;
}

const MOBILE_USER_AGENT = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export const isMobileUserAgent = (userAgent: string): boolean => MOBILE_USER_AGENT.test(userAgent);

/**
 * Browser capability classification used by responsive/touch UI.
 *
 * User agent remains one signal for compatibility with installed/mobile browsers,
 * while pointer capability + viewport width covers touch devices whose UA is desktop-like.
 */
export function useDeviceCapabilities(): DeviceCapabilities {
  const hasTouch = ref(false);
  const hasCoarsePointer = ref(false);
  const isNarrowViewport = ref(false);
  const mobileUserAgent = ref(false);

  let coarseQuery: MediaQueryList | null = null;
  let narrowQuery: MediaQueryList | null = null;

  const refreshStaticCapabilities = (): void => {
    hasTouch.value = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    mobileUserAgent.value = isMobileUserAgent(navigator.userAgent);
  };

  const refreshMediaCapabilities = (): void => {
    hasCoarsePointer.value = coarseQuery?.matches ?? false;
    isNarrowViewport.value = narrowQuery?.matches ?? false;
  };

  const isMobile = computed(
    () => mobileUserAgent.value || (hasTouch.value && (hasCoarsePointer.value || isNarrowViewport.value)),
  );

  onMounted(() => {
    coarseQuery = window.matchMedia('(pointer: coarse)');
    narrowQuery = window.matchMedia('(max-width: 767px)');
    refreshStaticCapabilities();
    refreshMediaCapabilities();
    coarseQuery.addEventListener('change', refreshMediaCapabilities);
    narrowQuery.addEventListener('change', refreshMediaCapabilities);
  });

  onBeforeUnmount(() => {
    coarseQuery?.removeEventListener('change', refreshMediaCapabilities);
    narrowQuery?.removeEventListener('change', refreshMediaCapabilities);
  });

  return { isMobile, hasTouch, hasCoarsePointer, isNarrowViewport };
}
