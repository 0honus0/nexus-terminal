import { useMediaQuery } from '@vueuse/core';
import { computed, onMounted, ref, type ComputedRef, type Ref } from 'vue';

export interface DeviceCapabilities {
	isMobile: ComputedRef<boolean>;
	supportsTouchInteraction: ComputedRef<boolean>;
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
	const hasCoarsePointer = useMediaQuery('(pointer: coarse)');
	const isNarrowViewport = useMediaQuery('(max-width: 767px)');
	const mobileUserAgent = ref(typeof navigator !== 'undefined' && isMobileUserAgent(navigator.userAgent));
	// A narrow desktop viewport needs the same single-column workspace treatment as a
	// phone; relying on UA alone collapses every tool into unusable columns at 390px.
	const isMobile = computed(() => mobileUserAgent.value || isNarrowViewport.value);
	const supportsTouchInteraction = computed(() => hasTouch.value || hasCoarsePointer.value);

	onMounted(() => {
		hasTouch.value = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
		mobileUserAgent.value = isMobileUserAgent(navigator.userAgent);
	});

	return { isMobile, supportsTouchInteraction, hasTouch, hasCoarsePointer, isNarrowViewport };
}
