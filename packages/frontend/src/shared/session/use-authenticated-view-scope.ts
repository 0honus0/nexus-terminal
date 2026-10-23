import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import { registerAuthenticatedSessionReset } from './authenticatedSessionLifecycle';

export type ViewRevocation = 'session' | 'view' | 'disposed';

/** Owns UI intentions; accepted work remains tracked by its feature store or runtime. */
export function useAuthenticatedViewScope(
	options: {
		available?: () => boolean;
		/** Keep the current read state while a sibling view temporarily hides this surface. */
		retainOnView?: boolean;
		onRevoke?: (reason: ViewRevocation) => void;
	} = {},
): {
	capture(): AbortSignal;
	isCurrent(signal: AbortSignal): boolean;
} {
	let scope = new AbortController();
	let active = true;
	let disposed = false;
	const available = options.available ?? (() => true);
	const retainOnView = options.retainOnView ?? false;

	function revoke(reason: ViewRevocation): void {
		scope.abort();
		options.onRevoke?.(reason);
	}

	function activate(): void {
		if (!disposed && active && available() && scope.signal.aborted) {
			scope = new AbortController();
		}
	}

	const unregister = registerAuthenticatedSessionReset('view-' + crypto.randomUUID(), () => revoke('session'));
	watch(
		available,
		(value) => {
			if (value) {
				activate();
			} else if (!retainOnView) {
				revoke('view');
			}
		},
		{ immediate: true, flush: 'sync' },
	);
	onActivated(() => {
		active = true;
		activate();
	});
	onDeactivated(() => {
		active = false;
		revoke('view');
	});
	onBeforeUnmount(() => {
		disposed = true;
		unregister();
		revoke('disposed');
	});

	return {
		capture: (): AbortSignal => scope.signal,

		isCurrent: (signal: AbortSignal): boolean =>
			!disposed && active && (available() || retainOnView) && scope.signal === signal && !signal.aborted,
	};
}
