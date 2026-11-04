import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import { authenticatedSessionLifecycle, registerAuthenticatedSessionOwner } from './authenticatedSessionLifecycle';

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
	if (authenticatedSessionLifecycle.userId === null) scope.abort();

	function revoke(reason: ViewRevocation): void {
		scope.abort();
		options.onRevoke?.(reason);
	}

	function activate(): void {
		if (
			!disposed &&
			active &&
			authenticatedSessionLifecycle.userId !== null &&
			available() &&
			scope.signal.aborted
		) {
			scope = new AbortController();
		}
	}

	const unregister = registerAuthenticatedSessionOwner('view-' + crypto.randomUUID(), (event) => {
		if (event.type === 'attach') activate();
		else revoke('session');
	});
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
			!disposed &&
			active &&
			authenticatedSessionLifecycle.userId !== null &&
			(available() || retainOnView) &&
			scope.signal === signal &&
			!signal.aborted,
	};
}
